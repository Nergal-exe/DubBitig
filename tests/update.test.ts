import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { createHash } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { downloadAsset, installKind, pickAsset, releaseAssets, type ReleaseAsset } from '../electron/update';

const release = { assets: ['DubBitig-1.10.0-Setup.exe', 'DubBitig-1.10.0-x86_64.AppImage', 'DubBitig-1.10.0-amd64.deb', 'DubBitig-1.10.0-x64.pacman', 'DubBitig-Chrome-1.10.0.zip'].map((name, i) => ({ name, size: 100 + i, digest: 'sha256:' + 'a'.repeat(64), browser_download_url: 'https://github.com/Nergal-exe/DubBitig/releases/download/v1.10.0/' + name })) };

test('kurulum türü kurulum biçimine göre seçilir; taşınabilir ve paketlenmemiş kopyalar kendini güncellemez', () => {
  const none = () => false; const arch = (p: string) => ['/etc/arch-release', '/usr/bin/pacman'].includes(p); const debian = (p: string) => ['/etc/debian_version', '/usr/bin/dpkg'].includes(p);
  assert.equal(installKind('win32', {}, 'C:\\Program Files\\DubBitig\\DubBitig.exe', none), 'nsis');
  assert.equal(installKind('win32', { PORTABLE_EXECUTABLE_FILE: 'D:\\DubBitig.exe' }, 'C:\\x', none), null);
  assert.equal(installKind('linux', { APPIMAGE: '/home/k/DubBitig.AppImage' }, '/tmp/.mount_x/dubbitig', none), 'appimage');
  assert.equal(installKind('linux', {}, '/opt/DubBitig/dubbitig', arch), 'pacman');
  assert.equal(installKind('linux', {}, '/opt/DubBitig/dubbitig', debian), 'deb');
  assert.equal(installKind('linux', {}, '/home/k/dubclo/node_modules/electron/dist/electron', arch), null);
  assert.equal(installKind('darwin', {}, '/Applications/DubBitig.app', none), null);
});

test('yalnızca projenin kendi sürüm dosyaları ve doğru paket seçilir', () => {
  const assets = releaseAssets({ assets: [...release.assets, { name: 'DubBitig-9.9.9-Setup.exe', size: 5, browser_download_url: 'https://evil.example/DubBitig-9.9.9-Setup.exe' }] });
  assert.equal(assets.length, 5);
  assert.equal(pickAsset(assets, 'nsis')?.name, 'DubBitig-1.10.0-Setup.exe');
  assert.equal(pickAsset(assets, 'appimage')?.name, 'DubBitig-1.10.0-x86_64.AppImage');
  assert.equal(pickAsset(assets, 'deb')?.name, 'DubBitig-1.10.0-amd64.deb');
  assert.equal(pickAsset(assets, 'pacman')?.name, 'DubBitig-1.10.0-x64.pacman');
  assert.equal(assets[0].digest, 'a'.repeat(64));
  assert.equal(releaseAssets({ assets: [{ ...release.assets[0], digest: 'md5:xyz' }] })[0].digest, null);
  assert.deepEqual(releaseAssets(null), []);
});

// Serves the given responses in order, like a redirect to GitHub's asset host followed by the file.
function server(responses: { status: number; location?: string; body?: Buffer }[], seen: string[] = []) {
  return (url: URL, callback: (response: IncomingMessage) => void) => {
    const next = responses.shift()!; seen.push(url.href);
    const response = Object.assign(new PassThrough(), { statusCode: next.status, headers: next.location ? { location: next.location } : {} }) as unknown as IncomingMessage;
    return { on: () => {}, setTimeout: () => {}, destroy: () => {}, end: () => { callback(response); (response as unknown as PassThrough).end(next.body ?? Buffer.alloc(0)); } };
  };
}
const file = Buffer.from('Yeni DubBitig kurulumu '.repeat(1000));
const asset = (over: Partial<ReleaseAsset> = {}): ReleaseAsset => ({ name: 'DubBitig-1.10.0-Setup.exe', url: release.assets[0].browser_download_url, size: file.length, digest: createHash('sha256').update(file).digest('hex'), ...over });

test('güncelleme yönlendirmeyle indirilir, boyut ve SHA-256 doğrulanınca yerine konur', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dubbitig-guncelleme-'));
  try {
    const seen: string[] = []; const progress: number[] = [];
    const path = await downloadAsset(asset(), join(dir, 'Setup.exe'), p => progress.push(p.done), server([{ status: 302, location: 'https://release-assets.githubusercontent.com/x?sig=1' }, { status: 200, body: file }], seen));
    assert.ok(readFileSync(path).equals(file));
    assert.equal(seen[1], 'https://release-assets.githubusercontent.com/x?sig=1');
    assert.equal(progress.at(-1), file.length);
    assert.deepEqual(readdirSync(dir), ['Setup.exe']);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('bozuk, eksik veya başka adrese yönlenen indirme kullanılmaz ve yarım dosya kalmaz', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dubbitig-guncelleme-'));
  const target = join(dir, 'Setup.exe');
  try {
    await assert.rejects(downloadAsset(asset({ digest: 'b'.repeat(64) }), target, undefined, server([{ status: 200, body: file }])), /SHA-256 farklı/);
    await assert.rejects(downloadAsset(asset(), target, undefined, server([{ status: 200, body: file.subarray(0, 100) }])), /boyutu yanlış/);
    await assert.rejects(downloadAsset(asset({ size: 10 }), target, undefined, server([{ status: 200, body: file }])), /beklenenden büyük/);
    await assert.rejects(downloadAsset(asset(), target, undefined, server([{ status: 302, location: 'https://evil.example/kurulum.exe' }])), /beklenmeyen bir adrese/);
    await assert.rejects(downloadAsset(asset(), target, undefined, server([{ status: 302, location: 'http://github.com/x' }])), /beklenmeyen bir adrese/);
    await assert.rejects(downloadAsset(asset(), target, undefined, server([{ status: 404 }])), /HTTP 404/);
    assert.equal(existsSync(target), false); assert.deepEqual(readdirSync(dir), []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
