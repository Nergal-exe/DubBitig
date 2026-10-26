import { app, BrowserWindow, ipcMain, dialog, clipboard, shell, Menu, nativeTheme, nativeImage, Notification, globalShortcut, Tray } from 'electron';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, statSync, mkdirSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { SQLiteRepository, atomicWrite } from './repository.js';
import { ArchiveService, MAX_ARCHIVE } from './service.js';
import { transferScopeSchema } from '../src/shared/model.js';
import { captureFile, clipboardRequest, saveCapture, drainInbox } from './capture.js';
import { migrateDataLocation, resolveDataLocation, recoverRelocation, problemText, planRelocation, relocate, inspectArchive, findArchive, writePointer, readPointer, clearPrevious, lockOwner, acquireLock, releaseLock, hasArchive, samePath, formatBytes, minimumSpace, DATA_ITEMS } from './data-location.js';
import { registerLinuxBrowserHost } from './linux-integration.js';
import { checkUpdate, installUpdate, loginSupported, openAtLogin, setOpenAtLogin, startedHidden, updatePlan } from './system.js';
import type { Entry, RelocationProgress } from '../src/shared/model.js';
import type { LockInfo } from './data-location.js';

const here = dirname(fileURLToPath(import.meta.url));
// Windows uses the .ico; Linux trays and windows need a PNG.
const appIcon = join(here, '../../dist', process.platform === 'win32' ? 'qqwe.ico' : 'icon.png');
let tray: Tray | undefined;
let quitting = false;
let service: ArchiveService;
let window: BrowserWindow;
let timer: ReturnType<typeof setInterval>;
let inboxTimer: ReturnType<typeof setInterval>;
let updateTimer: ReturnType<typeof setInterval> | undefined;
let receiveArgs: ((args: string[]) => Promise<void>) | undefined;
const pendingArgs: string[][] = [process.argv];
// Set while the data folder is being moved: writes are refused and timers pause.
let maintenance = false;
let lock: { dir: string; id: string } | undefined;
const platformName = (value: string) => value === 'win32' ? 'Windows' : value === 'linux' ? 'Linux' : value === 'darwin' ? 'macOS' : value;
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);
// Another OS cannot check whether the lock's process still runs, so a lock left by an unclean shutdown needs the user's word.
const lockWarning = (dir: string, owner: LockInfo) => ({ type: 'warning' as const, title: 'Veri klasörü kullanımda olabilir', message: 'Bu veri klasörünü başka bir DubBitig kullanıyor olabilir.', detail: `${dir}\nSon açan: ${platformName(owner.platform)} · ${owner.hostname} · ${new Date(owner.startedAt).toLocaleString('tr-TR')}\n\nİki DubBitig aynı klasörü birlikte kullanırsa birinin değişiklikleri kaybolabilir. Diğer işletim sistemi hazırda bekletmedeyse veya Hızlı Başlatma ile kapatıldıysa önce oraya dönüp DubBitig’i kapat ve sistemi tamamen kapat.\n\nDiğer sistemde DubBitig açıkken bilgisayar yeniden başlatıldıysa bu kilit geride kalmış olabilir. Diğer DubBitig’in kapalı olduğundan eminsen devam edebilirsin.`, buttons: ['Vazgeç', 'Diğer DubBitig kapalı, devam et'], defaultId: 0, cancelId: 0 });
const releaseDataLock = () => { if (lock) { releaseLock(lock.dir, lock.id); lock = undefined; } };
// Resolves the archive folder before anything is opened. An unreachable custom folder (e.g. an unmounted NTFS
// partition) is never replaced by a new empty archive; the user decides what to do.
async function openDataLocation(root: string): Promise<string | undefined> {
  try {
    const recovered = recoverRelocation(root);
    if (recovered?.state === 'rolled-back') dialog.showMessageBoxSync({ type: 'warning', title: 'Veri konumu değiştirilmedi', message: 'Önceki veri konumu değiştirme işlemi yarıda kalmıştı.', detail: `Mevcut veri klasörü değişmeden kullanılmaya devam ediyor. Yarım kalan kopya ${recovered.target} klasöründen kaldırıldı. Taşımayı Ayarlar → Veriler bölümünden yeniden başlatabilirsin.`, buttons: ['Tamam'] });
  } catch (error) { dialog.showErrorBox('Yarım kalan taşıma', errorText(error)); }
  for (;;) {
    const location = resolveDataLocation(root);
    if (!location.problem) {
      const owner = lockOwner(location.dir);
      if (owner && dialog.showMessageBoxSync({ ...lockWarning(location.dir, owner), buttons: ['Çık', 'Diğer DubBitig kapalı, devam et'] }) !== 1) return undefined;
      lock = { dir: location.dir, id: acquireLock(location.dir).id };
      return location.dir;
    }
    const fallback = hasArchive(root) ? 'Varsayılan konumdaki (daha eski olabilecek) arşiv açılır; ortak klasördeki kayıtlar orada görünmez.' : 'Varsayılan konumda arşiv yok; boş bir arşiv açılır.';
    const choice = dialog.showMessageBoxSync({ type: 'warning', title: 'Veri klasörüne erişilemiyor', message: 'DubBitig veri klasörüne erişilemiyor.', detail: `${problemText(location)}\n\nVerilerin silinmedi ve yerine boş bir arşiv oluşturulmadı.\n• Yeniden dene: Diski veya bölümü bağladıktan sonra seç.\n• Başka klasör seç: Arşivin bulunduğu klasörü göster.\n• Varsayılan konumu kullan: ${fallback} Klasör yeniden erişilebilir olduğunda Ayarlar → Veriler’den tekrar seçebilirsin.`, buttons: ['Yeniden dene', 'Başka klasör seç', 'Varsayılan konumu kullan', 'Çık'], defaultId: 0, cancelId: 3 });
    if (choice === 3) return undefined;
    if (choice === 2) writePointer(root, root, null);
    if (choice === 1) {
      const picked = dialog.showOpenDialogSync({ title: 'DubBitig veri klasörünü seç', properties: ['openDirectory'] })?.[0];
      if (!picked) continue;
      const dir = findArchive(picked);
      if (!dir) { dialog.showErrorBox('Arşiv bulunamadı', `${picked} klasöründe DubBitig veritabanı (sakli.sqlite) yok.`); continue; }
      try { await inspectArchive(dir); writePointer(root, dir, null); } catch (error) { dialog.showErrorBox('Klasör kullanılamadı', errorText(error)); }
    }
  }
}
app.setName('DubBitig');
// Wayland (KDE/GNOME) only grants Ctrl+Alt+D through the desktop portal.
if (process.platform === 'linux') app.commandLine.appendSwitch('enable-features', 'GlobalShortcutsPortal');
// Keep the stable Windows identity across upgrades.
app.setAppUserModelId('com.sakli.archive');
// Refuse migration while an old-version process owns its original profile lock.
if (!process.env.DUBBITIG_DATA_DIR && !process.env.SAKLI_DATA_DIR && existsSync(join(app.getPath('appData'), 'sakli', 'sakli.sqlite')) && !existsSync(join(app.getPath('appData'), 'DubBitig', 'sakli.sqlite'))) {
  app.setPath('userData', join(app.getPath('appData'), 'sakli'));
  if (!app.requestSingleInstanceLock()) {
    dialog.showErrorBox('Eski sürümü kapat', 'Verileri taşımadan önce açık olan DubBitig sürümünü kapatıp yeniden başlat.');
    app.exit(0);
  }
  app.releaseSingleInstanceLock();
}
// userData stays the local profile folder; a custom archive folder is resolved from it in openDataLocation.
try { app.setPath('userData', process.env.DUBBITIG_DATA_DIR ?? process.env.SAKLI_DATA_DIR ?? migrateDataLocation(app.getPath('appData'))); }
catch (error) { dialog.showErrorBox('Veriler taşınamadı', 'DubBitig’in eski sürümünü kapatıp yeniden dene. Veriler korunuyor.\n' + String(error)); app.exit(1); }
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', (_event,args) => { if(receiveArgs)receiveArgs(args);else pendingArgs.push(args); if (window) { if (window.isMinimized()) window.restore(); window.show(); window.focus(); } });
  app.whenReady().then(async () => {
    const root = app.getPath('userData');
    const dataDir = await openDataLocation(root);
    if (!dataDir) { app.exit(0); return; }
    const repo = await SQLiteRepository.open(join(dataDir, 'sakli.sqlite'));
    service = new ArchiveService(repo, dataDir);
    if (repo.setting('categoriesCleared13') !== 'true') repo.setting('categoriesCleared13', 'true');
    try { registerLinuxBrowserHost(app.getPath('userData')); } catch { /* Browser capture stays unavailable; the archive itself is unaffected. */ }
    try { service.migratePhotoKind(); } catch (error) { dialog.showErrorBox('Fotoğraf kayıtları taşınamadı', String(error)); }
    Menu.setApplicationMenu(null);
    nativeTheme.themeSource = service.settings().theme;
    window = new BrowserWindow({ width: 1440, height: 940, minWidth: 920, minHeight: 650, title: 'DubBitig', icon: appIcon, backgroundColor: service.settings().theme === 'dark' ? '#171b23' : '#f3f4f6', show: false, webPreferences: { preload: join(here, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false } });
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', event => event.preventDefault());
    window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    // Channels that only read; everything else is refused while the data folder is being moved.
    const readOnly = new Set(['snapshot', 'settings', 'backups', 'history', 'image', 'copy', 'openUrl', 'openFolder', 'checkUpdate', 'changeDataLocation']);
    let active = 0;
    const handler = (name: string, fn: (...args: any[]) => unknown) => ipcMain.handle(`sakli:${name}`, async (event, ...args) => {
      if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error('Erişim reddedildi.');
      const writes = !readOnly.has(name);
      if (writes && maintenance) throw new Error('Veri konumu değiştiriliyor. İşlem bitene kadar değişiklik yapılamaz.');
      if (writes) active++;
      try { return await fn(...args); } catch (error) { if (error instanceof z.ZodError) throw new Error(error.issues.map(e => e.message).join(' ')); throw error; }
      finally { if (writes) active--; }
    });
    handler('deleteAllData', confirmation => { service.deleteAllData(z.string().parse(confirmation)); nativeTheme.themeSource = service.settings().theme; });
    handler('snapshot', () => service.snapshot());
    handler('emptyTrash', id => service.emptyTrash(id === undefined ? undefined : z.string().parse(id)));
    handler('cleanupAssets', () => service.cleanupAssets());
    handler('save', (draft, id) => service.save(draft, id));
    handler('trash', (id, restore) => service.trash(id, z.boolean().optional().parse(restore)));
    handler('category', (action, name, next) => service.category(action, name, next));
    handler('tag', (action, name, next) => service.tag(action, name, next));
    handler('history', id => service.history(id));
    handler('restoreRevision', (id, revisionId) => service.restoreRevision(id, revisionId));
    handler('readNotice', (id, noticeId) => service.readNotice(id, noticeId));
    handler('setBackupPeriod', period => service.setBackupPeriod(period));
    handler('setLinkChecker', enabled => repo.setting('linkChecker', String(z.boolean().parse(enabled))));
    handler('checkLinks', id => service.checkLinks(id));
    // Requests run one at a time; a new one waits instead of failing while the previous URL is still loading.
    let previewQueue: Promise<unknown> = Promise.resolve();
    const previewOnce = (value: string) => service.previewUrl(z.string().max(4000).parse(value), bytes => {
        let img = nativeImage.createFromBuffer(bytes);
        // Windows decodes ICO files from paths, not from in-memory buffers.
        if (img.isEmpty() && bytes.length >= 6 && bytes.readUInt32LE(0) === 0x00010000) {
          const temp = join(app.getPath('temp'), `dubbitig-${randomUUID()}.ico`);
          try { writeFileSync(temp, bytes, { flag: 'wx' }); img = nativeImage.createFromPath(temp); }
          finally { try { unlinkSync(temp); } catch {} }
        }
        if (img.isEmpty()) return null;
        const dimensions = img.getSize(); if (dimensions.width > 1600 || dimensions.height > 1600) img = img.resize({ width: Math.round(dimensions.width * Math.min(1600 / dimensions.width, 1600 / dimensions.height)), height: Math.round(dimensions.height * Math.min(1600 / dimensions.width, 1600 / dimensions.height)) }); return img.toPNG();
      });
    const fetchPreview = (value: string) => {
      const job = previewQueue.catch(() => {}).then(() => previewOnce(value));
      previewQueue = job; return job;
    };
    handler('previewUrl', fetchPreview);
    const showNotification = (title: string, body: string) => {
      if (!Notification.isSupported()) throw new Error('Bu sistemde Windows bildirimi desteklenmiyor. Hatırlatıcıları uygulama içinden görebilirsin.');
      const notification = new Notification({ title, body, icon: appIcon });
      notification.on('click', () => { if (window.isMinimized()) window.restore(); window.show(); window.focus(); });
      notification.show();
    };
    handler('testNotification', () => showNotification('DubBitig', 'Hatırlatıcı bildirimleri hazır.'));
    handler('integrationFolder', async browser => { const folder=z.enum(['chrome','firefox']).optional().parse(browser)==='firefox'?'firefox-extension':'chrome-extension'; const error=await shell.openPath(app.isPackaged ? join(process.resourcesPath,folder) : join(here,'../..',folder));if(error)throw new Error(error); });
    handler('integrationWelcome',()=>{if(!app.isPackaged || process.env.SAKLI_DATA_DIR || process.env.DUBBITIG_DATA_DIR || process.env.PORTABLE_EXECUTABLE_FILE || repo.setting('integrationWelcome14')==='true')return false;repo.setting('integrationWelcome14','true');return true;});
    const onCaptured = (entry: Entry) => {
      window.webContents.send('sakli:captured', {id:entry.id,title:entry.title});
      if(window.isMinimized())window.restore();window.show();window.focus();
      try { showNotification('DubBitig’e kaydedildi',entry.title); } catch {}
      if(entry.kind==='link' && !entry.preview) void fetchPreview(entry.url).then(preview => {
        const latest=service.repo.get(entry.id);if(!latest || latest.deletedAt || latest.url!==entry.url)return;
        // Metadata enrichment must not replace edits made while the request was pending.
        service.save({...latest,preview,title:latest.title===entry.title?preview.title:latest.title,description:latest.description || preview.description},latest.id);
        window.webContents.send('sakli:captured',{id:entry.id,title:latest.title});
      }).catch(()=>{});
    };
    const inboxes = [...new Set([join(dataDir, 'capture-inbox'), join(root, 'capture-inbox')])];
    // A failed request would be answered and removed, so queued captures wait while the data folder moves.
    const drainAll = () => {
      if (maintenance) return;
      let failure: unknown;
      for (const folder of inboxes) { try { drainInbox(service, onCaptured, folder); } catch (error) { failure ??= error; } }
      if (failure) throw failure;
    };
    const captureClipboard = async () => { const entry=saveCapture(service,clipboardRequest(await clipboard.readText()));onCaptured(entry);return entry; };
    handler('captureClipboard',captureClipboard);
    handler('image', id => service.image(id));
    handler('addPhotos', async () => {
      const result = await dialog.showOpenDialog(window, { title: 'Fotoğraf ekle', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Fotoğraf', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }] });
      if (result.canceled) return [];
      if (result.filePaths.length > 30) throw new Error('En fazla 30 fotoğraf seçebilirsin.');
      return result.filePaths.map(path => service.addPhoto(path));
    });
    handler('copy', text => clipboard.writeText(z.string().max(200000).parse(text)));
    handler('openUrl', async value => { const url = new URL(z.string().max(4000).parse(value)); if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Yalnızca web bağlantıları açılabilir.'); await shell.openExternal(url.toString()); });
    handler('exportArchive', async input => {
      const scope = transferScopeSchema.parse(input ?? { kind: 'all' });
      const suffix = scope.kind === 'types' ? '-'+scope.types.join('-') : scope.kind === 'categories' ? '-kategoriler' : scope.kind === 'category' ? '-' + (scope.category || 'Kategorisiz').replace(/[<>:"/\\|?*\x00-\x1f]/g, '-').slice(0, 60) : '';
      const r = await dialog.showSaveDialog(window, { title: 'Arşivi dışarı aktar', defaultPath: `DubBitig${suffix}-${new Date().toISOString().slice(0, 10)}.sakli`, filters: [{ name: 'DubBitig arşivi', extensions: ['sakli'] }] });
      if (r.canceled || !r.filePath) return false; atomicWrite(r.filePath, service.exportBytes(scope)); return true;
    });
    handler('importArchive', async (mode, input) => {
      z.enum(['merge', 'replace']).parse(mode);
      const scope = transferScopeSchema.parse(input ?? { kind: 'all' });
      const r = await dialog.showOpenDialog(window, { title: 'DubBitig arşivi seç', properties: ['openFile'], filters: [{ name: 'DubBitig / Saklı arşivi', extensions: ['sakli', 'zip'] }] });
      if (r.canceled) return null;
      if (statSync(r.filePaths[0]).size > MAX_ARCHIVE + 10 * 1024 * 1024) throw new Error('Arşiv çok büyük.');
      if (mode === 'replace') { const confirm = await dialog.showMessageBox(window, { type: 'warning', title: 'Arşivi geri yükle', message: 'Mevcut kayıtlar seçtiğin yedekle değiştirilecek.', detail: 'İşlemden önce mevcut arşivin güvenlik yedeği alınır.', buttons: ['Vazgeç', 'Geri yükle'], defaultId: 0, cancelId: 0 }); if (confirm.response !== 1) return null; }
      return service.importBytes(readFileSync(r.filePaths[0]), mode, scope);
    });
    handler('backup', () => service.createBackup());
    handler('backups', () => service.backups());
    handler('restoreBackup', async name => {
      const r = await dialog.showMessageBox(window, { type: 'warning', title: 'Yedeği geri yükle', message: 'Mevcut arşiv bu yedekle değiştirilsin mi?', detail: 'Mevcut arşiv önce ayrı bir güvenlik yedeğine kaydedilir.', buttons: ['Vazgeç', 'Geri yükle'], defaultId: 0, cancelId: 0 });
      if (r.response !== 1) return -1; return service.restoreBackup(z.string().max(200).parse(name));
    });
    // The old copy left behind by a move, offered for cleanup until the user removes it.
    const previousCopy = () => { try { const previous = readPointer(root)?.previous; return previous && !samePath(previous, dataDir) && hasArchive(previous) ? previous : null; } catch { return null; } };
    handler('settings', () => ({ ...service.settings(), version: app.getVersion(), openAtLogin: openAtLogin(), loginSupported: loginSupported(), defaultDataPath: root, customDataPath: !samePath(dataDir, root), previousDataPath: previousCopy() }));
    handler('setBackupTime', time => service.setBackupTime(z.string().parse(time)));
    handler('setCloseAction', action => service.setCloseAction(action));
    handler('setOpenAtLogin', enabled => setOpenAtLogin(z.boolean().parse(enabled)));
    handler('checkUpdate', force => checkUpdate(z.boolean().optional().parse(force)));
    let updating = false;
    // Only the asset of the latest release that matches this installation is downloaded; nothing comes from the renderer.
    handler('installUpdate', async () => {
      if (updating) throw new Error('Güncelleme zaten indiriliyor.');
      const plan = updatePlan();
      if (!plan) throw new Error('Bu kurulumda otomatik güncelleme kullanılamıyor. Yeni sürümü indirme sayfasından alabilirsin.');
      const how = plan.kind === 'nsis' ? 'DubBitig kapanır, kurulum arka planda yapılır ve bitince DubBitig yeniden açılır. Windows yönetici izni isteyecek.' : plan.kind === 'appimage' ? 'AppImage dosyası yeni sürümle değiştirilir ve DubBitig yeniden açılır.' : 'Paket sistemin paket yöneticisiyle kurulur; yönetici parolan istenir. Ardından DubBitig yeniden açılır.';
      const r = await dialog.showMessageBox(window, { type: 'question', title: 'DubBitig’i güncelle', message: `DubBitig ${plan.latest} indirilip kurulacak.`, detail: `İndirilecek dosya: ${plan.asset.name} (${formatBytes(plan.asset.size)})\nDosya, GitHub’ın yayımladığı ${plan.asset.digest ? 'SHA-256 özeti ve boyutla' : 'boyutla'} doğrulandıktan sonra kurulur.\n\n${how}\n\nKayıtların, fotoğrafların ve ayarların korunur.`, buttons: ['Vazgeç', 'İndir ve kur'], defaultId: 1, cancelId: 0 });
      if (r.response !== 1) return { status: 'canceled' };
      updating = true;
      try {
        const result = await installUpdate(plan, value => { if (!window.isDestroyed()) window.webContents.send('sakli:update-progress', value); });
        quitting = true; if (result.relaunch) app.relaunch(result.relaunch); app.quit();
        return { status: 'restarting' };
      } finally { updating = false; }
    });
    handler('setTheme', theme => { const value = z.enum(['light', 'dark']).parse(theme); repo.setting('theme', value); nativeTheme.themeSource = value; });
    handler('setAutoBackup', enabled => repo.setting('autoBackup', String(z.boolean().parse(enabled))));
    handler('openFolder', async kind => { z.enum(['data', 'backup', 'previous']).parse(kind); const folder = kind === 'data' ? service.dataPath : kind === 'backup' ? service.backupPath : previousCopy(); if (!folder) throw new Error('Eski veri klasörü bulunamadı.'); const error = await shell.openPath(folder); if (error) throw new Error(error); });
    const progress = (value: RelocationProgress) => { if (!window.isDestroyed()) window.webContents.send('sakli:relocation', value); };
    const restart = () => { quitting = true; app.relaunch(); app.quit(); };
    // Lets running writes and preview downloads finish, then blocks every write until the app restarts.
    const enterMaintenance = async () => {
      maintenance = true;
      for (let i = 0; active > 0 && i < 300; i++) await new Promise(done => setTimeout(done, 100));
      await previewQueue.catch(() => {});
      if (active > 0) { maintenance = false; throw new Error('Devam eden işlemler bitmedi. Biraz sonra yeniden dene.'); }
      repo.freeze(true);
    };
    const leaveMaintenance = () => { repo.freeze(false); maintenance = false; };
    // The folder is picked here in the main process; the renderer never passes a path.
    handler('changeDataLocation', async () => {
      if (maintenance) throw new Error('Veri konumu değiştirme işlemi zaten sürüyor.');
      const picked = await dialog.showOpenDialog(window, { title: 'Yeni veri klasörünü seç', buttonLabel: 'Bu klasörü seç', properties: ['openDirectory', 'createDirectory'] });
      if (picked.canceled || !picked.filePaths[0]) return { status: 'canceled' };
      const plan = planRelocation(service.dataPath, picked.filePaths[0], root);
      if (plan.kind === 'existing') {
        const info = await inspectArchive(plan.target);
        const owner = lockOwner(plan.target);
        if (owner && (await dialog.showMessageBox(window, lockWarning(plan.target, owner))).response !== 1) return { status: 'canceled' };
        const mine = service.snapshot().entries.filter(e => !e.deletedAt).length;
        const choice = await dialog.showMessageBox(window, { type: 'question', title: 'Bu klasörde DubBitig arşivi var', message: `Seçilen klasörde ${info.active} kayıt içeren bir DubBitig arşivi bulundu.`, detail: `Konum: ${plan.target}\nSon değişiklik: ${info.updatedAt ? new Date(info.updatedAt).toLocaleString('tr-TR') : 'bilinmiyor'}${info.missingPhotos ? `\nUyarı: Bu arşivde ${info.missingPhotos} fotoğraf dosyası eksik.` : ''}\n\nŞu anki arşivinde ${mine} kayıt var. Bu veriler silinmez; ${service.dataPath} klasöründe kalır.\n\n• Bu arşivi kullan: DubBitig seçilen klasördeki kayıtlarla açılır.\n• Kayıtlarımı ekleyip kullan: Şu anki kayıtların fotoğraflarıyla seçilen arşive eklenir. Aynı kayıt iki yerde varsa daha yeni olan tutulur; aynı anda değişmiş farklı sürümler kopya olarak eklenir. Eklemeden önce seçilen arşivin güvenlik yedeği alınır.\n\nArdından DubBitig yeniden başlatılır.`, buttons: ['Vazgeç', 'Bu arşivi kullan', 'Kayıtlarımı ekleyip kullan'], defaultId: 1, cancelId: 0 });
        if (choice.response === 0) return { status: 'canceled' };
        await enterMaintenance();
        try {
          if (choice.response === 2) {
            progress({ phase: 'merge', done: 0, total: 1 });
            const bytes = service.exportBytes();
            const target = await SQLiteRepository.open(join(plan.target, 'sakli.sqlite'));
            try { new ArchiveService(target, plan.target).importBytes(bytes, 'merge'); } finally { target.close(); }
            progress({ phase: 'merge', done: 1, total: 1 });
          }
          writePointer(root, plan.target, null);
          // Taken over now, so the restart does not ask again; it is stale for this OS once this process exits.
          if (owner) acquireLock(plan.target);
        } catch (error) { leaveMaintenance(); throw new Error('Veri konumu değiştirilmedi; şu anki veri klasörü kullanılmaya devam ediyor.\n' + errorText(error)); }
        await dialog.showMessageBox(window, { type: 'info', title: 'Veri konumu değiştirildi', message: choice.response === 2 ? 'Kayıtların seçilen arşive eklendi.' : 'Seçilen arşiv kullanılacak.', detail: `Yeni konum: ${plan.target}\nÖnceki klasör olduğu gibi duruyor: ${service.dataPath}\n\nDubBitig şimdi yeniden başlatılacak.`, buttons: ['Yeniden başlat'] });
        restart(); return { status: 'restarting' };
      }
      const count = (folder: string) => plan.files.filter(f => f.rel.startsWith(folder + '/')).length;
      const shared = process.platform === 'win32' ? 'Klasörü Linux’ta da kullanacaksan Windows Hızlı Başlatma’yı kapat ve Windows’tan çıkarken hazırda bekletme yerine Kapat’ı seç.' : 'Klasörü Windows’ta da kullanacaksan NTFS bölümünün yazılabilir bağlı olduğundan ve Windows’un tamamen kapatıldığından emin ol.';
      const confirm = await dialog.showMessageBox(window, { type: 'question', title: 'Veri konumunu değiştir', message: 'DubBitig verileri yeni klasöre kopyalanacak.', detail: `Yeni konum: ${plan.target}${plan.nested ? '\n(Seçtiğin klasör dolu olduğu için içinde “DubBitig” klasörü oluşturulur; oradaki dosyalarına dokunulmaz.)' : ''}\n\nKopyalanacaklar: veritabanı (kayıtlar, kategoriler, etiketler, geçmiş, ayarlar), ${count('photos')} fotoğraf dosyası, ${count('backups')} yedek, ${count('capture-inbox')} bekleyen tarayıcı kaydı.\nGereken alan: yaklaşık ${formatBytes(minimumSpace(plan.bytes))} · Boş alan: ${plan.free === null ? 'ölçülemedi' : formatBytes(plan.free)}\n\nÖnce bir güvenlik yedeği alınır. Her dosya SHA-256 ile, veritabanı SQLite bütünlük denetimiyle doğrulanır; her şey doğrulanmadan yeni konuma geçilmez. Mevcut klasör (${service.dataPath}) silinmez. İşlem sürerken değişiklik yapılamaz; bitince DubBitig yeniden başlatılır.\n\n${shared}`, buttons: ['Vazgeç', 'Kopyala ve geç'], defaultId: 1, cancelId: 0 });
      if (confirm.response !== 1) return { status: 'canceled' };
      progress({ phase: 'backup', done: 0, total: 1 });
      try { drainAll(); } catch { /* Failed captures are answered by drainInbox. */ }
      let backupNote = '';
      try { service.createBackup('before-relocation'); } catch (error) { backupNote = `\nGüvenlik yedeği alınamadı (${errorText(error)}); eski klasör olduğu gibi korunduğu için taşıma sürdürüldü.`; }
      await enterMaintenance();
      let result;
      try { result = await relocate(service.dataPath, root, plan, repo.exportBytes(), { progress }); }
      catch (error) { leaveMaintenance(); throw new Error('Veri konumu değiştirilemedi. Veriler eski konumda olduğu gibi kullanılmaya devam ediyor.\n' + errorText(error)); }
      await dialog.showMessageBox(window, { type: 'info', title: 'Veri konumu değiştirildi', message: 'Veriler yeni klasöre kopyalandı ve doğrulandı.', detail: `Yeni konum: ${result.target}\n${result.files} dosya ve veritabanı (toplam ${formatBytes(result.bytes)}) doğrulandı.${result.missingPhotos ? `\n${result.missingPhotos} fotoğraf eski klasörde de yoktu; bu fotoğraflar yeni konumda da görünmez, kayıtlar değiştirilmedi.` : ''}${backupNote}\n\nEski klasör silinmedi: ${result.previous}\nYeni konumda kayıtlarını gördükten sonra Ayarlar → Veriler’den temizleyebilirsin.\n\nDubBitig şimdi yeniden başlatılacak.`, buttons: ['Yeniden başlat'] });
      restart(); return { status: 'restarting' };
    });
    handler('cleanupPreviousData', async () => {
      const previous = previousCopy();
      if (!previous) throw new Error('Temizlenecek eski veri klasörü yok.');
      if (!hasArchive(service.dataPath)) throw new Error('Şu anki veri klasörü doğrulanamadı; eski kopya korunuyor.');
      const items = DATA_ITEMS.filter(name => existsSync(join(previous, name)));
      const r = await dialog.showMessageBox(window, { type: 'warning', title: 'Eski veri kopyasını temizle', message: 'Eski klasördeki DubBitig verileri çöp kutusuna taşınsın mı?', detail: `${previous}\nTaşınacaklar: ${items.join(', ')}\n\nYeni konumda (${service.dataPath}) kayıtlarını ve fotoğraflarını gördüğünden emin ol. Dosyalar kalıcı olarak silinmez, sistemin çöp kutusuna taşınır.${samePath(previous, root) ? ' Uygulama ayarları bu klasörde kaldığı için klasörün kendisi silinmez.' : ''}`, buttons: ['Vazgeç', 'Çöp kutusuna taşı'], defaultId: 0, cancelId: 0 });
      if (r.response !== 1) return false;
      for (const name of items) await shell.trashItem(join(previous, name));
      clearPrevious(root);
      return true;
    });
    if (process.env.SAKLI_DEV === '1') await window.loadURL('http://127.0.0.1:5173');
    else await window.loadFile(join(here, '../../dist/index.html'));
    if (!startedHidden(process.argv)) window.show();
    tray = new Tray(appIcon);
    tray.setToolTip('DubBitig — Kişisel bilgi arşivi');
    const showWindow = () => { if (window.isMinimized()) window.restore(); window.show(); window.focus(); };
    tray.on('click', showWindow);
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'DubBitig’i aç', click: showWindow },
      { label: 'Pencereyi gizle', click: () => window.hide() },
      { label: 'Panodakini kaydet', click: () => void captureClipboard().catch(e => dialog.showErrorBox('Kayıt yapılamadı', String(e))) },
      { type: 'separator' }, { label: 'Çıkış', click: () => app.quit() }
    ]));
    window.on('close', event => {
      if (quitting) return;
      const action = service.settings().closeAction;
      if (action === 'quit' || !tray || tray.isDestroyed()) { quitting = true; app.quit(); return; }
      event.preventDefault();
      if (action === 'minimize') window.minimize(); else window.hide();
    });
    // Windows shutdown must not be held up by close-to-tray behavior.
    window.on('query-session-end', () => { quitting = true; });
    window.on('session-end', releaseDataLock);
    receiveArgs = async args => {
      try {
        const fileIndex=args.indexOf('--capture-file');
        const fileArg=args.find(arg=>arg.startsWith('--capture-file='))?.slice('--capture-file='.length) ?? (fileIndex>=0?args.slice(fileIndex+1).find(arg=>!arg.startsWith('--')):undefined);
        if(fileIndex>=0 || fileArg!==undefined) { if(!fileArg)throw new Error('Dosya yolu eksik.');onCaptured(captureFile(service,fileArg)); }
        else if(args.includes('--capture-clipboard'))await captureClipboard();
        drainAll();
      } catch(e) { dialog.showErrorBox('DubBitig kaydedemedi',String(e)); }
    };
    for(const args of pendingArgs)await receiveArgs(args);pendingArgs.length=0;
    inboxTimer=setInterval(()=>{try{drainAll();}catch{}},1500);
    globalShortcut.register('CommandOrControl+Alt+D',()=>{void captureClipboard().catch(e=>dialog.showErrorBox('DubBitig kaydedemedi',String(e)));});
    // A stable Windows shortcut associates toast notifications with the portable app.
    if (process.platform === 'win32' && !process.env.SAKLI_DATA_DIR && !process.env.DUBBITIG_DATA_DIR && app.isPackaged) {
      const programs = join(app.getPath('appData'), 'Microsoft/Windows/Start Menu/Programs'); mkdirSync(programs, { recursive: true });
      shell.writeShortcutLink(join(programs, 'DubBitig.lnk'), 'create', { target: process.env.PORTABLE_EXECUTABLE_FILE ?? process.execPath, appUserModelId: 'com.sakli.archive', description: 'DubBitig kişisel arşiv' });
    }
    const tick = () => {
      if (maintenance) return;
      service.autoBackup();
      service.processReminders((entry, kind) => showNotification(kind === 'expiry' ? 'Son kullanma tarihi geldi' : 'DubBitig hatırlatıcısı', entry.title));
      if (service.settings().linkChecker) void service.checkLinks(undefined, undefined, true).catch(() => {});
    };
    tick(); timer = setInterval(tick, 60 * 1000);
    // Announce a new GitHub release once per version; the About tab always shows the current state.
    const announceUpdate = () => void checkUpdate().then(info => {
      if (!info.available || !info.latest || repo.setting('updateNotified') === info.latest) return;
      repo.setting('updateNotified', info.latest);
      try { showNotification('DubBitig güncellemesi var', `Sürüm ${info.latest} yayımlandı. Ayarlar → Hakkında bölümünden güncelleyebilirsin.`); } catch { /* The About tab still shows it. */ }
    });
    if (app.isPackaged) { setTimeout(announceUpdate, 15000); updateTimer = setInterval(announceUpdate, 24 * 3600 * 1000); }
    try { service.cleanupAssets(); } catch { /* Leftover files are retried on the next start. */ }
  }).catch(error => { dialog.showErrorBox('DubBitig başlatılamadı', String(error)); app.quit(); });
  app.on('window-all-closed', () => app.quit());
  // Logging out or rebooting Linux sends SIGTERM/SIGHUP; quit normally so the data folder lock is removed.
  for (const signal of ['SIGTERM', 'SIGHUP', 'SIGINT'] as const) process.on(signal, () => { quitting = true; app.quit(); });
  process.on('exit', releaseDataLock);
  app.on('before-quit', () => { quitting = true; tray?.destroy(); tray = undefined; clearInterval(timer);clearInterval(inboxTimer);clearInterval(updateTimer);globalShortcut.unregisterAll(); if (service) { if (!maintenance) service.autoBackup(); service.repo.close(); service = undefined!; } releaseDataLock(); });
}
