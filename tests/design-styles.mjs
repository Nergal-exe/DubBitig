// Tasarım temaları: Ayarlar → Genel'deki seçici stili uygular, seçim yeniden başlatmada korunur ve her stilde
// ana düğme vurgu rengiyle dolu, metni okunur kalır. SAKLI_TEST_EXE / SAKLI_TEST_ELECTRON desktop testleriyle aynıdır.
import { _electron as electron, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
const root = process.cwd();
const data = path.join(root, '.test-data', `design-styles-${Date.now()}`); mkdirSync(data, { recursive: true });
const env = { ...process.env, SAKLI_DATA_DIR: data }; delete env.ELECTRON_RUN_AS_NODE;
const exe = process.env.SAKLI_TEST_EXE ?? process.env.SAKLI_TEST_ELECTRON;
const launch = () => electron.launch({ ...(exe ? { executablePath: exe, args: process.env.SAKLI_TEST_EXE ? [] : ['.'] } : { args: ['.'] }), cwd: root, env });
const styles = { dubbitig: 'DubBitig (varsayılan)', fluent: 'Fluent Design (Windows 11)', macos: 'macOS / Native UI', material: 'Material Design 3' };
// Visual effects declared in docs/design-dna/*.json: glass only where the DNA enables it.
const glass = { dubbitig: false, fluent: false, macos: true, material: false };
let app = await launch();
try {
  let page = await app.firstWindow(); await page.waitForLoadState('networkidle');
  await expect(page.locator('html')).toHaveAttribute('data-style', 'dubbitig');
  await page.evaluate(() => window.sakli.save({ title: 'Bağlantı kaydı', kind: 'link', url: 'https://example.com/', description: '', content: '', category: '', tags: [], favorite: false, assets: [] }));
  await page.reload(); await page.waitForLoadState('networkidle');
  for (const theme of ['Koyu', 'Açık']) {
    await page.getByRole('button', { name: theme, exact: true }).click();
    for (const [style, label] of Object.entries(styles)) {
      await page.getByRole('button', { name: 'Ayarlar' }).first().click();
      const picker = page.getByRole('combobox', { name: 'Tema' });
      await expect(picker.locator('option')).toHaveText(Object.values(styles));
      await picker.selectOption({ label });
      await expect(page.locator('html')).toHaveAttribute('data-style', style);
      await expect(picker).toHaveValue(style);
      // The panel ignores Escape while it saves (busy); wait until the picker is enabled again.
      await expect(picker).toBeEnabled();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog', { name: 'Ayarlar ve yedekler' })).toHaveCount(0);
      const sidebarBlur = await page.locator('.sidebar').evaluate(el => getComputedStyle(el).backdropFilter);
      if ((sidebarBlur !== 'none') !== glass[style]) throw new Error(`${style}: kenar çubuğu cam efekti DNA ile uyuşmuyor (${sidebarBlur})`);
      await page.getByRole('heading', { name: 'Bağlantı kaydı' }).click();
      // The main action must be filled with the accent and its label must differ from the fill.
      const look = await page.getByRole('button', { name: 'Bağlantıyı aç' }).evaluate(el => { const s = getComputedStyle(el); const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(); const probe = document.createElement('i'); probe.style.color = accent; document.body.append(probe); const rgb = getComputedStyle(probe).color; probe.remove(); return { bg: s.backgroundColor, image: s.backgroundImage, color: s.color, accent: rgb }; });
      if (look.bg !== look.accent && !look.image.includes('gradient')) throw new Error(`${style}/${theme}: ana düğme vurgu rengiyle dolu değil (${look.bg})`);
      if (look.color === look.bg) throw new Error(`${style}/${theme}: ana düğmenin yazısı görünmüyor`);
      await page.keyboard.press('Escape');
    }
  }
  await page.getByRole('button', { name: 'Ayarlar' }).first().click();
  await page.getByRole('combobox', { name: 'Tema' }).selectOption('material');
  await expect(page.locator('html')).toHaveAttribute('data-style', 'material');
  await app.close();
  app = await launch(); page = await app.firstWindow(); await page.waitForLoadState('networkidle');
  await expect(page.locator('html')).toHaveAttribute('data-style', 'material');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  console.log('PASS: dört tasarım teması açık/koyu, açılır menü, DNA cam efektleri, ana düğme okunurluğu, yeniden başlatmada korunma.');
} finally { await app.close().catch(() => {}); }
