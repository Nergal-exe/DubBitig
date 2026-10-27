import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { geckoManifestDirs } from '../electron/browser-hosts';

const home = '/home/k'; const config = join(home, '.config');
const only = (...paths: string[]) => (p: string) => paths.includes(p);
const hosts = (...roots: string[]) => roots.map(r => join(r, 'native-messaging-hosts'));

test('Firefox ailesi tarayıcılar için yerel bağlantı klasörleri doğru seçilir', () => {
  // Zen (XDG ~/.config/zen) with XDG Firefox: the case that failed with "No such native application".
  assert.deepEqual(geckoManifestDirs(home, config, only(join(config, 'zen'), join(config, 'mozilla'))), hosts(join(config, 'mozilla'), join(config, 'zen')));
  // Zen alone still gets Gecko's shared XDG directory.
  assert.deepEqual(geckoManifestDirs(home, config, only(join(config, 'zen'))), hosts(join(config, 'zen'), join(config, 'mozilla')));
  // Legacy Firefox profile only.
  assert.deepEqual(geckoManifestDirs(home, config, only(join(home, '.mozilla'))), hosts(join(home, '.mozilla'), join(config, 'mozilla')));
  assert.ok(geckoManifestDirs(home, config, only(join(home, '.librewolf'))).includes(join(home, '.librewolf', 'native-messaging-hosts')));
  // No Gecko browser: nothing is created.
  assert.deepEqual(geckoManifestDirs(home, config, () => false), []);
});
