import { app } from 'electron';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fetchPublic } from './web.js';
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
    cached = { current, latest, available: newerVersion(latest, current), url, notes: String(data.body ?? '').slice(0, 4000), checkedAt };
  } catch (error) {
    cached = { current, latest: cached?.latest ?? null, available: cached?.available ?? false, url: cached?.url ?? releases + '/latest', notes: cached?.notes ?? '', checkedAt, error: error instanceof Error ? error.message : String(error) };
  }
  return cached;
}
