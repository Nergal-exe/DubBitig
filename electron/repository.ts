import initSqlJs, { type Database } from 'sql.js';
import { createRequire } from 'node:module';
import { mkdirSync, existsSync, readFileSync, writeFileSync, renameSync, openSync, fsyncSync, closeSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Entry, Snapshot } from '../src/shared/model.js';

export interface Repository { reset(): void; snapshot(): Snapshot; get(id: string): Entry | undefined; put(entry: Entry): void; replace(snapshot: Snapshot): void; categories(values?: string[]): string[]; setting(key: string, value?: string): string | undefined; close(): void }
export function atomicWrite(path: string, data: Uint8Array | string) {
  mkdirSync(dirname(path), { recursive: true });
  const temp = path + '.tmp';
  writeFileSync(temp, data);
  const fd = openSync(temp, 'r+');
  try { fsyncSync(fd); } finally { closeSync(fd); }
  renameSync(temp, path);
}
export class SQLiteRepository implements Repository {
  private constructor(private db: Database, private path: string) {}
  static async open(path: string) {
    const require = createRequire(import.meta.url);
    const SQL = await initSqlJs({ locateFile: () => require.resolve('sql.js/dist/sql-wasm.wasm') });
    const db = new SQL.Database(existsSync(path) ? readFileSync(path) : undefined);
    db.run('CREATE TABLE IF NOT EXISTS entries (id TEXT PRIMARY KEY, json TEXT NOT NULL); CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL); PRAGMA user_version = 1;');
    return new SQLiteRepository(db, path);
  }
  private persist() { atomicWrite(this.path, this.db.export()); }
  reset() {
    this.db.run('PRAGMA secure_delete = ON');
    this.transaction(() => { this.db.run('DELETE FROM entries; DELETE FROM settings;'); this.db.run('INSERT INTO settings VALUES (?, ?), (?, ?)', ['categoriesCleared13', 'true', 'wipePending', 'true']); });
    // Rebuild the file so historical free pages cannot retain deleted content.
    this.db.run('VACUUM'); this.persist();
  }
  private transaction(fn: () => void) {
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
