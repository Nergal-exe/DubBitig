import { randomUUID, createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { existsSync, readFileSync, readdirSync, statSync, unlinkSync, mkdirSync, rmSync } from 'node:fs';
import { join, basename, resolve, dirname } from 'node:path';
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import { z } from 'zod';
import { archiveSchema, draftSchema, transferScopeSchema, backupPeriods, type TransferScope, type Asset, type Draft, type Entry, type Archive, type Settings, type WebPreview, type BackupPeriod } from '../src/shared/model.js';
import { atomicWrite, type Repository } from './repository.js';
import { advanceDate, nextReminder } from './schedule.js';
import { checkUrl, fetchPublic, parseMetadata, type WebFetcher } from './web.js';

export function draftAssets(draft: Draft) { return [...draft.assets, ...[draft.preview?.favicon, draft.preview?.image].filter((a): a is Asset => !!a)]; }
export function entryAssets(entry: Entry) { return [...draftAssets(entry), ...(entry.history ?? []).flatMap(h => draftAssets(h.draft))]; }

export const MAX_ARCHIVE = 512 * 1024 * 1024;
export function detectImage(bytes: Uint8Array): Asset['mime'] {
  if (bytes[0] === 0x89 && Buffer.from(bytes.subarray(1, 8)).equals(Buffer.from([0x50, 0x4e, 0x47, 13, 10, 26, 10]))) return 'image/png';
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  if (Buffer.from(bytes.subarray(0, 6)).toString().match(/^GIF8[79]a$/)) return 'image/gif';
  if (Buffer.from(bytes.subarray(0, 4)).toString() === 'RIFF' && Buffer.from(bytes.subarray(8, 12)).toString() === 'WEBP') return 'image/webp';
  throw new Error('Desteklenmeyen fotoğraf. PNG, JPEG, WebP veya GIF kullan.');
}
export class ArchiveService {
  readonly assetPath: string;
  readonly backupPath: string;
  backupError: string | null = null;
  private checking = false;
  private generation = 0;
  constructor(readonly repo: Repository, readonly dataPath: string) {
    this.assetPath = join(dataPath, 'photos'); this.backupPath = join(dataPath, 'backups');
    mkdirSync(this.assetPath, { recursive: true }); mkdirSync(this.backupPath, { recursive: true });
    if (repo.setting('wipePending') === 'true') this.deleteAllData('BÜTÜN VERİLERİ SİL');
  }
  deleteAllData(confirmation: string) {
    if (confirmation !== 'BÜTÜN VERİLERİ SİL') throw new Error('Silme işlemi için onay metnini aynen yaz.');
    this.generation++;
    this.repo.reset();
    for (const name of ['photos', 'backups', 'capture-inbox']) {
      const path = resolve(this.dataPath, name);
      if (dirname(path) !== resolve(this.dataPath)) throw new Error('Geçersiz veri yolu.');
      rmSync(path, { recursive: true, force: true }); mkdirSync(path, { recursive: true });
    }
    this.backupError = null;
    this.repo.setting('wipePending', 'false');
  }
  snapshot() { const snapshot = this.repo.snapshot(); snapshot.tags = [...new Set([...snapshot.tags, ...snapshot.entries.flatMap(e => e.tags)])]; return snapshot; }
  save(input: Draft, id?: string, newId?: string): Entry {
    const draft = draftSchema.parse(input);
    const old = id ? this.repo.get(z.string().uuid().parse(id)) : undefined;
    if (id && !old) throw new Error('Kayıt bulunamadı.');
    if (old?.deletedAt) throw new Error('Önce kaydı çöp kutusundan geri al.');
    if (draft.preview?.url !== draft.url) draft.preview = null;
    if (draft.reminder && (!old?.reminder || draft.reminder.at !== old.reminder.at)) draft.reminder.anchorDay = new Date(draft.reminder.at).getDate();
    for (const asset of draftAssets(draft)) if (!existsSync(join(this.assetPath, asset.id))) throw new Error('Fotoğraf dosyası bulunamadı. Yeniden ekle.');
    const now = new Date().toISOString();
    const history = [...(old?.history ?? [])];
    if (old && ['note','command'].includes(old.kind) && (old.title !== draft.title || old.description !== draft.description || old.content !== draft.content || old.kind !== draft.kind || old.language !== draft.language || old.url !== draft.url || JSON.stringify(old.assets) !== JSON.stringify(draft.assets))) history.unshift({ id: randomUUID(), savedAt: old.updatedAt, revision: old.revision, draft: draftSchema.parse(old) });
    const entry: Entry = { ...draft, tags: [...new Set(draft.tags)], id: old?.id ?? (newId ? z.string().uuid().parse(newId) : randomUUID()), createdAt: old?.createdAt ?? now, updatedAt: now, deletedAt: null, revision: (old?.revision ?? 0) + 1, history: history.slice(0,50), linkCheck: old?.url === draft.url ? old.linkCheck ?? null : null, notices: old?.notices ?? [], expiryNotifiedAt: old?.expiresAt === draft.expiresAt ? old?.expiryNotifiedAt ?? null : null };
    const snapshot = this.snapshot();
    snapshot.entries = [...snapshot.entries.filter(e => e.id !== entry.id), entry];
    if (entry.category && !snapshot.categories.includes(entry.category)) snapshot.categories.push(entry.category);
    snapshot.tags = [...new Set([...snapshot.tags, ...entry.tags])];
    this.repo.replace(snapshot); return entry;
  }
  history(id: string) { return this.repo.get(z.string().uuid().parse(id))?.history ?? []; }
  restoreRevision(id: string, revisionId: string) {
    const current = this.repo.get(z.string().uuid().parse(id));
    const saved = current?.history?.find(h => h.id === z.string().uuid().parse(revisionId));
    if (!current || !saved) throw new Error('Sürüm bulunamadı.');
    return this.save({ ...saved.draft, category: current.category, tags: current.tags, reminder: current.reminder, expiresAt: current.expiresAt }, id);
  }
  clearExistingCategories() {
    if (this.repo.setting('categoriesCleared13') === 'true') return;
    const s = this.snapshot();
    if (s.categories.length || s.entries.some(e => e.category)) {
      this.createBackup('before-category-clear');
      s.categories = []; s.entries = s.entries.map(e => e.category ? { ...e, category: '', updatedAt: new Date().toISOString(), revision: e.revision + 1 } : e); this.repo.replace(s);
    }
    this.repo.setting('categoriesCleared13', 'true');
  }
  async previewUrl(url: string, convertImage: (bytes: Buffer) => Buffer | null, fetcher: WebFetcher = fetchPublic): Promise<WebPreview> {
    const generation = this.generation;
    const response = await fetcher(url);
    if (response.status < 200 || response.status >= 400) throw new Error(`Site önizlemesi alınamadı (HTTP ${response.status}). Bilgileri elle girebilirsin.`);
    if (!String(response.headers['content-type'] ?? '').includes('html')) throw new Error('Bu adres bir HTML sayfası değil.');
    const meta = parseMetadata(response.bytes.toString('utf8'), response.url);
    const storeImage = async (value: string, name: string): Promise<Asset | undefined> => {
      if (!value) return undefined;
      try { const r = await fetcher(value, { limit: 4 * 1024 * 1024 }); if (r.status !== 200 || generation !== this.generation) return undefined; const png = convertImage(r.bytes); if (!png || png.length > 4 * 1024 * 1024) return undefined; const asset: Asset = { id: randomUUID(), name, mime: 'image/png', size: png.length }; atomicWrite(join(this.assetPath, asset.id), png); return asset; } catch { return undefined; }
    };
    const [favicon, image] = await Promise.all([storeImage(meta.faviconUrl, 'site-ikonu.png'), storeImage(meta.imageUrl, 'site-onizleme.png')]);
    if (generation !== this.generation) throw new Error('Veriler silindiği için önizleme iptal edildi.');
    return { url, title: meta.title, description: meta.description, site: meta.site, fetchedAt: new Date().toISOString(), favicon, image };
  }
  async checkLinks(id?: string, fetcher: WebFetcher = fetchPublic, automatic = false) {
    const generation = this.generation;
    if (this.checking) { if (!automatic) throw new Error('Bağlantı denetimi zaten sürüyor. Sonuçlar kayıtların üzerinde güncellenir.'); return { checked: 0, broken: 0 }; }
    if (id) z.string().uuid().parse(id);
    this.checking = true; let checked = 0; let broken = 0;
    try {
      const entries = this.snapshot().entries.filter(e => !e.deletedAt && e.kind === 'link' && e.url && (!id || e.id === id) && (!automatic || !e.linkCheck || Date.now() - new Date(e.linkCheck.checkedAt).getTime() > 86400000));
      for (const entry of automatic ? entries.slice(0,20) : entries) {
        const result = await checkUrl(entry.url, fetcher);
        if (generation !== this.generation) break;
        const latest = this.repo.get(entry.id);
        if (!latest || latest.deletedAt || latest.url !== entry.url) continue;
        this.repo.put({ ...latest, linkCheck: result }); checked++; if (result.state === 'broken') broken++;
      }
      return { checked, broken };
    } finally { this.checking = false; }
  }
  processReminders(notify: (entry: Entry, kind: 'reminder' | 'expiry') => void, now = new Date()) {
    for (const entry of this.snapshot().entries.filter(e => !e.deletedAt)) {
      let changed = false;
      const add = (kind: 'reminder' | 'expiry', at: string) => { entry.notices = [{ id: randomUUID(), kind, at, read: false }, ...(entry.notices ?? [])].slice(0,50); changed = true; };
      if (entry.reminder?.enabled && new Date(entry.reminder.at) <= now) {
        add('reminder', entry.reminder.at);
        const reminder = entry.reminder;
        entry.reminder = reminder.repeat === 'once' ? { ...reminder, enabled: false } : { ...reminder, at: nextReminder(reminder.at, reminder.repeat, now, reminder.anchorDay) };
        try { notify(entry, 'reminder'); } catch { /* In-app notice remains available even if Windows notifications fail. */ }
      }
      if (entry.expiresAt && new Date(entry.expiresAt) <= now && entry.expiryNotifiedAt !== entry.expiresAt) {
        add('expiry', entry.expiresAt); entry.expiryNotifiedAt = entry.expiresAt;
        try { notify(entry, 'expiry'); } catch { /* See above. */ }
      }
      if (changed) this.repo.put(entry);
    }
  }
  readNotice(id: string, noticeId: string) { const entry = this.repo.get(z.string().uuid().parse(id)); z.string().uuid().parse(noticeId); if (entry) this.repo.put({ ...entry, notices: entry.notices?.map(n => n.id === noticeId ? { ...n, read: true } : n) }); }
  trash(id: string, restore = false) {
    const entry = this.repo.get(z.string().uuid().parse(id)); if (!entry) throw new Error('Kayıt bulunamadı.');
    const now = new Date().toISOString(); this.repo.put({ ...entry, deletedAt: restore ? null : now, updatedAt: now, revision: entry.revision + 1 });
  }
  category(action: 'add' | 'rename' | 'delete', name: string, next?: string) {
    z.enum(['add', 'rename', 'delete']).parse(action);
    name = z.string().trim().min(1).max(80).parse(name);
    const s = this.snapshot();
    if (action === 'add') { if (s.categories.includes(name)) throw new Error('Bu kategori zaten var.'); s.categories.push(name); }
    else {
      if (!s.categories.includes(name)) throw new Error('Kategori bulunamadı.');
      const replacement = action === 'rename' ? z.string().trim().min(1).max(80).parse(next) : '';
      if (action === 'rename' && s.categories.includes(replacement) && replacement !== name) throw new Error('Bu kategori zaten var.');
      s.categories = s.categories.filter(c => c !== name); if (replacement) s.categories.push(replacement);
      s.entries = s.entries.map(e => e.category === name ? { ...e, category: replacement, updatedAt: new Date().toISOString(), revision: e.revision + 1 } : e);
    }
    this.repo.replace(s);
  }
  tag(action: 'add' | 'rename' | 'delete', name: string, next?: string) {
    z.enum(['add', 'rename', 'delete']).parse(action);
    const schema = z.string().trim().min(1).max(40).refine(v => !v.includes(','), 'Etiket adında virgül kullanılamaz.');
    name = schema.parse(name);
    const snapshot = this.snapshot();
    if (action === 'add') {
      if (snapshot.tags.includes(name)) throw new Error('Bu etiket zaten var.');
      snapshot.tags.push(name);
    } else {
      if (!snapshot.tags.includes(name)) throw new Error('Etiket bulunamadı.');
      const replacement = action === 'rename' ? schema.parse(next) : '';
      if (replacement && replacement !== name && snapshot.tags.includes(replacement)) throw new Error('Bu etiket zaten var.');
      snapshot.tags = snapshot.tags.filter(t => t !== name);
      if (replacement) snapshot.tags.push(replacement);
      const now = new Date().toISOString();
      snapshot.entries = snapshot.entries.map(e => e.tags.includes(name) ? { ...e, tags: e.tags.flatMap(t => t === name ? replacement ? [replacement] : [] : [t]), updatedAt: now, revision: e.revision + 1 } : e);
    }
    this.repo.replace(snapshot);
  }
  addPhoto(path: string): Asset {
    if (statSync(path).size > 20 * 1024 * 1024) throw new Error('Bir fotoğraf en fazla 20 MB olabilir.');
    const bytes = readFileSync(path); const mime = detectImage(bytes); const id = randomUUID();
    atomicWrite(join(this.assetPath, id), bytes);
    return { id, name: basename(path), size: bytes.length, mime };
  }
  image(id: string) {
    const bytes = readFileSync(join(this.assetPath, z.string().uuid().parse(id)));
    return `data:${detectImage(bytes)};base64,${bytes.toString('base64')}`;
  }
  exportBytes(scope: TransferScope = { kind: 'all' }): Uint8Array {
    scope = transferScopeSchema.parse(scope);
    const snapshot = this.snapshot();
    if (scope.kind !== 'all') {
      const categories = scope.kind === 'category' ? [scope.category] : scope.kind === 'categories' ? [...new Set(scope.categories)] : undefined;
      const types = scope.kind === 'types' ? scope.types : undefined;
      if (categories?.some(c => c && !snapshot.categories.includes(c))) throw new Error('Kategori bulunamadı.');
      snapshot.entries = snapshot.entries.filter(e => !e.deletedAt && (categories ? categories.includes(e.category) : types!.includes(e.kind)));
      snapshot.categories = categories ? categories.filter(Boolean) : [...new Set(snapshot.entries.map(e => e.category).filter(Boolean))];
      snapshot.tags = [...new Set(snapshot.entries.flatMap(e => e.tags))];
    }
    const manifest: Archive = { format: 'sakli', version: 1, exportedAt: new Date().toISOString(), scope, ...snapshot };
    const files: Record<string, Uint8Array> = { 'manifest.json': strToU8(JSON.stringify(manifest, null, 2)) };
    let total = files['manifest.json'].length;
    for (const entry of manifest.entries) for (const asset of entryAssets(entry)) {
      if (files[`photos/${asset.id}`]) continue;
      const data = readFileSync(join(this.assetPath, asset.id)); total += data.length;
      if (total > MAX_ARCHIVE) throw new Error('Arşiv bu sürümün 512 MB aktarım sınırını aşıyor.');
      files[`photos/${asset.id}`] = data;
    }
    return zipSync(files, { level: 0 });
  }
  importBytes(bytes: Uint8Array, mode: 'merge' | 'replace', scope: TransferScope = { kind: 'all' }) {
    z.enum(['merge', 'replace']).parse(mode);
    scope = transferScopeSchema.parse(scope);
    if (scope.kind === 'categories' || scope.kind === 'types') throw new Error('Bu seçim dışarı aktarma içindir. Oluşan dosyayı normal içeri aktarma ile ekleyebilirsin.');
    if (mode === 'replace' && scope.kind !== 'all') throw new Error('Kategoriye içe aktarma yalnızca birleştirme modunda kullanılabilir.');
    if (bytes.length > MAX_ARCHIVE + 10 * 1024 * 1024) throw new Error('Yedek dosyası çok büyük.');
    let total = 0;
    const files = unzipSync(bytes, { filter: file => {
      total += file.originalSize;
      if (total > MAX_ARCHIVE || file.originalSize > MAX_ARCHIVE) throw new Error('Açılan arşiv 512 MB sınırını aşıyor.');
      return file.name === 'manifest.json' || /^photos\/[0-9a-f-]{36}$/i.test(file.name);
    } });
    if (!files['manifest.json']) throw new Error('Geçerli bir DubBitig yedeği seç.');
    const incoming = archiveSchema.parse(JSON.parse(strFromU8(files['manifest.json'])));
    if (mode === 'replace' && incoming.scope && incoming.scope.kind !== 'all') throw new Error('Bu dosya bir kategori veya kayıt türü aktarımı. Arşivin tamamını geri yüklemek için tam yedek seç; bu dosyayı İçeri aktar ile ekleyebilirsin.');
    if (new Set(incoming.entries.map(e => e.id)).size !== incoming.entries.length) throw new Error('Yedekte yinelenen kayıt kimlikleri var.');
    const assets = new Map<string, Asset>();
    for (const entry of incoming.entries) for (const asset of entryAssets(entry)) {
      const file = files[`photos/${asset.id}`];
      if (!file || file.length !== asset.size || detectImage(file) !== asset.mime) throw new Error('Yedekte eksik veya bozuk fotoğraf var.');
      assets.set(asset.id, asset);
    }
    const current = this.snapshot();
    // A verified, complete safety snapshot is mandatory before existing data changes.
    if (current.entries.length || current.categories.length) this.createBackup('before-import');
    // Asset IDs are immutable. A collision with different bytes receives a new ID.
    const remap = new Map<string, string>();
    for (const asset of assets.values()) {
      const bytes = files[`photos/${asset.id}`]; let id = asset.id;
      if (existsSync(join(this.assetPath, id)) && !readFileSync(join(this.assetPath, id)).equals(Buffer.from(bytes))) id = randomUUID();
      remap.set(asset.id, id); atomicWrite(join(this.assetPath, id), bytes);
    }
    const targetCategory = scope.kind === 'category' ? scope.category : undefined;
    const mapDraft = (d: Draft): Draft => ({ ...d, assets: d.assets.map(a => ({ ...a, id: remap.get(a.id)! })), ...(d.preview ? { preview: { ...d.preview, ...(d.preview.favicon ? { favicon: { ...d.preview.favicon, id: remap.get(d.preview.favicon.id)! } } : {}), ...(d.preview.image ? { image: { ...d.preview.image, id: remap.get(d.preview.image.id)! } } : {}) } } : {}) });
    const imported = incoming.entries.filter(e => targetCategory === undefined || !e.deletedAt).map(e => ({ ...e, ...mapDraft(e), history: e.history?.map(h => ({ ...h, draft: mapDraft(h.draft) })), ...(targetCategory !== undefined ? { id: randomUUID(), category: targetCategory, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), revision: 1, deletedAt: null, reminder: null, expiresAt: null, notices: [] } : {}) }));
    const records = new Map(mode === 'replace' ? [] : current.entries.map(e => [e.id, e]));
    let changed = 0;
    for (const entry of imported) {
      const existing = records.get(entry.id);
      if (!existing || entry.updatedAt > existing.updatedAt) { records.set(entry.id, entry); changed++; }
      else if (entry.updatedAt === existing.updatedAt && !isDeepStrictEqual(JSON.parse(JSON.stringify(entry)), existing)) {
        // Preserve both versions instead of silently discarding an equal-time conflict.
        const copy = { ...entry, id: randomUUID(), title: `${entry.title.slice(0, 175)} (içe aktarılan kopya)` }; records.set(copy.id, copy); changed++;
      }
    }
    this.repo.replace({ entries: [...records.values()], categories: [...new Set([...(mode === 'merge' ? current.categories : []), ...(targetCategory === undefined ? incoming.categories : targetCategory ? [targetCategory] : []), ...imported.map(e => e.category).filter(Boolean)])], tags: [...new Set([...(mode === 'merge' ? current.tags : []), ...(targetCategory === undefined ? incoming.tags : []), ...imported.flatMap(e => e.tags)])] });
    return changed;
  }
  createBackup(reason = 'manual') {
    const name = `sakli-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 6)}-${reason}.sakli`;
    atomicWrite(join(this.backupPath, name), this.exportBytes());
    this.repo.setting('lastBackup', new Date().toISOString());
    if (reason === 'auto') this.repo.setting('lastAutoBackup', new Date().toISOString());
    this.repo.setting('lastBackupSignature', this.signature()); this.backupError = null;
    if (reason === 'auto') for (const b of this.backups().filter(b => b.name.endsWith('-auto.sakli')).slice(14)) unlinkSync(join(this.backupPath, b.name));
  }
  autoBackup(now = new Date()) {
    if (this.repo.setting('autoBackup') === 'false') return;
    const last = this.repo.setting('lastAutoBackup') ?? this.repo.setting('lastBackup');
    if (last && now < new Date(advanceDate(last, this.backupPeriod()))) return;
    const changed = this.repo.setting('lastBackupSignature') !== this.signature();
    if (!last || changed) try { this.createBackup('auto'); } catch (e) { this.backupError = e instanceof Error ? e.message : String(e); }
  }
  private backupPeriod(): BackupPeriod { const value = this.repo.setting('backupPeriod'); return backupPeriods.includes(value as BackupPeriod) ? value as BackupPeriod : 'daily'; }
  setBackupPeriod(period: BackupPeriod) { this.repo.setting('backupPeriod', z.enum(backupPeriods).parse(period)); }
  private signature() { return createHash('sha256').update(JSON.stringify(this.snapshot())).digest('hex'); }
  backups() { return readdirSync(this.backupPath).filter(n => /^sakli-.*\.sakli$/.test(n)).map(name => { const stat = statSync(join(this.backupPath, name)); return { name, date: stat.mtime.toISOString(), size: stat.size }; }).sort((a, b) => b.date.localeCompare(a.date)); }
  restoreBackup(name: string) { if (!this.backups().some(b => b.name === name)) throw new Error('Yedek bulunamadı.'); return this.importBytes(readFileSync(join(this.backupPath, name)), 'replace'); }
  settings(): Settings { const last = this.repo.setting('lastAutoBackup') ?? this.repo.setting('lastBackup'); return { theme: this.repo.setting('theme') === 'light' ? 'light' : 'dark', autoBackup: this.repo.setting('autoBackup') !== 'false', backupPeriod: this.backupPeriod(), nextBackup: last ? advanceDate(last, this.backupPeriod()) : null, linkChecker: this.repo.setting('linkChecker') !== 'false', lastBackup: this.repo.setting('lastBackup') ?? null, backupError: this.backupError, dataPath: this.dataPath, backupPath: this.backupPath }; }
}
