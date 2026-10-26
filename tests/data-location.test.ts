import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync, mkdirSync, readdirSync, chmodSync, cpSync, unlinkSync } from 'node:fs';
import { tmpdir, hostname } from 'node:os';
import { join } from 'node:path';
import { SQLiteRepository } from '../electron/repository';
import { ArchiveService } from '../electron/service';
import { migrateDataLocation, resolveDataLocation, planRelocation, relocate, recoverRelocation, readPointer, writePointer, inspectArchive, findArchive, validAbsolute, samePath, isInside, problemText, acquireLock, lockOwner, releaseLock, readLock, checkArchiveDir } from '../electron/data-location';
import type { Draft } from '../src/shared/model';

const draft = (title: string): Draft => ({ title, kind: 'note', description: '', content: 'İçerik ' + title, category: 'Ortak', tags: ['çift-açılış'], url: '', favorite: false, assets: [] });
const png = (seed: number) => Buffer.concat([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64'), Buffer.from([seed])]);
const root = process.getuid?.() === 0;

// A profile folder with an archive: two photos that share a Turkish file name, a backup and a queued capture.
async function setup() {
  const base = mkdtempSync(join(tmpdir(), 'dubbitig-konum-'));
  const profile = join(base, 'profil'); mkdirSync(profile);
  const repo = await SQLiteRepository.open(join(profile, 'sakli.sqlite'));
  const service = new ArchiveService(repo, profile);
  const photos = [1, 2].map(seed => { const dir = join(base, 'kaynak' + seed); mkdirSync(dir); const file = join(dir, 'Çiçek bahçesi ğüşiöç.png'); writeFileSync(file, png(seed)); return service.addPhoto(file); });
  const first = service.save({ ...draft('Windows’ta eklenen'), assets: [photos[0]] });
  const second = service.save({ ...draft('Linux’ta eklenen'), assets: [photos[1]] });
  service.save(draft('Fotoğrafsız'));
  repo.setting('theme', 'light');
  service.createBackup();
  mkdirSync(join(profile, 'capture-inbox')); writeFileSync(join(profile, 'capture-inbox', '00000000-0000-4000-8000-000000000001.json'), '{}');
  return { base, profile, repo, service, photos, first, second, close() { try { repo.close(); } catch {} rmSync(base, { recursive: true, force: true }); } };
}
type Fixture = Awaited<ReturnType<typeof setup>>;
const target = (f: Fixture, name = 'Ortak Klasör') => { const dir = join(f.base, name, 'DubBitig Verisi'); mkdirSync(dir, { recursive: true }); return dir; };
async function move(f: Fixture, chosen: string, hooks = {}) {
  const plan = planRelocation(f.profile, chosen, f.profile);
  assert.equal(plan.kind, 'copy'); if (plan.kind !== 'copy') throw new Error();
  f.repo.freeze(true);
  try { return await relocate(f.profile, f.profile, plan, f.repo.exportBytes(), hooks); } finally { f.repo.freeze(false); }
}
const leftovers = (dir: string) => readdirSync(dir).filter(n => n.startsWith('.dubbitig-'));

test('ilk açılışta varsayılan konum algılanır; hiçbir dosya oluşturulmaz', () => {
  const base = mkdtempSync(join(tmpdir(), 'dubbitig-konum-'));
  try {
    assert.deepEqual(resolveDataLocation(base), { dir: base, custom: false, previous: null });
    assert.deepEqual(readdirSync(base), []);
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test('eski sürümden gelen arşiv (sakli → DubBitig) varsayılan konum olarak kullanılır', async () => {
  const appData = mkdtempSync(join(tmpdir(), 'dubbitig-eski-'));
  try {
    const legacy = join(appData, 'sakli'); mkdirSync(legacy);
    const repo = await SQLiteRepository.open(join(legacy, 'sakli.sqlite')); new ArchiveService(repo, legacy).save(draft('Eski kayıt')); repo.close();
    const profile = migrateDataLocation(appData);
    const location = resolveDataLocation(profile);
    assert.equal(location.dir, join(appData, 'DubBitig')); assert.equal(location.custom, false);
    assert.equal((await inspectArchive(location.dir)).entries, 1);
  } finally { rmSync(appData, { recursive: true, force: true }); }
});

test('boş hedefe geçiş: dosyalar doğrulanır, yeniden başlatmada yeni konum kullanılır, eski klasör korunur', async () => {
  const f = await setup();
  try {
    const dir = target(f); const before = f.service.snapshot();
    const progress: string[] = [];
    const result = await move(f, dir, { progress: (p: { phase: string }) => progress.push(p.phase) });
    assert.equal(result.target, dir); assert.equal(result.previous, f.profile); assert.equal(result.missingPhotos, 0);
    assert.ok(progress.includes('copy') && progress.includes('database') && progress.includes('commit'));
    assert.deepEqual(readPointer(f.profile)?.path, dir);
    assert.equal(existsSync(join(f.profile, 'data-location-journal.json')), false);
    assert.deepEqual(leftovers(dir), []);
    // Nothing of the profile (Electron cache, pointer, lock) is copied.
    assert.deepEqual(readdirSync(dir).sort(), ['backups', 'capture-inbox', 'photos', 'sakli.sqlite']);
    // The old folder is untouched.
    assert.ok(existsSync(join(f.profile, 'sakli.sqlite'))); assert.equal(readdirSync(join(f.profile, 'photos')).length, 2);
    f.repo.close();
    // "Restart": the profile resolves to the new folder and the archive opens there.
    const location = resolveDataLocation(f.profile);
    assert.deepEqual(location, { dir, custom: true, previous: f.profile, problem: undefined });
    const repo = await SQLiteRepository.open(join(location.dir, 'sakli.sqlite'));
    try {
      const moved = new ArchiveService(repo, location.dir);
      assert.deepEqual(moved.snapshot(), before);
      assert.equal(moved.settings().theme, 'light');
      // Photos are referenced by id inside the data folder, so the same records open on either OS.
      for (const [i, photo] of f.photos.entries()) {
        assert.equal(moved.image(photo.id), `data:image/png;base64,${png(i + 1).toString('base64')}`);
        assert.equal(repo.get(i ? f.second.id : f.first.id)?.assets[0].name, 'Çiçek bahçesi ğüşiöç.png');
      }
      assert.equal(moved.backups().length, 1);
      moved.save(draft('Taşımadan sonra'));
      moved.createBackup();
      assert.equal(moved.backups().length, 2);
      assert.ok(moved.restoreBackup(moved.backups()[0].name) >= 0);
      assert.equal(readdirSync(join(dir, 'capture-inbox')).length, 1);
    } finally { repo.close(); }
  } finally { f.close(); }
});

test('dolu hedefte DubBitig alt klasörü kullanılır; ilgisiz dolu alt klasör reddedilir', async () => {
  const f = await setup();
  try {
    const chosen = join(f.base, 'Belgeler'); mkdirSync(chosen); writeFileSync(join(chosen, 'notlar.txt'), 'kişisel dosya');
    const plan = planRelocation(f.profile, chosen, f.profile);
    assert.equal(plan.kind, 'copy'); assert.equal(plan.target, join(chosen, 'DubBitig')); assert.equal(plan.kind === 'copy' && plan.nested, true);
    const result = await move(f, chosen);
    assert.equal(result.target, join(chosen, 'DubBitig'));
    assert.equal(readFileSync(join(chosen, 'notlar.txt'), 'utf8'), 'kişisel dosya');
    const other = join(f.base, 'Başka'); mkdirSync(join(other, 'DubBitig'), { recursive: true }); writeFileSync(join(other, 'a.txt'), ''); writeFileSync(join(other, 'DubBitig', 'b.txt'), '');
    assert.throws(() => planRelocation(join(chosen, 'DubBitig'), other, f.profile), /dolu bir “DubBitig” klasörü/);
  } finally { f.close(); }
});

test('içinde arşiv olan klasör seçilince kopyalanmaz; birleştirme iki arşivi de korur', async () => {
  const f = await setup(); const g = await setup();
  try {
    const plan = planRelocation(f.profile, g.profile, f.profile);
    assert.deepEqual(plan, { kind: 'existing', target: g.profile });
    assert.equal(findArchive(join(g.profile, '..', 'profil')), join(g.profile, '..', 'profil'));
    const info = await inspectArchive(g.profile); assert.equal(info.active, 3); assert.equal(info.missingPhotos, 0);
    // Merging uses the existing import: a safety backup of the target first, then newer-wins per record.
    f.service.save(draft('Yalnızca ilk arşivde'));
    const merged = g.service.importBytes(f.service.exportBytes(), 'merge');
    assert.ok(merged >= 1);
    assert.ok(g.service.snapshot().entries.some(e => e.title === 'Yalnızca ilk arşivde'));
    assert.ok(g.service.backups().some(b => b.name.endsWith('-before-import.sakli')));
  } finally { f.close(); g.close(); }
});

test('aynı konum, iç içe klasör ve uygulama klasörü reddedilir', async () => {
  const f = await setup();
  try {
    assert.throws(() => planRelocation(f.profile, f.profile, f.profile), /zaten şu anki veri konumu/);
    const inner = join(f.profile, 'alt'); mkdirSync(inner);
    assert.throws(() => planRelocation(f.profile, inner, f.profile), /içindeki bir klasör seçilemez/);
    assert.throws(() => planRelocation(f.profile, join(f.base, 'yok'), f.profile), /bulunamadı/);
    assert.throws(() => planRelocation(f.profile, 'göreli/klasör', f.profile), /Geçerli bir klasör/);
  } finally { f.close(); }
});

test('yazılamayan hedef ve yetersiz disk alanı işlemi başlatmadan durdurur', { skip: root && 'root kullanıcıda dosya izinleri sınanamaz' }, async () => {
  const f = await setup();
  try {
    const locked = target(f, 'Salt Okunur'); chmodSync(locked, 0o555);
    try { assert.throws(() => planRelocation(f.profile, locked, f.profile), /yazılamıyor/); } finally { chmodSync(locked, 0o755); }
    assert.throws(() => planRelocation(f.profile, target(f, 'Dolu Disk'), f.profile, { freeSpace: () => 1024 }), /yeterli boş alan yok/);
    assert.equal(readPointer(f.profile), undefined);
  } finally { f.close(); }
});

test('kopyalama hatasında eski konum etkin kalır ve yarım kopya kaldırılır', async () => {
  const f = await setup();
  try {
    const dir = target(f); let calls = 0;
    await assert.rejects(move(f, dir, { copy: (from: string, to: string) => { if (++calls === 2) throw Object.assign(new Error('disk dolu'), { code: 'ENOSPC' }); cpSync(from, to); } }), /yer kalmadı/);
    assert.equal(readPointer(f.profile), undefined);
    assert.equal(existsSync(join(f.profile, 'data-location-journal.json')), false);
    assert.deepEqual(readdirSync(dir), []);
    assert.equal(resolveDataLocation(f.profile).dir, f.profile);
    f.service.save(draft('Hatadan sonra')); assert.equal(f.service.snapshot().entries.length, 4);
  } finally { f.close(); }
});

test('kopya bozulursa veya veritabanı bozuksa geçiş yapılmaz', async () => {
  const f = await setup();
  try {
    const dir = target(f);
    await assert.rejects(move(f, dir, { copy: (from: string, to: string) => { cpSync(from, to); writeFileSync(to, 'bozuk'); } }), /doğrulanamadı/);
    const plan = planRelocation(f.profile, dir, f.profile); if (plan.kind !== 'copy') throw new Error();
    await assert.rejects(relocate(f.profile, f.profile, plan, Buffer.from('SQLite değil, bozuk içerik')), /bütünlük|açılamadı/);
    assert.equal(readPointer(f.profile), undefined); assert.deepEqual(readdirSync(dir), []);
    // An existing archive with a corrupt database is never adopted.
    const corrupt = join(f.base, 'Bozuk'); mkdirSync(corrupt); writeFileSync(join(corrupt, 'sakli.sqlite'), Buffer.alloc(4096, 7));
    await assert.rejects(inspectArchive(corrupt), /bozuk görünüyor/);
  } finally { f.close(); }
});

test('eksik fotoğraf taşımayı durdurmaz, başka kayda bağlanmaz ve raporlanır', async () => {
  const f = await setup();
  try {
    unlinkSync(join(f.profile, 'photos', f.photos[0].id));
    const result = await move(f, target(f));
    assert.equal(result.missingPhotos, 1);
    f.repo.close();
    const repo = await SQLiteRepository.open(join(result.target, 'sakli.sqlite'));
    try {
      const moved = new ArchiveService(repo, result.target);
      assert.equal(repo.get(f.first.id)?.assets[0].id, f.photos[0].id);
      assert.throws(() => moved.image(f.photos[0].id));
      assert.equal(moved.image(f.photos[1].id), `data:image/png;base64,${png(2).toString('base64')}`);
    } finally { repo.close(); }
  } finally { f.close(); }
});

test('geçiş yarıda kesilirse sonraki açılışta geri alınır; tamamlanmışsa yeni konum korunur', async () => {
  const f = await setup();
  try {
    const dir = target(f); const saved = join(f.base, 'kesinti'); let journal = '';
    // Captures the on-disk state right after "photos" was moved, as a power cut would leave it.
    await assert.rejects(move(f, dir, { moved: (name: string) => { if (name !== 'photos') return; journal = readFileSync(join(f.profile, 'data-location-journal.json'), 'utf8'); cpSync(dir, saved, { recursive: true }); throw new Error('elektrik kesildi'); } }), /elektrik kesildi/);
    rmSync(dir, { recursive: true }); cpSync(saved, dir, { recursive: true }); writeFileSync(join(f.profile, 'data-location-journal.json'), journal);
    assert.ok(existsSync(join(dir, 'photos')));
    assert.deepEqual(recoverRelocation(f.profile), { state: 'rolled-back', target: dir });
    assert.deepEqual(readdirSync(dir), []);
    assert.equal(resolveDataLocation(f.profile).dir, f.profile);
    assert.equal(recoverRelocation(f.profile), undefined);
    // Crash after the pointer was written: the move counts as complete.
    const result = await move(f, dir);
    writeFileSync(join(f.profile, 'data-location-journal.json'), journal.replace(/"phase": "\w+"/, '"phase": "committing"'));
    assert.equal(recoverRelocation(f.profile)?.state, 'committed');
    assert.equal(resolveDataLocation(f.profile).dir, result.target);
    assert.ok(existsSync(join(dir, 'sakli.sqlite')));
  } finally { f.close(); }
});

test('Windows ve Linux yolları birbirine karışmaz', () => {
  assert.equal(validAbsolute('D:\\DubBitigData', 'win32'), true);
  assert.equal(validAbsolute('\\\\nas\\paylasim\\DubBitig', 'win32'), true);
  assert.equal(validAbsolute('/mnt/ortak/DubBitigData', 'win32'), false);
  assert.equal(validAbsolute('\\DubBitigData', 'win32'), false);
  assert.equal(validAbsolute('D:\\DubBitigData', 'linux'), false);
  assert.equal(validAbsolute('/run/media/kullanıcı/Ortak Disk/DubBitig', 'linux'), true);
  assert.equal(samePath('D:\\Ortak\\DubBitig', 'd:/ortak/dubbitig/', 'win32'), true);
  assert.equal(samePath('/mnt/Ortak/DubBitig', '/mnt/ortak/dubbitig', 'linux'), false);
  assert.equal(isInside('D:\\Veri\\Alt', 'd:\\veri', 'win32'), true);
  assert.equal(isInside('D:\\Veri2', 'D:\\Veri', 'win32'), false);
  assert.equal(isInside('/mnt/veri/alt', '/mnt/veri', 'linux'), true);
  const base = mkdtempSync(join(tmpdir(), 'dubbitig-yol-'));
  try {
    // A Windows path copied into a Linux profile is reported, not opened or created.
    writePointer(base, 'D:\\DubBitigData');
    const location = resolveDataLocation(base, 'linux');
    assert.equal(location.problem, 'relative'); assert.match(problemText(location, 'linux'), /geçerli bir klasör yolu değil/);
    writeFileSync(join(base, 'data-location.json'), '{bozuk');
    assert.equal(resolveDataLocation(base).problem, 'pointer');
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test('bağlı olmayan ortak bölüm boş arşiv oluşturmaz; kullanıcıya açıklanır', async () => {
  const f = await setup();
  try {
    const unmounted = join(f.base, 'mnt', 'ortak', 'DubBitigData');
    writePointer(f.profile, unmounted, null);
    let location = resolveDataLocation(f.profile, 'linux');
    assert.equal(location.problem, 'missing'); assert.match(problemText(location, 'linux'), /bağlı olmayabilir/);
    assert.equal(existsSync(unmounted), false);
    // An empty mount point looks like a folder without the database.
    mkdirSync(unmounted, { recursive: true });
    location = resolveDataLocation(f.profile, 'linux');
    assert.equal(location.problem, 'no-archive'); assert.deepEqual(readdirSync(unmounted), []);
    if (!root) {
      writeFileSync(join(unmounted, 'sakli.sqlite'), f.repo.exportBytes()); chmodSync(unmounted, 0o555);
      try { assert.equal(checkArchiveDir(unmounted, 'linux'), 'read-only'); assert.match(problemText(resolveDataLocation(f.profile, 'linux'), 'linux'), /Hızlı Başlatma/); } finally { chmodSync(unmounted, 0o755); }
      assert.equal(resolveDataLocation(f.profile, 'linux').problem, undefined);
    }
  } finally { f.close(); }
});

test('ikinci DubBitig örneği aynı veri klasörünü kullanırken uyarı verilir', () => {
  const base = mkdtempSync(join(tmpdir(), 'dubbitig-kilit-'));
  try {
    const mine = acquireLock(base);
    assert.equal(lockOwner(base), undefined);
    assert.equal(lockOwner(base, { platform: 'win32', hostname: hostname(), pid: 4242 })?.id, mine.id);
    // Left behind by a hibernated Windows session on the same computer.
    writeFileSync(join(base, 'dubbitig.lock'), JSON.stringify({ id: 'windows', pid: 1234, platform: process.platform === 'win32' ? 'linux' : 'win32', hostname: hostname(), startedAt: new Date().toISOString() }));
    assert.equal(lockOwner(base)?.id, 'windows');
    releaseLock(base, mine.id); assert.equal(readLock(base)?.id, 'windows');
    // A crashed process on this system is a stale lock.
    writeFileSync(join(base, 'dubbitig.lock'), JSON.stringify({ id: 'eski', pid: 2 ** 22 + 17, platform: process.platform, hostname: hostname(), startedAt: new Date().toISOString() }));
    assert.equal(lockOwner(base), undefined);
    releaseLock(base, 'eski'); assert.equal(readLock(base), undefined);
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test('taşıma sırasında yazma durdurulur; dışarıdan değişen veritabanının üzerine yazılmaz', async () => {
  const f = await setup();
  try {
    f.repo.freeze(true);
    assert.throws(() => f.service.save(draft('Bakım sırasında')), /Veri konumu değiştiriliyor/);
    f.repo.freeze(false);
    f.service.save(draft('Bakımdan sonra'));
    const file = join(f.profile, 'sakli.sqlite');
    const other = await SQLiteRepository.open(file); new ArchiveService(other, f.profile).save(draft('Diğer sistemde eklenen')); other.close();
    const written = readFileSync(file);
    assert.throws(() => f.service.save(draft('Eski bellekteki kopya')), /başka bir uygulama tarafından değiştirildi/);
    assert.ok(readFileSync(file).equals(written));
    assert.equal(f.service.snapshot().entries.some(e => e.title === 'Eski bellekteki kopya'), false);
    unlinkSync(file);
    assert.throws(() => f.service.save(draft('Bölüm ayrıldı')), /bulunamıyor/);
  } finally { f.close(); }
});
