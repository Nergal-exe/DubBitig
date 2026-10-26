import { existsSync, mkdirSync, readdirSync, renameSync, cpSync, rmSync, readFileSync, lstatSync, statSync, statfsSync, openSync, readSync, closeSync, fsyncSync, copyFileSync, writeFileSync, unlinkSync, rmdirSync, realpathSync, constants } from 'node:fs';
import { join, resolve, posix, win32 } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { atomicWrite, loadSql, syncDirectory } from './repository.js';
import { entryAssets } from './service.js';
import type { Entry } from '../src/shared/model.js';

// A staged move also handles Chrome creating the new capture inbox before first launch.
// On interruption, the original directory remains inside the destination for recovery.
export function migrateDataLocation(appData: string): string {
  const target = join(appData, 'DubBitig');
  const legacy = join(appData, 'sakli');
  const stage = join(target, 'migration-source');
  if (!existsSync(stage)) {
    if (existsSync(join(target, 'sakli.sqlite')) || !existsSync(join(legacy, 'sakli.sqlite'))) return target;
    if (!existsSync(target)) { renameSync(legacy, target); return target; }
    mkdirSync(target, { recursive: true });
    renameSync(legacy, stage);
  }
  const merge = (source: string, destination: string) => {
    if (lstatSync(source).isSymbolicLink()) throw new Error('Veri taşınırken beklenmeyen bağlantı bulundu: ' + source);
    if (lstatSync(source).isDirectory()) {
      mkdirSync(destination, { recursive: true });
      for (const name of readdirSync(source)) merge(join(source, name), join(destination, name));
    } else if (existsSync(destination)) {
      if (!readFileSync(source).equals(readFileSync(destination))) throw new Error('İki veri klasöründe farklı dosyalar var. Güvenli taşıma durduruldu: ' + destination);
    } else cpSync(source, destination, { errorOnExist: true, force: false });
  };
  // Database last: all assets must exist before the new archive can be opened.
  for (const name of DATA_ITEMS) {
    if (existsSync(join(stage, name))) merge(join(stage, name), join(target, name));
  }
  if (resolve(stage) !== resolve(target, 'migration-source')) throw new Error('Geçersiz taşıma klasörü.');
  rmSync(stage, { recursive: true });
  return target;
}

/*
 * Custom data location. The local profile folder ("root": %APPDATA%\DubBitig or ~/.config/DubBitig) always stays
 * Electron's userData and holds data-location.json, so each operating system keeps its own path to the shared folder
 * and a Windows path is never read on Linux. Archive data is everything in DATA_ITEMS; nothing else is moved.
 */
export const DATA_ITEMS = ['photos', 'backups', 'capture-inbox', 'sakli.sqlite'] as const;
const POINTER = 'data-location.json';
const JOURNAL = 'data-location-journal.json';
const LOCK = 'dubbitig.lock';
const STAGE_PREFIX = '.dubbitig-hazirlik-';
const STAGE_MARK = '.dubbitig-hazirlik.json';
type Platform = NodeJS.Platform;
const message = (error: unknown) => error instanceof Error ? error.message : String(error);

export function validAbsolute(path: string, platform: Platform = process.platform) {
  // win32.isAbsolute also accepts "\folder" (current drive); a stored location must name its drive or share.
  return platform === 'win32' ? /^([a-zA-Z]:[\\/]|\\\\[^\\/]+[\\/][^\\/]+)/.test(path) : posix.isAbsolute(path);
}
const key = (path: string, platform: Platform) => platform === 'win32' ? win32.resolve(path).toLowerCase() : posix.resolve(path);
export function samePath(a: string, b: string, platform: Platform = process.platform) { return key(a, platform) === key(b, platform); }
export function isInside(child: string, parent: string, platform: Platform = process.platform) {
  const api = platform === 'win32' ? win32 : posix;
  const rel = api.relative(key(parent, platform), key(child, platform));
  return !!rel && !rel.startsWith('..') && !api.isAbsolute(rel);
}
const real = (path: string) => { try { return realpathSync.native(path); } catch { return resolve(path); } };

