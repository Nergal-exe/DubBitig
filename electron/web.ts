import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { lookup } from 'node:dns/promises';
import { isIP, BlockList } from 'node:net';
import { load } from 'cheerio';
import type { LinkCheck } from '../src/shared/model.js';

const blocked = new BlockList();
for (const [address, prefix] of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],['192.168.0.0',16],['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',4],['240.0.0.0',4]] as const) blocked.addSubnet(address, prefix);
export function isPublicAddress(address: string) { return isIP(address) === 4 && !blocked.check(address); }
export function publicUrl(value: string) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hostname === 'localhost' || (url.port && !['80','443'].includes(url.port))) throw new Error('Yalnızca genel HTTP/HTTPS web siteleri denetlenebilir.');
  if (isIP(url.hostname.replace(/[\[\]]/g, '')) && !isPublicAddress(url.hostname)) throw new Error('Yerel ve özel ağ adresleri denetlenmez.');
  return url;
}
export interface WebResponse { url: string; status: number; headers: Record<string, string | string[] | undefined>; bytes: Buffer }
export type WebFetcher = (url: string, options?: { method?: 'HEAD' | 'GET'; readBody?: boolean; limit?: number }) => Promise<WebResponse>;
export const fetchPublic: WebFetcher = async (value, options = {}) => {
  let current = publicUrl(value);
  for (let redirect = 0; redirect <= 5; redirect++) {
    const records = await Promise.race([lookup(current.hostname, { all: true, family: 4 }), new Promise<never>((_, reject) => { const timer = setTimeout(() => reject(new Error('DNS zaman aşımı.')), 8000); timer.unref(); })]);
    if (!records.length || records.some(r => !isPublicAddress(r.address))) throw new Error('Yerel ve özel ağ adresleri denetlenmez.');
    const address = records[0].address;
    const response = await new Promise<WebResponse>((resolve, reject) => {
      const request = current.protocol === 'https:' ? httpsRequest : httpRequest;
      const req = request(current, { method: options.method ?? 'GET', family: 4, lookup: (_host, _opts, callback) => callback(null, address, 4), headers: { 'User-Agent': 'DubBitig/1.3 (personal bookmark preview)', Accept: 'text/html,image/*;q=0.8,*/*;q=0.5', 'Accept-Encoding': 'identity' } }, res => {
        const result = { url: current.href, status: res.statusCode ?? 0, headers: res.headers, bytes: Buffer.alloc(0) };
        if (options.readBody === false || (result.status >= 300 && result.status < 400)) { res.destroy(); resolve(result); return; }
        const parts: Buffer[] = []; let length = 0;
        res.on('data', (part: Buffer) => { length += part.length; if (length > (options.limit ?? 2 * 1024 * 1024)) res.destroy(new Error('Web içeriği boyut sınırını aşıyor.')); else parts.push(part); });
        res.on('end', () => resolve({ ...result, bytes: Buffer.concat(parts) })); res.on('error', reject);
      });
      const timer = setTimeout(() => req.destroy(new Error('Bağlantı zaman aşımı.')), 12000);
      req.on('error', reject); req.on('close', () => clearTimeout(timer)); req.end();
    });
    if (response.status >= 300 && response.status < 400 && typeof response.headers.location === 'string') { current = publicUrl(new URL(response.headers.location, current).href); continue; }
    return response;
  }
  throw new Error('Çok fazla yönlendirme.');
};
export function parseMetadata(html: string, url: string) {
  const $ = load(html);
  const meta = (key: string) => $(`meta[property="${key}"],meta[name="${key}"]`).first().attr('content')?.trim() ?? '';
  const resolve = (value: string) => { if (!value) return ''; try { return publicUrl(new URL(value, url).href).href; } catch { return ''; } };
  return {
    title: (meta('og:title') || meta('twitter:title') || $('title').first().text() || new URL(url).hostname).trim().replace(/\s+/g, ' ').slice(0,200),
    description: (meta('og:description') || meta('description') || meta('twitter:description')).slice(0,1000),
    site: (meta('og:site_name') || new URL(url).hostname).slice(0,200),
    imageUrl: resolve(meta('og:image') || meta('twitter:image')),
    faviconUrl: resolve($('link[rel~="icon"]').first().attr('href') || '/favicon.ico'),
  };
}
export function classifyStatus(status: number): LinkCheck['state'] { return status >= 200 && status < 400 ? 'ok' : status === 404 || status === 410 ? 'broken' : 'unknown'; }
export async function checkUrl(url: string, fetcher: WebFetcher = fetchPublic): Promise<LinkCheck> {
  const checkedAt = new Date().toISOString();
  try {
    let response = await fetcher(url, { method: 'HEAD', readBody: false });
    if ([403,405,501].includes(response.status)) response = await fetcher(url, { method: 'GET', readBody: false });
    const state = classifyStatus(response.status);
    return { state, checkedAt, status: response.status, detail: state === 'ok' ? 'Bağlantı erişilebilir.' : state === 'broken' ? 'Sayfa bulunamadı veya kaldırılmış.' : `HTTP ${response.status}: site engeli veya geçici sorun olabilir.` };
  } catch (e) { return { state: 'unknown', checkedAt, detail: (e instanceof Error ? e.message : 'Bağlantı doğrulanamadı.').slice(0,500) }; }
}
