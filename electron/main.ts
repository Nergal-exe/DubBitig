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
import { migrateDataLocation } from './data-location.js';
import type { Entry } from '../src/shared/model.js';

const here = dirname(fileURLToPath(import.meta.url));
let tray: Tray | undefined;
let quitting = false;
let service: ArchiveService;
let window: BrowserWindow;
let timer: ReturnType<typeof setInterval>;
let inboxTimer: ReturnType<typeof setInterval>;
let receiveArgs: ((args: string[]) => Promise<void>) | undefined;
const pendingArgs: string[][] = [process.argv];
app.setName('DubBitig');
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
try { app.setPath('userData', process.env.DUBBITIG_DATA_DIR ?? process.env.SAKLI_DATA_DIR ?? migrateDataLocation(app.getPath('appData'))); }
catch (error) { dialog.showErrorBox('Veriler taşınamadı', 'DubBitig’in eski sürümünü kapatıp yeniden dene. Veriler korunuyor.\n' + String(error)); app.exit(1); }
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', (_event,args) => { if(receiveArgs)receiveArgs(args);else pendingArgs.push(args); if (window) { if (window.isMinimized()) window.restore(); window.show(); window.focus(); } });
  app.whenReady().then(async () => {
    const repo = await SQLiteRepository.open(join(app.getPath('userData'), 'sakli.sqlite'));
    service = new ArchiveService(repo, app.getPath('userData'));
    if (repo.setting('categoriesCleared13') !== 'true') repo.setting('categoriesCleared13', 'true');
    Menu.setApplicationMenu(null);
    nativeTheme.themeSource = service.settings().theme;
    window = new BrowserWindow({ width: 1440, height: 940, minWidth: 920, minHeight: 650, title: 'DubBitig', icon: join(here, '../../dist/qqwe.ico'), backgroundColor: service.settings().theme === 'dark' ? '#171b23' : '#f3f4f6', show: false, webPreferences: { preload: join(here, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false } });
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', event => event.preventDefault());
    window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    const handler = (name: string, fn: (...args: any[]) => unknown) => ipcMain.handle(`sakli:${name}`, async (event, ...args) => {
      if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error('Erişim reddedildi.');
      try { return await fn(...args); } catch (error) { if (error instanceof z.ZodError) throw new Error(error.issues.map(e => e.message).join(' ')); throw error; }
    });
    handler('deleteAllData', confirmation => { service.deleteAllData(z.string().parse(confirmation)); nativeTheme.themeSource = service.settings().theme; });
    handler('snapshot', () => service.snapshot());
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
    let previewBusy = false;
    const fetchPreview = async (value: string) => {
      if (previewBusy) throw new Error('Önceki site önizlemesi hazırlanıyor. Biraz sonra tekrar dene.');
      previewBusy = true;
      try { return await service.previewUrl(z.string().max(4000).parse(value), bytes => {
        let img = nativeImage.createFromBuffer(bytes);
        // Windows decodes ICO files from paths, not from in-memory buffers.
        if (img.isEmpty() && bytes.length >= 6 && bytes.readUInt32LE(0) === 0x00010000) {
          const temp = join(app.getPath('temp'), `dubbitig-${randomUUID()}.ico`);
          try { writeFileSync(temp, bytes, { flag: 'wx' }); img = nativeImage.createFromPath(temp); }
          finally { try { unlinkSync(temp); } catch {} }
        }
        if (img.isEmpty()) return null;
        const dimensions = img.getSize(); if (dimensions.width > 1600 || dimensions.height > 1600) img = img.resize({ width: Math.round(dimensions.width * Math.min(1600 / dimensions.width, 1600 / dimensions.height)), height: Math.round(dimensions.height * Math.min(1600 / dimensions.width, 1600 / dimensions.height)) }); return img.toPNG();
      }); }
      finally { previewBusy = false; }
    };
    handler('previewUrl', fetchPreview);
    const showNotification = (title: string, body: string) => {
      if (!Notification.isSupported()) throw new Error('Bu sistemde Windows bildirimi desteklenmiyor. Hatırlatıcıları uygulama içinden görebilirsin.');
      const notification = new Notification({ title, body, icon: join(here, '../../dist/qqwe.ico') });
      notification.on('click', () => { if (window.isMinimized()) window.restore(); window.show(); window.focus(); });
      notification.show();
    };
    handler('testNotification', () => showNotification('DubBitig', 'Hatırlatıcı bildirimleri hazır.'));
    handler('integrationFolder', async () => { const error=await shell.openPath(app.isPackaged ? join(process.resourcesPath,'chrome-extension') : join(here,'../../chrome-extension'));if(error)throw new Error(error); });
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
    handler('settings', () => ({ ...service.settings(), version: app.getVersion() }));
    handler('setTheme', theme => { const value = z.enum(['light', 'dark']).parse(theme); repo.setting('theme', value); nativeTheme.themeSource = value; });
    handler('setAutoBackup', enabled => repo.setting('autoBackup', String(z.boolean().parse(enabled))));
    handler('openFolder', async kind => { z.enum(['data', 'backup']).parse(kind); const error = await shell.openPath(kind === 'data' ? service.dataPath : service.backupPath); if (error) throw new Error(error); });
    if (process.env.SAKLI_DEV === '1') await window.loadURL('http://127.0.0.1:5173');
    else await window.loadFile(join(here, '../../dist/index.html'));
    window.show();
    tray = new Tray(join(here, '../../dist/qqwe.ico'));
    tray.setToolTip('DubBitig — Kişisel bilgi arşivi');
    const showWindow = () => { if (window.isMinimized()) window.restore(); window.show(); window.focus(); };
    tray.on('click', showWindow);
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'DubBitig’i aç', click: showWindow },
      { label: 'Pencereyi gizle', click: () => window.hide() },
      { label: 'Panodakini kaydet', click: () => void captureClipboard().catch(e => dialog.showErrorBox('Kayıt yapılamadı', String(e))) },
      { type: 'separator' }, { label: 'Çıkış', click: () => app.quit() }
    ]));
    window.on('close', event => { if (!quitting && tray && !tray.isDestroyed()) { event.preventDefault(); window.hide(); } });
    // Windows shutdown must not be held up by close-to-tray behavior.
    window.on('query-session-end', () => { quitting = true; });
    receiveArgs = async args => {
      try {
        const fileIndex=args.indexOf('--capture-file');
        const fileArg=args.find(arg=>arg.startsWith('--capture-file='))?.slice('--capture-file='.length) ?? (fileIndex>=0?args.slice(fileIndex+1).find(arg=>!arg.startsWith('--')):undefined);
        if(fileIndex>=0 || fileArg!==undefined) { if(!fileArg)throw new Error('Dosya yolu eksik.');onCaptured(captureFile(service,fileArg)); }
        else if(args.includes('--capture-clipboard'))await captureClipboard();
        drainInbox(service,onCaptured);
      } catch(e) { dialog.showErrorBox('DubBitig kaydedemedi',String(e)); }
    };
    for(const args of pendingArgs)await receiveArgs(args);pendingArgs.length=0;
    inboxTimer=setInterval(()=>{try{drainInbox(service,onCaptured);}catch{}},1500);
    globalShortcut.register('CommandOrControl+Alt+D',()=>{void captureClipboard().catch(e=>dialog.showErrorBox('DubBitig kaydedemedi',String(e)));});
    // A stable Windows shortcut associates toast notifications with the portable app.
    if (process.platform === 'win32' && !process.env.SAKLI_DATA_DIR && !process.env.DUBBITIG_DATA_DIR && app.isPackaged) {
      const programs = join(app.getPath('appData'), 'Microsoft/Windows/Start Menu/Programs'); mkdirSync(programs, { recursive: true });
      shell.writeShortcutLink(join(programs, 'DubBitig.lnk'), 'create', { target: process.env.PORTABLE_EXECUTABLE_FILE ?? process.execPath, appUserModelId: 'com.sakli.archive', description: 'DubBitig kişisel arşiv' });
    }
    const tick = () => {
      service.autoBackup();
      service.processReminders((entry, kind) => showNotification(kind === 'expiry' ? 'Son kullanma tarihi geldi' : 'DubBitig hatırlatıcısı', entry.title));
      if (service.settings().linkChecker) void service.checkLinks(undefined, undefined, true).catch(() => {});
    };
    tick(); timer = setInterval(tick, 60 * 1000);
  }).catch(error => { dialog.showErrorBox('DubBitig başlatılamadı', String(error)); app.quit(); });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', () => { quitting = true; tray?.destroy(); tray = undefined; clearInterval(timer);clearInterval(inboxTimer);globalShortcut.unregisterAll(); if (service) { service.autoBackup(); service.repo.close(); service = undefined!; } });
}
