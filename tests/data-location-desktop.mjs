// Ayarlar → Veriler → Veri konumunu değiştir akışı. Yerel klasör seçme ve onay pencereleri ana süreçte taklit edilir.
// SAKLI_TEST_EXE paketlenmiş uygulamayı, SAKLI_TEST_ELECTRON ise sistemdeki Electron'u (ör. /usr/bin/electron44) kullanır.
import { _electron as electron, expect } from '@playwright/test';
import { mkdirSync, writeFileSync, existsSync, readFileSync, readdirSync, cpSync } from 'node:fs';
import { hostname } from 'node:os';
import path from 'node:path';
const root = process.cwd();
const base = path.join(root, '.test-data', `data-location-${Date.now()}`);
const data = path.join(base, 'profil'); const shared = path.join(base, 'Ortak Disk', 'DubBitig Verisi');
mkdirSync(data, { recursive: true }); mkdirSync(shared, { recursive: true }); mkdirSync(path.join(root, 'test-results'), { recursive: true });
const photo = path.join(base, 'Deniz kıyısı ğüşç.png');
writeFileSync(photo, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64'));
const env = { ...process.env, SAKLI_DATA_DIR: data }; delete env.ELECTRON_RUN_AS_NODE;
const exe = process.env.SAKLI_TEST_EXE ?? process.env.SAKLI_TEST_ELECTRON;
const launch = () => electron.launch({ ...(exe ? { executablePath: exe, args: process.env.SAKLI_TEST_EXE ? [] : ['.'] } : { args: ['.'] }), cwd: root, env });
const stubDialogs = (app, folder) => app.evaluate(({ dialog, app }, { folder, photo }) => {
  globalThis.shownDialogs = [];
  dialog.showOpenDialog = async (_window, options) => ({ canceled: false, filePaths: [options.properties.includes('openDirectory') ? folder : photo] });
  dialog.showMessageBox = async (_window, options) => { globalThis.shownDialogs.push(options.title); return { response: 1, checkboxChecked: false }; };
  app.relaunch = () => {};
}, { folder, photo });
const openData = async page => {
  await page.getByRole('button', { name: 'Ayarlar' }).first().click();
  await page.getByRole('tab', { name: 'Veriler' }).click();
};

let app = await launch();
try {
  let page = await app.firstWindow(); await page.waitForLoadState('networkidle');
  await stubDialogs(app, shared);
  const entry = await page.evaluate(async () => { const [asset] = await window.sakli.addPhotos(); return window.sakli.save({ title: 'Ortak klasör kaydı', kind: 'note', description: '', content: 'Windows ve Linux', category: '', tags: [], url: '', favorite: false, assets: [asset] }); });
  await page.reload(); await page.waitForLoadState('networkidle');
  await openData(page);
  await expect(page.locator('.data-location code').first()).toHaveText(data);
  await expect(page.getByText('Varsayılan', { exact: true })).toBeVisible();
  await page.screenshot({ animations: 'disabled', path: 'test-results/data-location-before.png' });
  const closed = new Promise(resolve => app.once('close', resolve));
  await page.getByRole('button', { name: 'Veri konumunu değiştir' }).click();
  await closed;
  const pointer = JSON.parse(readFileSync(path.join(data, 'data-location.json'), 'utf8'));
  if (pointer.path !== shared || pointer.previous !== data) throw new Error('Veri konumu ayarı yanlış: ' + JSON.stringify(pointer));
  if (!existsSync(path.join(shared, 'sakli.sqlite')) || readdirSync(path.join(shared, 'photos')).length !== 1) throw new Error('Yeni konum eksik.');
  if (!existsSync(path.join(data, 'sakli.sqlite'))) throw new Error('Eski veri silinmemeliydi.');
  if (readdirSync(shared).some(name => name.startsWith('.dubbitig-hazirlik'))) throw new Error('Hazırlık klasörü kaldı.');

  app = await launch(); page = await app.firstWindow(); await page.waitForLoadState('networkidle');
  const snapshot = await page.evaluate(() => window.sakli.snapshot());
  if (snapshot.entries.length !== 1 || snapshot.entries[0].id !== entry.id) throw new Error('Kayıt yeni konumda bulunamadı.');
  const image = await page.evaluate(id => window.sakli.image(id), entry.assets[0].id);
  if (!image.startsWith('data:image/png;base64,')) throw new Error('Fotoğraf yeni konumda açılmadı.');
  if (!existsSync(path.join(shared, 'dubbitig.lock'))) throw new Error('Veri klasörü kilidi yok.');
  await openData(page);
  await expect(page.locator('.data-location code').first()).toHaveText(shared);
  await expect(page.getByText('Özel konum', { exact: true })).toBeVisible();
  await expect(page.getByText('Eski veri kopyası duruyor')).toBeVisible();
  await page.screenshot({ animations: 'disabled', path: 'test-results/data-location-after.png' });
  // Selecting the current folder again is refused with a clear message.
  await stubDialogs(app, shared);
  await page.getByRole('button', { name: 'Veri konumunu değiştir' }).click();
  await expect(page.getByText('Seçtiğin klasör zaten şu anki veri konumu.')).toBeVisible();
  // An archive whose lock was left behind by the other OS (e.g. Linux rebooted while DubBitig was open).
  const other = path.join(base, 'Diğer Disk', 'DubBitig');
  cpSync(shared, other, { recursive: true });
  writeFileSync(path.join(other, 'dubbitig.lock'), JSON.stringify({ id: 'diger-sistem', pid: 4242, platform: process.platform === 'win32' ? 'linux' : 'win32', hostname: hostname(), startedAt: new Date().toISOString() }));
  await stubDialogs(app, other);
  const switched = new Promise(resolve => app.once('close', resolve));
  await page.getByRole('button', { name: 'Veri konumunu değiştir' }).click();
  await switched;
  if (JSON.parse(readFileSync(path.join(data, 'data-location.json'), 'utf8')).path !== other) throw new Error('Kilit uyarısından sonra geçiş yapılmadı.');
  if (JSON.parse(readFileSync(path.join(other, 'dubbitig.lock'), 'utf8')).platform !== process.platform) throw new Error('Kilit devralınmadı.');
  if (existsSync(path.join(shared, 'dubbitig.lock'))) throw new Error('Kilit kapanışta kaldırılmadı.');
  // The restart must not stop at a second lock warning (that would block before the window opens).
  app = await launch(); page = await app.firstWindow(); await page.waitForLoadState('networkidle');
  if ((await page.evaluate(() => window.sakli.settings())).dataPath !== other) throw new Error('Yeni klasör kullanılmıyor.');
  // Logging out or rebooting Linux sends SIGTERM; the lock must not be left behind.
  const terminated = new Promise(resolve => app.once('close', resolve));
  app.process().kill('SIGTERM');
  await terminated;
  if (existsSync(path.join(other, 'dubbitig.lock'))) throw new Error('SIGTERM ile kapanışta kilit kaldı.');
  console.log('Veri konumu masaüstü testi geçti:', base);
} catch (error) { await app.close().catch(() => {}); throw error; }
