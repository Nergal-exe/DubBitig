import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js';
import { createRequire } from 'node:module';
import { mkdirSync, existsSync, readFileSync, writeFileSync, renameSync, openSync, fsyncSync, closeSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Entry, Snapshot } from '../src/shared/model.js';

export interface Repository { reset(): void; snapshot(): Snapshot; get(id: string): Entry | undefined; put(entry: Entry): void; replace(snapshot: Snapshot): void; categories(values?: string[]): string[]; setting(key: string, value?: string): string | undefined; close(): void }
// Makes a completed rename durable on Linux; Windows and some NTFS drivers do not support directory handles.
export function syncDirectory(path: string) {
  if (process.platform === 'win32') return;
  let fd: number | undefined;
  try { fd = openSync(path, 'r'); fsyncSync(fd); } catch { /* Best effort. */ } finally { if (fd !== undefined) closeSync(fd); }
}
export function atomicWrite(path: string, data: Uint8Array | string) {
  mkdirSync(dirname(path), { recursive: true });
  const temp = path + '.tmp';
  writeFileSync(temp, data);
  const fd = openSync(temp, 'r+');
  try { fsyncSync(fd); } finally { closeSync(fd); }
  // Antivirus and search indexers briefly hold files open on Windows/NTFS.
  for (let attempt = 1; ; attempt++) {
    try { renameSync(temp, path); break; }
    catch (error) {
      if (process.platform !== 'win32' || attempt >= 6 || !['EPERM', 'EBUSY', 'EACCES'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 40 * attempt);
    }
  }
  syncDirectory(dirname(path));
}
let sql: Promise<SqlJsStatic> | undefined;
export function loadSql() {
  const require = createRequire(import.meta.url);
  return sql ??= initSqlJs({ locateFile: () => require.resolve('sql.js/dist/sql-wasm.wasm') });
}
const frozenError = 'Veri konumu değiştiriliyor. İşlem bitene kadar değişiklik kaydedilemez.';
export class SQLiteRepository implements Repository {
  // Size and modification time of the file as this process last wrote it; a mismatch means another writer.
  private stamp: { size: number; mtimeMs: number } | undefined;
  private frozen = false;
  private constructor(private db: Database, private path: string) { this.stamp = SQLiteRepository.stat(path); }
  static async open(path: string) {
    const SQL = await loadSql();
    const db = new SQL.Database(existsSync(path) ? readFileSync(path) : undefined);
    db.run('CREATE TABLE IF NOT EXISTS entries (id TEXT PRIMARY KEY, json TEXT NOT NULL); CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL); PRAGMA user_version = 1;');
    return new SQLiteRepository(db, path);
  }
  private static stat(path: string) { if (!existsSync(path)) return undefined; const s = statSync(path); return { size: s.size, mtimeMs: s.mtimeMs }; }
  // sql.js rewrites the whole file, so a second writer (e.g. DubBitig left open in a hibernated Windows) would be overwritten silently.
  private persist() {
    if (this.frozen) throw new Error(frozenError);
    if (this.stamp) {
      const now = SQLiteRepository.stat(this.path);
      if (!now) throw new Error('Veritabanı dosyası bulunamıyor. Veri klasörünün bulunduğu disk veya bölüm ayrılmış olabilir; DubBitig’i yeniden başlat.');
      if (now.size !== this.stamp.size || now.mtimeMs !== this.stamp.mtimeMs) throw new Error('Veritabanı dosyası başka bir uygulama tarafından değiştirildi (ör. diğer işletim sistemindeki DubBitig). Üzerine yazılmadı; son hâlini görmek için DubBitig’i yeniden başlat.');
    }
    atomicWrite(this.path, this.db.export()); this.stamp = SQLiteRepository.stat(this.path);
  }
  // Stops every write while the data folder is copied to a new location.
  freeze(value: boolean) { this.frozen = value; }
  get isFrozen() { return this.frozen; }
  exportBytes() { return this.db.export(); }
  reset() {
    if (this.frozen) throw new Error(frozenError);
    this.db.run('PRAGMA secure_delete = ON');
    this.transaction(() => { this.db.run('DELETE FROM entries; DELETE FROM settings;'); this.db.run('INSERT INTO settings VALUES (?, ?), (?, ?)', ['categoriesCleared13', 'true', 'wipePending', 'true']); });
    // Rebuild the file so historical free pages cannot retain deleted content.
    this.db.run('VACUUM'); this.persist();
  }
  private transaction(fn: () => void) {
    if (this.frozen) throw new Error(frozenError);
    const before = this.db.export();
    try { this.db.run('BEGIN'); fn(); this.db.run('COMMIT'); this.persist(); }
    catch (error) { this.db.close(); const Constructor = this.db.constructor as new (bytes: Uint8Array) => Database; this.db = new Constructor(before); throw error; }
  }
  snapshot(): Snapshot {
    const rows = this.db.exec('SELECT json FROM entries');
    return { entries: (rows[0]?.values ?? []).map(row => JSON.parse(String(row[0])) as Entry), categories: this.categories(), tags: JSON.parse(this.setting('tags') ?? '[]') };
  }
  get(id: string) { const stmt = this.db.prepare('SELECT json FROM entries WHERE id = ?'); try { stmt.bind([id]); return stmt.step() ? JSON.parse(String(stmt.get()[0])) as Entry : undefined; } finally { stmt.free(); } }
  put(entry: Entry) { this.transaction(() => this.db.run('INSERT OR REPLACE INTO entries (id, json) VALUES (?, ?)', [entry.id, JSON.stringify(entry)])); }
  replace(snapshot: Snapshot) { this.transaction(() => { this.db.run('DELETE FROM entries'); for (const e of snapshot.entries) this.db.run('INSERT INTO entries VALUES (?, ?)', [e.id, JSON.stringify(e)]); this.db.run('INSERT OR REPLACE INTO settings VALUES (?, ?)', ['categories', JSON.stringify(snapshot.categories)]); this.db.run('INSERT OR REPLACE INTO settings VALUES (?, ?)', ['tags', JSON.stringify(snapshot.tags)]); }); }
  categories(values?: string[]): string[] { if (values) this.setting('categories', JSON.stringify(values)); return JSON.parse(this.setting('categories') ?? '[]'); }
  setting(key: string, value?: string) {
    if (value !== undefined) this.transaction(() => this.db.run('INSERT OR REPLACE INTO settings VALUES (?, ?)', [key, value]));
    const stmt = this.db.prepare('SELECT value FROM settings WHERE key = ?');
    try { stmt.bind([key]); return stmt.step() ? String(stmt.get()[0]) : undefined; } finally { stmt.free(); }
  }
  close() { this.db.close(); }
}