export interface Pointer { version: 1; path: string; previous: string | null; changedAt: string }
export function readPointer(root: string): Pointer | undefined {
  const file = join(root, POINTER);
  if (!existsSync(file)) return undefined;
  const value = JSON.parse(readFileSync(file, 'utf8'));
  if (value?.version !== 1 || typeof value.path !== 'string' || (value.previous != null && typeof value.previous !== 'string')) throw new Error('Veri konumu ayarı okunamadı: ' + file);
  return { previous: null, ...value };
}
// previous is set only after a copy, so the old copy can be offered for cleanup.
export function writePointer(root: string, path: string, previous: string | null = null) {
  atomicWrite(join(root, POINTER), JSON.stringify({ version: 1, path, previous, changedAt: new Date().toISOString() } satisfies Pointer, null, 2));
}
export function clearPrevious(root: string) { const pointer = readPointer(root); if (pointer?.previous) writePointer(root, pointer.path, null); }

export type LocationProblem = 'pointer' | 'relative' | 'missing' | 'no-archive' | 'unreadable' | 'read-only';
export interface DataLocation { dir: string; custom: boolean; previous: string | null; problem?: LocationProblem; detail?: string }
// Creates a file in dir and reads it back; access() is unreliable on read-only NTFS mounts.
export function probeWritable(dir: string) {
  const file = join(dir, `.dubbitig-yazma-testi-${randomUUID()}`);
  try {
    writeFileSync(file, 'DubBitig', { flag: 'wx' });
    const fd = openSync(file, 'r+'); try { fsyncSync(fd); } finally { closeSync(fd); }
    if (readFileSync(file, 'utf8') !== 'DubBitig') throw new Error('Yazılan dosya doğrulanamadı.');
  } finally { rmSync(file, { force: true }); }
}
export function hasArchive(dir: string) { try { return statSync(join(dir, 'sakli.sqlite')).isFile(); } catch { return false; } }
export function checkArchiveDir(dir: string, platform: Platform = process.platform): LocationProblem | undefined {
  if (!validAbsolute(dir, platform)) return 'relative';
  try { if (!statSync(dir).isDirectory()) return 'missing'; } catch { return 'missing'; }
  if (!hasArchive(dir)) return 'no-archive';
  try { closeSync(openSync(join(dir, 'sakli.sqlite'), 'r')); } catch { return 'unreadable'; }
  try { probeWritable(dir); } catch { return 'read-only'; }
  return undefined;
}
// Never creates anything: an unmounted partition must not silently become an empty archive.
export function resolveDataLocation(root: string, platform: Platform = process.platform): DataLocation {
  let pointer: Pointer | undefined;
  try { pointer = readPointer(root); } catch (error) { return { dir: root, custom: true, previous: null, problem: 'pointer', detail: message(error) }; }
  if (!pointer || validAbsolute(pointer.path, platform) && samePath(pointer.path, root, platform)) return { dir: root, custom: false, previous: pointer?.previous ?? null };
  return { dir: pointer.path, custom: true, previous: pointer.previous, problem: checkArchiveDir(pointer.path, platform) };
}
export function problemText(location: DataLocation, platform: Platform = process.platform) {
  const linux = platform === 'linux';
  switch (location.problem) {
    case 'pointer': return `Veri konumu ayarı bozuk. ${location.detail ?? ''}`;
    case 'relative': return `Kayıtlı veri konumu (${location.dir}) bu işletim sisteminde geçerli bir klasör yolu değil.`;
    case 'missing': return `Veri klasörü bulunamadı: ${location.dir}\nKlasörün bulunduğu disk veya bölüm bağlı olmayabilir.${linux ? ' Linux’ta NTFS bölümünü dosya yöneticisinden açarak ya da /etc/fstab ile bağlayabilirsin.' : ''}`;
    case 'no-archive': return `${location.dir} klasöründe DubBitig veritabanı (sakli.sqlite) yok.\nBölüm bağlı değilse bağlama noktası boş görünür.${linux ? ' NTFS bölümünü bağlayıp yeniden dene.' : ''}`;
    case 'unreadable': return `${location.dir} klasöründeki veritabanı okunamıyor. Klasör izinlerini denetle.`;
    case 'read-only': return `${location.dir} klasörüne yazılamıyor.${linux ? '\nWindows hazırda bekletmedeyse veya Hızlı Başlatma açıksa NTFS bölümü Linux’ta yalnızca okunabilir bağlanır. Windows’u açıp “Yeniden başlat” veya Hızlı Başlatma kapalıyken “Kapat” ile tamamen kapat.' : ' Klasör salt okunur olabilir veya izin gerekebilir.'}`;
    default: return '';
  }
}

