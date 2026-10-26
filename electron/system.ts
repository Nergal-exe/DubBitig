import { app } from 'electron';
import { chmodSync, existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { spawn } from 'node:child_process';
import { fetchPublic } from './web.js';
import { downloadAsset, installKind, pickAsset, releaseAssets, type DownloadProgress, type InstallKind, type ReleaseAsset } from './update.js';
import type { UpdateInfo } from '../src/shared/model.js';

// Starting at login only makes sense for an installed copy; dev and test runs would register electron.exe.
export const loginSupported = () => app.isPackaged && !process.env.PORTABLE_EXECUTABLE_FILE && !process.env.SAKLI_DATA_DIR && !process.env.DUBBITIG_DATA_DIR;
const autostartFile = () => join(app.getPath('appData'), 'autostart', 'dubbitig.desktop');
const loginArgs = ['--hidden'];
export function openAtLogin() {
  if (!loginSupported()) return false;
  return process.platform === 'linux' ? existsSync(autostartFile()) : app.getLoginItemSettings({ args: loginArgs }).openAtLogin;
}
export function setOpenAtLogin(enabled: boolean) {
  if (!loginSupported()) throw new Error('Otomatik başlatma yalnızca kurulu sürümde kullanılabilir.');
  if (process.platform === 'linux') {
    const file = autostartFile();
    if (!enabled) { rmSync(file, { force: true }); return; }
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `[Desktop Entry]\nType=Application\nName=DubBitig\nComment=Kişisel bilgi arşivi\nExec="${process.env.APPIMAGE ?? process.execPath}" --hidden\nIcon=dubbitig\nX-GNOME-Autostart-enabled=true\n`);
    return;
  }
  app.setLoginItemSettings({ openAtLogin: enabled, args: loginArgs });
}
// A login start opens straight into the tray instead of showing the window.
export const startedHidden = (argv: string[]) => argv.includes('--hidden');

const releases = 'https://github.com/Nergal-exe/DubBitig/releases';
export function newerVersion(candidate: string, current: string) {
  const a = candidate.split('.').map(n => parseInt(n, 10) || 0), b = current.split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  return false;
}
let cached: UpdateInfo | undefined;
let assets: ReleaseAsset[] = [];
// The asset this installation can update itself with, or null when only the download page applies.
export function updatePlan() {
  const kind = installKind(process.platform, process.env, process.execPath);
  const asset = kind && pickAsset(assets, kind);
  return app.isPackaged && kind && asset && cached?.available && cached.latest ? { kind, asset, latest: cached.latest } : null;
}
export async function checkUpdate(force = false): Promise<UpdateInfo> {
  if (cached && !cached.error && !force && Date.now() - new Date(cached.checkedAt).getTime() < 6 * 3600 * 1000) return cached;
  const current = app.getVersion(); const checkedAt = new Date().toISOString();
  try {
    const response = await fetchPublic('https://api.github.com/repos/Nergal-exe/DubBitig/releases/latest', { limit: 512 * 1024 });
    if (response.status !== 200) throw new Error(`GitHub yanıt vermedi (HTTP ${response.status}).`);
    const data = JSON.parse(response.bytes.toString('utf8'));
    const latest = String(data.tag_name ?? '').replace(/^v/i, '');
    if (!/^\d+\.\d+\.\d+/.test(latest)) throw new Error('Sürüm bilgisi okunamadı.');
    // Only the project's own release page is ever opened from this data.
    const url = typeof data.html_url === 'string' && data.html_url.startsWith(releases + '/') ? data.html_url : releases + '/latest';
    assets = releaseAssets(data);
    cached = { current, latest, available: newerVersion(latest, current), url, notes: String(data.body ?? '').slice(0, 4000), checkedAt };
    cached.installable = !!updatePlan();
  } catch (error) {
    cached = { current, latest: cached?.latest ?? null, available: cached?.available ?? false, url: cached?.url ?? releases + '/latest', notes: cached?.notes ?? '', checkedAt, error: error instanceof Error ? error.message : String(error) };
  }
  return cached;
}
const run = (command: string, args: string[]) => new Promise<number>((resolve, reject) => { const child = spawn(command, args, { stdio: 'ignore' }); child.on('error', reject); child.on('exit', code => resolve(code ?? 1)); });
/**
 * Downloads and verifies the update, then installs it. Resolves with how to relaunch; the caller quits the app.
 * Windows: the NSIS setup runs silently after this process exits (asks for administrator rights) and restarts DubBitig.
 * AppImage: the file is replaced in place. deb/pacman: the system package manager installs it through pkexec.
 */
export async function installUpdate(plan: { kind: InstallKind; asset: ReleaseAsset }, progress: (value: DownloadProgress) => void): Promise<{ relaunch?: { execPath: string; args: string[] } }> {
  const { kind, asset } = plan;
  if (kind === 'appimage') {
    const target = process.env.APPIMAGE!;
    let file: string;
    try { file = await downloadAsset(asset, target + '.yeni', progress); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'EACCES') throw new Error(`AppImage klasörüne yazılamıyor (${dirname(target)}). Yeni sürümü indirme sayfasından alabilirsin.`); throw error; }
    chmodSync(file, 0o755); renameSync(file, target);
    return { relaunch: { execPath: target, args: [] } };
  }
  const file = await downloadAsset(asset, join(app.getPath('temp'), asset.name), progress);
  if (kind === 'nsis') {
    spawn(file, ['/S', '--updated', '--force-run'], { detached: true, stdio: 'ignore' }).unref();
    return {};
  }
  const code = await run('pkexec', kind === 'pacman' ? ['/usr/bin/pacman', '-U', '--noconfirm', file] : ['/usr/bin/apt-get', 'install', '-y', file]).catch(() => -1);
  rmSync(file, { force: true });
  if (code === 126 || code === 127) throw new Error('Yönetici izni verilmedi; güncelleme kurulmadı.');
  if (code !== 0) throw new Error(`Paket kurulamadı (çıkış kodu ${code}). Terminalde elle kurabilirsin: ${kind === 'pacman' ? 'sudo pacman -U' : 'sudo apt install'} ${asset.name}`);
  // The package may move the program folder (e.g. /opt/dubbitig → /opt/DubBitig); the launcher link stays put.
  return { relaunch: { execPath: existsSync('/usr/bin/dubbitig') ? '/usr/bin/dubbitig' : process.execPath, args: [] } };
}
