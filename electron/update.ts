import { createWriteStream, existsSync, renameSync, rmSync, statSync } from 'node:fs';
import { request } from 'node:https';
import { createHash } from 'node:crypto';
import type { IncomingMessage } from 'node:http';

// In-app updates: the release asset matching how this copy was installed is downloaded from the project's own GitHub
// release, checked against the size and SHA-256 digest GitHub publishes for it, and only then handed to the installer.
export type InstallKind = 'nsis' | 'appimage' | 'deb' | 'pacman';
export interface ReleaseAsset { name: string; url: string; size: number; digest: string | null }
const downloads = 'https://github.com/Nergal-exe/DubBitig/releases/download/';
const hosts = new Set(['github.com', 'objects.githubusercontent.com', 'release-assets.githubusercontent.com']);
const patterns: Record<InstallKind, RegExp> = { nsis: /^DubBitig-\d+\.\d+\.\d+-Setup\.exe$/, appimage: /^DubBitig-\d+\.\d+\.\d+-x86_64\.AppImage$/, deb: /^DubBitig-\d+\.\d+\.\d+-amd64\.deb$/, pacman: /^DubBitig-\d+\.\d+\.\d+-x64\.pacman$/ };

// Portable Windows builds and unpackaged Linux folders have no installer to run; they keep the download page.
export function installKind(platform: NodeJS.Platform, env: NodeJS.ProcessEnv, execPath: string, has: (path: string) => boolean = existsSync): InstallKind | null {
  if (platform === 'win32') return env.PORTABLE_EXECUTABLE_FILE ? null : 'nsis';
  if (platform !== 'linux') return null;
  if (env.APPIMAGE) return 'appimage';
  if (!execPath.startsWith('/opt/')) return null;
  if (has('/etc/arch-release') && has('/usr/bin/pacman')) return 'pacman';
  if (has('/etc/debian_version') && has('/usr/bin/dpkg')) return 'deb';
  return null;
}
export function releaseAssets(data: unknown): ReleaseAsset[] {
  const assets = (data as { assets?: unknown })?.assets;
  if (!Array.isArray(assets)) return [];
  return assets.flatMap(a => {
    const url = String(a?.browser_download_url ?? ''); const size = Number(a?.size); const digest = typeof a?.digest === 'string' && /^sha256:[0-9a-f]{64}$/.test(a.digest) ? a.digest.slice(7) : null;
    return url.startsWith(downloads) && typeof a?.name === 'string' && Number.isSafeInteger(size) && size > 0 ? [{ name: a.name, url, size, digest }] : [];
  });
}
export const pickAsset = (assets: ReleaseAsset[], kind: InstallKind) => assets.find(a => patterns[kind].test(a.name));

export interface DownloadProgress { done: number; total: number }
type Get = (url: URL, callback: (response: IncomingMessage) => void) => { on(event: 'error', listener: (error: Error) => void): unknown; setTimeout(ms: number, listener: () => void): unknown; destroy(error?: Error): void; end(): void };
const httpsGet: Get = (url, callback) => request(url, { headers: { 'User-Agent': 'DubBitig-updater', Accept: 'application/octet-stream' } }, callback);
/**
 * Streams the asset to destination + '.part', hashing as it goes, and renames it into place only when the size and
 * digest match. A partial or wrong file never takes the final name.
 */
export async function downloadAsset(asset: ReleaseAsset, destination: string, progress: (value: DownloadProgress) => void = () => {}, get: Get = httpsGet): Promise<string> {
  const part = destination + '.part';
  rmSync(part, { force: true });
  try {
    const hash = createHash('sha256'); let done = 0;
    let url = new URL(asset.url);
    for (let redirect = 0; ; redirect++) {
      if (url.protocol !== 'https:' || !hosts.has(url.hostname)) throw new Error('Güncelleme beklenmeyen bir adrese yönlendirildi: ' + url.hostname);
      const response = await new Promise<IncomingMessage>((resolve, reject) => { const req = get(url, resolve); req.on('error', reject); req.setTimeout(60000, () => req.destroy(new Error('İndirme zaman aşımına uğradı.'))); req.end(); });
      const status = response.statusCode ?? 0;
      if (status >= 300 && status < 400 && response.headers.location && redirect < 5) { response.resume(); url = new URL(response.headers.location, url); continue; }
      if (status !== 200) { response.resume(); throw new Error(`Güncelleme indirilemedi (HTTP ${status}).`); }
      await new Promise<void>((resolve, reject) => {
        const file = createWriteStream(part, { flags: 'wx' });
        response.on('data', (chunk: Buffer) => {
          done += chunk.length; hash.update(chunk);
          if (done > asset.size) response.destroy(new Error('İndirilen dosya beklenenden büyük.'));
          else progress({ done, total: asset.size });
        });
        // Close the file before rejecting so Windows can delete the partial download.
        const fail = (error: Error) => { response.unpipe(file); file.destroy(); file.once('close', () => reject(error)); };
        response.on('error', fail); file.on('error', fail); file.on('finish', resolve);
        response.pipe(file);
      });
      break;
    }
    if (done !== asset.size || statSync(part).size !== asset.size) throw new Error('İndirilen güncellemenin boyutu yanlış. Bağlantını denetleyip yeniden dene.');
    if (asset.digest && hash.digest('hex') !== asset.digest) throw new Error('İndirilen güncelleme doğrulanamadı (SHA-256 farklı). Dosya kullanılmadı.');
    renameSync(part, destination);
    return destination;
  } catch (error) { rmSync(part, { force: true }); throw error; }
}