// Archive inspection with sql.js: integrity check, record count and the photo files the records reference.
export interface ArchiveInfo { integrity: string; entries: number; active: number; updatedAt: string | null; assets: string[]; missingPhotos: number }
export async function inspectDatabase(bytes: Uint8Array): Promise<Omit<ArchiveInfo, 'missingPhotos'>> {
  const SQL = await loadSql();
  let db;
  try { db = new SQL.Database(bytes); } catch (error) { throw new Error('Veritabanı açılamadı: ' + message(error)); }
  try {
    let integrity: string;
    try { integrity = String(db.exec('PRAGMA integrity_check')[0]?.values[0]?.[0] ?? 'boş yanıt'); } catch (error) { integrity = message(error); }
    if (integrity !== 'ok') return { integrity, entries: 0, active: 0, updatedAt: null, assets: [] };
    const entries = (db.exec('SELECT json FROM entries')[0]?.values ?? []).map(row => JSON.parse(String(row[0])) as Entry);
    return { integrity, entries: entries.length, active: entries.filter(e => !e.deletedAt).length, updatedAt: entries.map(e => e.updatedAt).sort().at(-1) ?? null, assets: [...new Set(entries.flatMap(e => entryAssets(e).map(a => a.id)))] };
  } finally { db.close(); }
}
export async function inspectArchive(dir: string): Promise<ArchiveInfo> {
  const info = await inspectDatabase(readFileSync(join(dir, 'sakli.sqlite')));
  if (info.integrity !== 'ok') throw new Error(`Seçilen klasördeki veritabanı bozuk görünüyor (bütünlük denetimi: ${info.integrity}). Bu klasör kullanılmadı.`);
  return { ...info, missingPhotos: info.assets.filter(id => !existsSync(join(dir, 'photos', id))).length };
}
// A folder the user picked to "go back to": the archive may be the folder itself or its DubBitig subfolder.
export function findArchive(chosen: string) { return [chosen, join(chosen, 'DubBitig')].find(hasArchive); }

// One DubBitig per data folder. Electron's single-instance lock is per OS profile, so it cannot see the other OS.
export interface LockInfo { id: string; pid: number; platform: string; hostname: string; startedAt: string }
export function readLock(dir: string): LockInfo | undefined {
  try { const value = JSON.parse(readFileSync(join(dir, LOCK), 'utf8')); return typeof value?.id === 'string' ? value : undefined; } catch { return undefined; }
}
// The lock of another (possibly hibernated) session, or undefined when the folder is free or the lock is stale.
export function lockOwner(dir: string, self = { platform: process.platform as string, hostname: hostname(), pid: process.pid }): LockInfo | undefined {
  const lock = readLock(dir);
  if (!lock) return undefined;
  if (lock.platform !== self.platform || lock.hostname !== self.hostname) return lock;
  if (lock.pid === self.pid) return undefined;
  try { process.kill(lock.pid, 0); return lock; } catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM' ? lock : undefined; }
}
export function acquireLock(dir: string): LockInfo {
  const lock: LockInfo = { id: randomUUID(), pid: process.pid, platform: process.platform, hostname: hostname(), startedAt: new Date().toISOString() };
  atomicWrite(join(dir, LOCK), JSON.stringify(lock, null, 2)); return lock;
}
export function releaseLock(dir: string, id: string) { try { if (readLock(dir)?.id === id) unlinkSync(join(dir, LOCK)); } catch { /* Stale locks are detected on the next start. */ } }

export interface PlannedFile { rel: string; size: number }
export type RelocationPlan =
  | { kind: 'copy'; target: string; nested: boolean; files: PlannedFile[]; bytes: number; free: number | null }
  | { kind: 'existing'; target: string };
