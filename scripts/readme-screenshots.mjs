import { _electron as electron } from '@playwright/test';
import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
// Regenerates docs/screenshots from demo data in a throwaway folder. Run after npm run build.
const out = path.join(root, process.argv[2] ?? 'docs/screenshots');
const data = path.join(root, '.test-data', 'readme-data');
rmSync(data, { recursive: true, force: true }); mkdirSync(data, { recursive: true }); mkdirSync(out, { recursive: true });
const env = { ...process.env, SAKLI_DATA_DIR: data }; delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: ['.'], cwd: root, env });
const page = await app.firstWindow();
await page.waitForLoadState('networkidle');
await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.setContentSize(1440, 900); w.center(); });
await page.evaluate(async () => {
  const api = window.sakli; const day = 86400000;
  const base = { description: '', content: '', url: '', category: '', tags: [], favorite: false, assets: [] };
  const items = [
    { kind: 'link', title: 'MDN Web Docs', description: 'HTML, CSS ve JavaScript için başvuru kaynağı.', url: 'https://developer.mozilla.org/tr/', category: 'Kaynaklar', tags: ['web', 'belge'] },
    { kind: 'program', title: 'Everything', description: 'Anında dosya arama aracı.', url: 'https://www.voidtools.com/', content: '**Ctrl+Shift+E** ile hızlı arama.', category: 'Windows', tags: ['araç'] },
    { kind: 'note', title: 'Haftalık plan', description: 'Bu hafta üzerinde çalışılacak konular.', content: '## Yapılacaklar\n\n- Yedekleri başka diske kopyala\n- **DubBitig** kategorilerini düzenle', category: 'Kişisel', tags: ['plan'], reminder: { at: new Date(Date.now() + 2 * day).toISOString(), repeat: 'weekly', enabled: true } },
    { kind: 'command', title: 'Git son commit geri al', description: 'Değişiklikleri koruyarak son commit’i geri alır.', content: 'git reset --soft HEAD~1', category: 'Geliştirme', tags: ['git'], language: 'bash' },
    { kind: 'link', title: 'Türkçe yazım kılavuzu', description: 'Yazım ve noktalama kuralları.', url: 'https://www.tdk.gov.tr/', category: 'Kaynaklar', tags: ['dil'], favorite: true },
    { kind: 'note', title: 'Alışveriş listesi', content: '- Süt\n- Ekmek\n- Kahve', tags: ['ev'], expiresAt: new Date(Date.now() + 3 * day).toISOString() },
    { kind: 'command', title: 'DNS önbelleğini temizle', description: 'Ağ sorunlarında ilk denenecek komut.', content: 'ipconfig /flushdns', category: 'Windows', tags: ['ağ', 'sistem'], language: 'dos' },
    { kind: 'command', title: 'Çalışan işlemleri listele', description: 'PowerShell ile işlemleri bellek kullanımına göre sıralar.', content: 'Get-Process | Sort-Object WorkingSet -Descending | Select-Object -First 10', category: 'Windows', tags: ['powershell', 'sistem'], favorite: true, language: 'powershell' },
  ];
  for (const item of items) { await api.save({ ...base, ...item }); await new Promise(r => setTimeout(r, 15)); }
  const old = await api.save({ ...base, kind: 'note', title: 'Eski not', content: 'Silinecek' }); await api.trash(old.id);
  await api.backup();
});
await page.reload(); await page.waitForLoadState('networkidle'); await page.waitForTimeout(500);
const wait = () => page.waitForTimeout(400);
await page.getByRole('button', { name: 'Çalışan işlemleri listele kaydını aç' }).click(); await page.mouse.move(0, 0); await wait();
await page.screenshot({ path: path.join(out, 'ana-ekran.png'), animations: 'disabled' });
await page.getByRole('combobox', { name: 'Arşivde ara' }).fill('win'); await wait();
await page.screenshot({ path: path.join(out, 'arama.png'), animations: 'disabled', clip: { x: 248, y: 0, width: 1192, height: 520 } });
await page.getByRole('combobox', { name: 'Arşivde ara' }).fill(''); await page.keyboard.press('Escape');
await page.getByRole('button', { name: 'Ayrıntıları kapat' }).click();
await page.getByRole('button', { name: /^Yeni kayıt/ }).click();
await page.getByRole('group', { name: 'Kayıt türü' }).getByRole('button', { name: 'Not', exact: true }).click();
await page.getByRole('textbox', { name: 'Başlık' }).fill('Proje fikirleri');
await page.getByRole('textbox', { name: 'Açıklama' }).fill('Hafta sonu denenecekler');
await page.getByRole('textbox', { name: 'İçerik', exact: true }).fill('## Fikirler\n\n- Ev otomasyonu paneli\n- **DubBitig** için yeni şablonlar\n\n```powershell\nGet-ChildItem -Recurse\n```');
await page.getByRole('combobox', { name: 'Kategori', exact: true }).fill('Kişisel');
await page.getByRole('button', { name: 'plan etiketini kayda ekle' }).click(); await wait();
await page.evaluate(() => { document.querySelector('.archive-dialog').scrollTop = 0; }); await wait();
await page.getByRole('dialog').screenshot({ path: path.join(out, 'yeni-kayit.png'), animations: 'disabled' });
await page.getByRole('button', { name: 'Pencereyi kapat' }).click(); await page.getByRole('button', { name: 'Kaydetmeden çık' }).click();
// Keep the author's real profile path out of published screenshots.
const mask = () => page.evaluate(() => document.querySelectorAll('.data-location code').forEach(el => { const base = String.raw`C:\Users\Kullanıcı\AppData\Roaming\DubBitig`; el.textContent = /backups$/.test(el.textContent) ? base + String.raw`\backups` : base; }));
await page.getByRole('button', { name: 'Ayarlar ve yedekler', exact: true }).click(); await wait();
await page.getByRole('dialog').screenshot({ path: path.join(out, 'genel-ayarlar.png'), animations: 'disabled' });
await page.getByRole('tab', { name: 'Yedekleme', exact: true }).click(); await wait(); await mask();
await page.getByRole('dialog').screenshot({ path: path.join(out, 'yedekleme.png'), animations: 'disabled' });
await page.getByRole('tab', { name: 'Veriler', exact: true }).click(); await wait();
await mask();
await page.getByRole('dialog').screenshot({ path: path.join(out, 'veri-yonetimi.png'), animations: 'disabled' });
await page.getByRole('tab', { name: 'Hakkında', exact: true }).click(); await wait();
await page.getByRole('dialog').screenshot({ path: path.join(out, 'hakkinda.png'), animations: 'disabled' });
await page.keyboard.press('Escape'); await wait();
// Exercise the new trash flow end to end.
await page.getByRole('button', { name: /^Çöp kutusu/ }).click();
await page.getByRole('button', { name: 'Çöp kutusunu boşalt' }).click(); await wait();
await page.getByRole('dialog').getByRole('button', { name: 'Çöp kutusunu boşalt' }).click();
await page.getByRole('heading', { name: 'Çöp kutusu boş' }).waitFor();
const left = await page.evaluate(async () => (await window.sakli.snapshot()).entries.filter(e => e.deletedAt).length);
console.log('trash left:', left);
await app.close();
