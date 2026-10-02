import { z } from 'zod';

export const kinds = ['command', 'program', 'link', 'note', 'photo'] as const;
export type Kind = typeof kinds[number];
export const labels: Record<Kind, string> = { command: 'Komut', program: 'Program', link: 'Bağlantı', note: 'Not', photo: 'Fotoğraf' };
export const assetSchema = z.object({ id: z.string().uuid(), name: z.string().min(1).max(255), mime: z.enum(['image/png', 'image/jpeg', 'image/webp', 'image/gif']), size: z.number().int().min(1).max(20 * 1024 * 1024) });
export type Asset = z.infer<typeof assetSchema>;
export const previewSchema = z.object({ url: z.string().max(4000), title: z.string().max(200), description: z.string().max(1000), site: z.string().max(200), fetchedAt: z.string().datetime(), favicon: assetSchema.optional(), image: assetSchema.optional() });
export type WebPreview = z.infer<typeof previewSchema>;
export const reminderSchema = z.object({ at: z.string().datetime(), repeat: z.enum(['once', 'daily', 'weekly', 'monthly']), enabled: z.boolean(), anchorDay: z.number().int().min(1).max(31).optional() });
export const noticeSchema = z.object({ id: z.string().uuid(), kind: z.enum(['reminder', 'expiry']), at: z.string().datetime(), read: z.boolean() });
export const checkSchema = z.object({ state: z.enum(['ok', 'broken', 'unknown']), checkedAt: z.string().datetime(), status: z.number().optional(), detail: z.string().max(500) });
export type LinkCheck = z.infer<typeof checkSchema>;
export const backupPeriods = ['30m', 'daily', 'weekly', 'monthly'] as const;
export type BackupPeriod = typeof backupPeriods[number];
export const draftSchema = z.object({
  title: z.string().trim().min(1, 'Başlık gerekli.').max(200),
  kind: z.enum(kinds), description: z.string().max(10000), content: z.string().max(200000),
  url: z.string().max(4000).refine(v => !v || /^https?:\/\//i.test(v) && (() => { try { return Boolean(new URL(v).hostname); } catch { return false; } })(), 'Bağlantı http:// veya https:// ile başlamalı.'),
  category: z.string().trim().max(80), tags: z.array(z.string().trim().min(1).max(40)).max(30),
  language: z.enum(['auto','plaintext','powershell','bash','dos','javascript','typescript','python','json','sql','yaml','css','xml','csharp']).optional(),
  favorite: z.boolean(), assets: z.array(assetSchema).max(30),
  preview: previewSchema.nullable().optional(), reminder: reminderSchema.nullable().optional(), expiresAt: z.string().datetime().nullable().optional(),
}).superRefine((v, ctx) => {
  if (v.kind === 'command' && !v.content.trim()) ctx.addIssue({ code: 'custom', path: ['content'], message: 'Komut alanını doldur.' });
  if (v.kind === 'link' && !v.url) ctx.addIssue({ code: 'custom', path: ['url'], message: 'Bağlantı adresini doldur.' });
  if (v.kind === 'photo' && !v.assets.length) ctx.addIssue({ code: 'custom', path: ['assets'], message: 'En az bir fotoğraf ekle.' });
});
export const historySchema = z.object({ id: z.string().uuid(), savedAt: z.string().datetime(), revision: z.number().int().positive(), draft: draftSchema });
export type HistoryItem = z.infer<typeof historySchema>;
export const entrySchema = draftSchema.safeExtend({ id: z.string().uuid(), createdAt: z.string().datetime(), updatedAt: z.string().datetime(), deletedAt: z.string().datetime().nullable(), revision: z.number().int().positive(), history: z.array(historySchema).max(50).optional(), linkCheck: checkSchema.nullable().optional(), reminderNotifiedAt: z.string().nullable().optional(), expiryNotifiedAt: z.string().nullable().optional(), notices: z.array(noticeSchema).max(50).optional() });
export type Draft = z.infer<typeof draftSchema>;
export type Entry = z.infer<typeof entrySchema>;
export const transferScopeSchema = z.discriminatedUnion('kind', [z.object({ kind: z.literal('all') }), z.object({ kind: z.literal('category'), category: z.string().trim().max(80) }), z.object({ kind: z.literal('categories'), categories: z.array(z.string().trim().max(80)).min(1).max(1000) }), z.object({ kind: z.literal('types'), types: z.array(z.enum(kinds)).min(1).max(5) })]);
export type TransferScope = z.infer<typeof transferScopeSchema>;
export type Theme = 'light' | 'dark';
export const archiveSchema = z.object({ format: z.literal('sakli'), version: z.literal(1), exportedAt: z.string().datetime(), scope: transferScopeSchema.optional(), entries: z.array(entrySchema).max(100000), categories: z.array(z.string().trim().min(1).max(80)).max(1000), tags: z.array(z.string().trim().min(1).max(40)).max(10000).default([]) });
export type Archive = z.infer<typeof archiveSchema>;
export interface Snapshot { entries: Entry[]; categories: string[]; tags: string[] }
export interface BackupInfo { name: string; date: string; size: number }
export interface Settings { version?: string; theme: Theme; autoBackup: boolean; backupPeriod: BackupPeriod; nextBackup: string | null; linkChecker: boolean; lastBackup: string | null; backupError: string | null; dataPath: string; backupPath: string }
export interface ArchivePort {
  snapshot(): Promise<Snapshot>;
  save(draft: Draft, id?: string): Promise<Entry>;
  trash(id: string, restore?: boolean): Promise<void>;
  category(action: 'add' | 'rename' | 'delete', name: string, next?: string): Promise<void>;
  tag(action: 'add' | 'rename' | 'delete', name: string, next?: string): Promise<void>;
  history(id: string): Promise<HistoryItem[]>;
  restoreRevision(id: string, revisionId: string): Promise<Entry>;
}
export interface AssetPort { addPhotos(): Promise<Asset[]>; image(id: string): Promise<string> }
export interface DesktopAPI { deleteAllData(confirmation: string):Promise<void>; captureClipboard():Promise<Entry>; integrationFolder():Promise<void>; integrationWelcome():Promise<boolean>; onCaptured(callback:(value:{id:string;title:string})=>void):()=>void }
export interface BackupPort { exportArchive(scope?: TransferScope): Promise<boolean>; importArchive(mode: 'merge' | 'replace', scope?: TransferScope): Promise<number | null>; backup(): Promise<void>; backups(): Promise<BackupInfo[]>; restoreBackup(name: string): Promise<number>; settings(): Promise<Settings>; setAutoBackup(enabled: boolean): Promise<void>; setTheme(theme: Theme): Promise<void> }
export interface DesktopAPI extends ArchivePort, AssetPort, BackupPort { copy(text: string): Promise<void>; openUrl(url: string): Promise<void>; openFolder(kind: 'data' | 'backup'): Promise<void>; setBackupPeriod(period: BackupPeriod): Promise<void>; previewUrl(url: string): Promise<WebPreview>; checkLinks(id?: string): Promise<{ checked: number; broken: number }>; setLinkChecker(enabled: boolean): Promise<void>; testNotification(): Promise<void>; readNotice(id: string, noticeId: string): Promise<void> }
// Future HTTP adapters implement ArchivePort/AssetPort. Sync transport remains optional.
export interface SyncTransport { exchange(request: { cursor: string | null; changes: Entry[] }): Promise<{ cursor: string; changes: Entry[]; conflicts: Entry[] }> }