export interface PlanOptions { platform?: Platform; freeSpace?: (dir: string) => number | null }
export function freeSpace(dir: string) { try { const s = statfsSync(dir); return Number(s.bavail) * Number(s.bsize); } catch { return null; } }
const isEmpty = (dir: string) => readdirSync(dir).length === 0;
export function listDataFiles(dir: string): PlannedFile[] {
  const files: PlannedFile[] = [];
  const walk = (path: string, rel: string) => {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) throw new Error('Veri klasöründe beklenmeyen bağlantı (symlink) var; güvenli taşıma durduruldu: ' + path);
    if (stat.isDirectory()) { for (const name of readdirSync(path)) walk(join(path, name), rel + '/' + name); }
    else if (stat.isFile()) files.push({ rel, size: stat.size });
  };
  for (const name of DATA_ITEMS) if (existsSync(join(dir, name))) walk(join(dir, name), name);
  return files;
}
export const minimumSpace = (bytes: number) => Math.ceil(bytes * 1.1) + 16 * 1024 * 1024;
export function planRelocation(current: string, chosen: string, root: string, options: PlanOptions = {}): RelocationPlan {
  const platform = options.platform ?? process.platform;
  if (!validAbsolute(chosen, platform)) throw new Error('Geçerli bir klasör seç.');
  try { if (!statSync(chosen).isDirectory()) throw new Error(); } catch { throw new Error('Seçilen klasör bulunamadı veya bir klasör değil.'); }
  const picked = real(chosen);
  let target = picked; let nested = false;
  if (!hasArchive(picked) && !isEmpty(picked)) {
    // A non-empty folder that is not an archive gets a DubBitig subfolder; its own files are never touched.
    target = join(picked, 'DubBitig'); nested = true;
    if (existsSync(target) && !hasArchive(target) && (!statSync(target).isDirectory() || !isEmpty(target))) throw new Error(`Seçilen klasörde DubBitig verisi içermeyen dolu bir “DubBitig” klasörü var: ${target}\nBoş bir klasör veya mevcut bir DubBitig veri klasörü seç.`);
    if (existsSync(target)) target = real(target);
  }
  const from = real(current); const profile = real(root);
  if (samePath(target, from, platform)) throw new Error('Seçtiğin klasör zaten şu anki veri konumu.');
  if (isInside(target, from, platform)) throw new Error('Şu anki veri klasörünün içindeki bir klasör seçilemez; kopyalanan veriler kaynakla çakışır.');
  if (isInside(from, target, platform)) throw new Error('Şu anki veri klasörünü içeren bir klasör seçilemez.');
  if (isInside(target, profile, platform)) throw new Error('DubBitig’in uygulama klasörünün içindeki bir klasör seçilemez.');
  if (hasArchive(target)) return { kind: 'existing', target };
  try { probeWritable(picked); } catch (error) { throw new Error(`Seçilen klasöre yazılamıyor: ${picked}\nKlasör salt okunur olabilir veya izin gerekebilir.${platform === 'linux' ? ' NTFS bölümü Windows hazırda bekletme / Hızlı Başlatma nedeniyle salt okunur bağlanmış olabilir.' : ''}\n(${message(error)})`); }
  const files = listDataFiles(from); const bytes = files.reduce((sum, f) => sum + f.size, 0);
  const free = (options.freeSpace ?? freeSpace)(picked);
  if (free !== null && free < minimumSpace(bytes)) throw new Error(`Hedef diskte yeterli boş alan yok. Gereken: yaklaşık ${formatBytes(minimumSpace(bytes))}, boş: ${formatBytes(free)}.`);
  return { kind: 'copy', target, nested, files, bytes, free };
}
export const formatBytes = (v: number) => v < 1048576 ? Math.max(1, Math.round(v / 1024)) + ' KB' : v < 1073741824 ? (v / 1048576).toFixed(1) + ' MB' : (v / 1073741824).toFixed(2) + ' GB';

