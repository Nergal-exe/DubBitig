import { _electron as electron, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
const root = process.cwd();
const data = path.join(root, '.test-data', `features18-${Date.now()}`);
mkdirSync(data, { recursive: true });
const env = { ...process.env, SAKLI_DATA_DIR: data }; delete env.ELECTRON_RUN_AS_NODE;
const exe = process.env.SAKLI_TEST_EXE;
const app = await electron.launch({ ...(exe ? { executablePath: exe, args: [] } : { args: ['.'] }), cwd: root, env });
const errors = [];
try {
  const page = await app.firstWindow(); page.on('pageerror', e => errors.push(e.message));
  await page.waitForLoadState('networkidle');
  // The photo record type is gone from navigation and the type picker.
  await expect(page.getByRole('button', { name: /^Fotoğraflar/ })).toHaveCount(0);
  const kindsInNav = await page.locator('.sidebar .nav-kind').count(); expect(kindsInNav).toBe(6);
  await expect(page.getByRole('button', { name: /^Diziler\/Filmler/ })).toHaveCount(1); await expect(page.getByRole('button', { name: /^Kitaplar/ })).toHaveCount(1);

  // Bare addresses get https:// and duplicates are refused.
  await page.getByRole('button', { name: 'Yeni kayıt' }).click();
  const editor = page.getByRole('dialog', { name: 'Yeni kayıt' });
  await editor.getByRole('group', { name: 'Kayıt türü' }).getByRole('button', { name: 'Program', exact: true }).click();
  await editor.getByRole('textbox', { name: 'Programın web sitesi' }).fill('voidtools.com');
  await expect(editor.getByText('https://voidtools.com', { exact: true })).toBeVisible();
  await editor.getByRole('textbox', { name: 'Başlık' }).fill('Everything');
  await editor.getByRole('combobox', { name: 'Kategori', exact: true }).fill('Araçlar');
  await editor.getByRole('button', { name: 'Kaydet', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Everything' })).toBeVisible();
  expect((await page.evaluate(() => window.sakli.snapshot())).entries[0].url).toBe('https://voidtools.com');

  await page.getByRole('button', { name: 'Yeni kayıt' }).click();
  await editor.getByRole('textbox', { name: 'Başlık' }).fill('everything');
  await expect(editor.getByRole('alert').filter({ hasText: 'Bu başlıkla bir kayıt zaten var' })).toBeVisible();
  await editor.getByRole('button', { name: 'Kaydet', exact: true }).click();
  await expect(editor.locator('.form-error')).toContainText('zaten var');
  // Category typeahead suggests the existing category.
  await editor.getByRole('combobox', { name: 'Kategori', exact: true }).fill('ara');
  await editor.getByRole('option', { name: /Araçlar/ }).click();
  await expect(editor.getByRole('combobox', { name: 'Kategori', exact: true })).toHaveValue('Araçlar');

  // Modeless: settings opens beside the unsaved editor and the main window stays usable.
  await page.getByRole('button', { name: 'Ayarlar ve yedekler', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(2);
  await page.getByRole('button', { name: 'Liste görünümü' }).click();
  await expect(page.locator('.entries.list')).toBeVisible();
  const settings = page.getByRole('dialog', { name: 'Ayarlar ve yedekler' });
  await expect(settings.getByRole('tab').first()).toHaveText('Genel');
  await settings.getByRole('combobox', { name: 'Kapatma davranışı' }).selectOption('minimize');
  await expect.poll(async () => (await page.evaluate(() => window.sakli.settings())).closeAction).toBe('minimize');
  await settings.getByRole('tab', { name: 'Yedekleme', exact: true }).click();
  await expect(settings.getByRole('button', { name: 'Yedek klasörünü aç' })).toBeVisible();
  await settings.getByRole('combobox', { name: 'Yedekleme sıklığı' }).selectOption('daily');
  await settings.getByLabel('Yedekleme saati').fill('21:30');
  await expect.poll(async () => (await page.evaluate(() => window.sakli.settings())).backupTime).toBe('21:30');
  await settings.getByRole('tab', { name: 'Veriler', exact: true }).click();
  await expect(settings.getByRole('button', { name: 'Dosyadan geri yükle' })).toHaveCount(0);
  await settings.getByRole('tab', { name: 'Hakkında', exact: true }).click();
  await expect(settings.locator('.update-card')).toBeVisible();
  await settings.getByRole('button', { name: 'Pencereyi kapat' }).click();
  await editor.getByRole('button', { name: 'Pencereyi kapat' }).click();
  await editor.getByRole('button', { name: 'Kaydetmeden çık' }).click();

  // Global search suggests categories and applies them as a filter.
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('combobox', { name: 'Arşivde ara' }).fill('arac');
  await page.locator('.search-box').getByRole('option', { name: /Araçlar/ }).click();
  await expect(page.locator('.filter-chip')).toContainText('Araçlar');
  await expect(page.getByRole('combobox', { name: 'Arşivde ara' })).toHaveValue('');
  expect(errors).toEqual([]);
  console.log('PASS: no photo type, https:// completion, duplicate guard, typeahead, modeless windows, settings order, close action, backup time and folder, about/update.');
} finally { await app.close(); }
