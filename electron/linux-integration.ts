import { app } from 'electron';
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { geckoManifestDirs } from './browser-hosts.js';

const quote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`;
const chromiumProfiles = ['google-chrome', 'google-chrome-beta', 'chromium', 'BraveSoftware/Brave-Browser', 'microsoft-edge', 'vivaldi'];

/**
 * Linux has no installer registry, so each start (re)writes the per-user native-messaging manifests
 * for the browsers that are present. AppImage paths change between versions; this keeps them current.
 */
export function registerLinuxBrowserHost(dataPath: string) {
  if (process.platform !== 'linux' || !app.isPackaged) return;
  const source = join(process.resourcesPath, 'native-host'); const hostDir = join(dataPath, 'native-host');
  mkdirSync(hostDir, { recursive: true });
  copyFileSync(join(source, 'native-host.cjs'), join(hostDir, 'native-host.cjs'));
  // An AppImage is mounted at a temporary path; the launcher must point at the .AppImage file itself.
  const exe = process.env.APPIMAGE ?? process.execPath;
  const wrapper = join(hostDir, 'dubbitig-native-host');
  writeFileSync(wrapper, `#!/bin/sh\nexport ELECTRON_RUN_AS_NODE=1\nexport DUBBITIG_CAPTURE_EXE=${quote(exe)}\nexport DUBBITIG_DATA_DIR=${quote(dataPath)}\nexec ${quote(exe)} ${quote(join(hostDir, 'native-host.cjs'))} "$@"\n`);
  chmodSync(wrapper, 0o755);
  const chrome = { ...JSON.parse(readFileSync(join(source, 'com.dubbitig.capture.json'), 'utf8')), path: wrapper };
  const firefox = { ...JSON.parse(readFileSync(join(source, 'com.dubbitig.capture.firefox.json'), 'utf8')), path: wrapper };
  // The host verifies callers against these copies.
  writeFileSync(join(hostDir, 'com.dubbitig.capture.json'), JSON.stringify(chrome, null, 2));
  writeFileSync(join(hostDir, 'com.dubbitig.capture.firefox.json'), JSON.stringify(firefox, null, 2));
  const config = process.env.XDG_CONFIG_HOME || join(homedir(), '.config');
  for (const profile of chromiumProfiles) {
    if (!existsSync(join(config, profile))) continue;
    const folder = join(config, profile, 'NativeMessagingHosts'); mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, 'com.dubbitig.capture.json'), JSON.stringify(chrome, null, 2));
  }
  for (const folder of geckoManifestDirs(homedir(), config, existsSync)) {
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, 'com.dubbitig.capture.json'), JSON.stringify(firefox, null, 2));
  }
}