export function sha256File(path: string) {
  const hash = createHash('sha256'); const buffer = Buffer.allocUnsafe(1 << 20); const fd = openSync(path, 'r');
  try { for (let n; (n = readSync(fd, buffer, 0, buffer.length, null)) > 0;) hash.update(buffer.subarray(0, n)); } finally { closeSync(fd); }
  return hash.digest('hex');
}
function copyDurable(source: string, destination: string) {
  copyFileSync(source, destination, constants.COPYFILE_EXCL);
  const fd = openSync(destination, 'r+'); try { fsyncSync(fd); } finally { closeSync(fd); }
}
function writeDurable(path: string, data: Uint8Array) {
  writeFileSync(path, data, { flag: 'wx' });
  const fd = openSync(path, 'r+'); try { fsyncSync(fd); } finally { closeSync(fd); }
}

interface Journal { version: 1; id: string; phase: 'copying' | 'committing'; source: string; target: string; stage: string; createdTarget: boolean; moved: string[]; startedAt: string }
const readJournal = (root: string): Journal | undefined => existsSync(join(root, JOURNAL)) ? JSON.parse(readFileSync(join(root, JOURNAL), 'utf8')) : undefined;
const writeJournal = (root: string, journal: Journal) => atomicWrite(join(root, JOURNAL), JSON.stringify(journal, null, 2));
export interface RelocationProgress { phase: 'copy' | 'database' | 'commit'; done: number; total: number }
export interface RelocationHooks {
  progress?(value: RelocationProgress): void;
  copy?(source: string, destination: string): void;
  // Called after each top-level item is moved from the staging folder into the target.
  moved?(name: string): void;
}
export interface RelocationResult { target: string; previous: string; files: number; bytes: number; missingPhotos: number }

/**
 * Copies the archive into a staging folder inside the target, verifies sizes, SHA-256 and SQLite integrity, then moves
 * the verified items into place (database last) and only then points the profile at the new folder. Any failure
 * before the pointer is written leaves the old location active and removes the partial copy.
 * The caller must stop all writes (repository freeze) for the whole call; database is the in-memory snapshot.
 */
export async function relocate(source: string, root: string, plan: Extract<RelocationPlan, { kind: 'copy' }>, database: Uint8Array, hooks: RelocationHooks = {}): Promise<RelocationResult> {
  if (readJournal(root)) throw new Error('Önceki bir taşıma işlemi tamamlanmamış. DubBitig’i yeniden başlatıp tekrar dene.');
  const target = plan.target; const id = randomUUID();
  const journal: Journal = { version: 1, id, phase: 'copying', source, target, stage: join(target, STAGE_PREFIX + id.slice(0, 8)), createdTarget: !existsSync(target), moved: [], startedAt: new Date().toISOString() };
  writeJournal(root, journal);
  const yieldToEvents = () => new Promise(done => setImmediate(done));
  try {
    mkdirSync(target, { recursive: true });
    for (const name of DATA_ITEMS) if (existsSync(join(target, name))) throw new Error('Hedef klasör boş değil: ' + join(target, name));
    mkdirSync(journal.stage);
    writeFileSync(join(journal.stage, STAGE_MARK), JSON.stringify({ id }));
    // Listed again after writes stopped: the plan may be older than the freeze.
    const files = listDataFiles(source).filter(f => f.rel !== 'sakli.sqlite');
    const total = files.length + 1; let bytes = database.length;
    for (const [index, file] of files.entries()) {
      const from = join(source, ...file.rel.split('/')); const to = join(journal.stage, ...file.rel.split('/'));
      mkdirSync(join(to, '..'), { recursive: true });
      const expected = sha256File(from);
      try { (hooks.copy ?? copyDurable)(from, to); }
      catch (error) { throw new Error(((error as NodeJS.ErrnoException).code === 'ENOSPC' ? 'Hedef diskte yer kalmadı. ' : 'Dosya kopyalanamadı. ') + file.rel + ': ' + message(error)); }
      if (statSync(to).size !== statSync(from).size || sha256File(to) !== expected) throw new Error('Kopyalanan dosya doğrulanamadı (boyut veya SHA-256 farklı): ' + file.rel);
      bytes += file.size;
      hooks.progress?.({ phase: 'copy', done: index + 1, total });
      if (index % 8 === 7) await yieldToEvents();
    }
    hooks.progress?.({ phase: 'database', done: total - 1, total });
    const stagedDb = join(journal.stage, 'sakli.sqlite');
    writeDurable(stagedDb, database);
    const written = readFileSync(stagedDb);
    if (createHash('sha256').update(written).digest('hex') !== createHash('sha256').update(database).digest('hex')) throw new Error('Kopyalanan veritabanı doğrulanamadı (SHA-256 farklı).');
    const expected = await inspectDatabase(database); const copied = await inspectDatabase(written);
    if (copied.integrity !== 'ok') throw new Error('Kopyalanan veritabanının bütünlük denetimi başarısız: ' + copied.integrity);
    if (copied.entries !== expected.entries) throw new Error('Kopyalanan veritabanındaki kayıt sayısı farklı.');
    // Photos that were already missing in the old folder stay missing; nothing is re-linked to another file.
    const missingPhotos = copied.assets.filter(asset => !existsSync(join(journal.stage, 'photos', asset))).length;
    hooks.progress?.({ phase: 'commit', done: total, total });
    journal.phase = 'committing'; writeJournal(root, journal);
    for (const name of DATA_ITEMS) {
      if (!existsSync(join(journal.stage, name))) continue;
      if (existsSync(join(target, name))) throw new Error('Hedef klasörde beklenmeyen dosya oluştu: ' + join(target, name));
      renameSync(join(journal.stage, name), join(target, name));
      journal.moved.push(name); writeJournal(root, journal);
      hooks.moved?.(name);
    }
    syncDirectory(target);
    for (const file of [...files, { rel: 'sakli.sqlite', size: database.length }]) {
      const path = join(target, ...file.rel.split('/'));
      if (!existsSync(path) || statSync(path).size !== file.size) throw new Error('Taşınan dosya hedefte doğrulanamadı: ' + file.rel);
    }
    rmSync(join(journal.stage, STAGE_MARK)); rmdirSync(journal.stage);
    writePointer(root, target, source);
    // Committed from here on; a journal left behind is cleaned up by recoverRelocation on the next start.
    try { rmSync(join(root, JOURNAL), { force: true }); } catch { /* See above. */ }
    return { target, previous: source, files: files.length, bytes, missingPhotos };
  } catch (error) {
    try { recoverRelocation(root); } catch (rollback) { throw new Error(`${message(error)}\nYarım kalan kopya temizlenemedi; DubBitig sonraki açılışta yeniden deneyecek. (${message(rollback)})`); }
    throw error;
  }
}

