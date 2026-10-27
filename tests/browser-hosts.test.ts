import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { geckoManifestDirs } from '../electron/browser-hosts';

const home = '/home/k'; const config = join(home, '.config');
const only = (...paths: string[]) => (p: string) => paths.includes(p);
const shared = join(home, '.mozilla', 'native-messaging-hosts');

test('Firefox ailesi tarayıcılar için yerel bağlantı ~/.mozilla altına yazılır', () => {
  // Zen and Firefox with XDG profiles (~/.config/zen, ~/.config/mozilla) and no ~/.mozilla: the "No such native application" case.
  assert.deepEqual(geckoManifestDirs(home, config, only(join(config, 'zen'), join(config, 'mozilla'))), [shared]);
  assert.deepEqual(geckoManifestDirs(home, config, only(join(config, 'zen'))), [shared]);
  assert.deepEqual(geckoManifestDirs(home, config, only(join(home, '.mozilla'))), [shared]);
  // A fork with its own user directory also gets a copy there.
  assert.deepEqual(geckoManifestDirs(home, config, only(join(home, '.librewolf'))), [shared, join(home, '.librewolf', 'native-messaging-hosts')]);
  // No Gecko browser: nothing is created.
  assert.deepEqual(geckoManifestDirs(home, config, () => false), []);
});