/**
 * Finishes or undoes an interrupted relocation. The pointer decides: if it already names the target the move is
 * complete; otherwise the old folder is still the active, unchanged archive and only the copy in the target is removed.
 */
export function recoverRelocation(root: string): { state: 'committed' | 'rolled-back'; target: string } | undefined {
  const journal = readJournal(root);
  if (!journal) return undefined;
  let pointer: Pointer | undefined; try { pointer = readPointer(root); } catch { pointer = undefined; }
  const stageValid = journal.stage.startsWith(join(journal.target, STAGE_PREFIX)) && (() => { try { return JSON.parse(readFileSync(join(journal.stage, STAGE_MARK), 'utf8')).id === journal.id; } catch { return false; } })();
  if (pointer && samePath(pointer.path, journal.target)) {
    if (stageValid) rmSync(journal.stage, { recursive: true, force: true });
    rmSync(join(root, JOURNAL), { force: true });
    return { state: 'committed', target: journal.target };
  }
  if (!hasArchive(journal.source)) throw new Error(`Yarım kalan taşıma geri alınamadı: eski veri klasörü (${journal.source}) okunamıyor. Hiçbir dosya silinmedi.`);
  if (stageValid) {
    // Only items this relocation moved; everything else in the target belongs to the user.
    for (const name of [...journal.moved].reverse()) {
      if (existsSync(join(journal.target, name)) && !existsSync(join(journal.stage, name))) renameSync(join(journal.target, name), join(journal.stage, name));
    }
    rmSync(journal.stage, { recursive: true, force: true });
  } else if (journal.moved.length) throw new Error(`Yarım kalan taşıma geri alınamadı. Eski veriler korunuyor; ${journal.target} klasörünü elle denetle.`);
  if (journal.createdTarget) try { rmdirSync(journal.target); } catch { /* Not empty: leave it. */ }
  rmSync(join(root, JOURNAL), { force: true });
  return { state: 'rolled-back', target: journal.target };
}
