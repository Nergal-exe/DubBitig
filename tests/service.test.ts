import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync, mkdirSync, readdirSync } from 'node:fs';
import { migrateDataLocation } from '../electron/data-location';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { strToU8, zipSync, unzipSync, strFromU8 } from 'fflate';
import { SQLiteRepository } from '../electron/repository';
import { ArchiveService } from '../electron/service';
import type { Draft } from '../src/shared/model';
import { advanceDate, nextReminder } from '../electron/schedule';
import { parseMetadata, checkUrl, publicUrl, isPublicAddress, type WebFetcher } from '../electron/web';
import { randomUUID } from 'node:crypto';
import { captureDraft, captureFile, clipboardRequest, drainInbox, saveCapture } from '../electron/capture';
const draft = (title = 'Not'): Draft => ({ title, kind: 'note', description: 'Açıklama', content: 'İstanbul için bir not', category: 'Günlük', tags: ['iş'], url: '', favorite: false, assets: [] });
const pngBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
async function fixture() { const dir = mkdtempSync(join(tmpdir(), 'sakli-test-')); const repo = await SQLiteRepository.open(join(dir, 'sakli.sqlite')); const service = new ArchiveService(repo, dir); return { dir, repo, service, close() { repo.close(); rmSync(dir, { recursive: true, force: true }); } }; }
test('çoklu kategori ve her kayıt türü ayrı aktarılır; kısmi dosya tam geri yüklemede reddedilir',async()=>{
  const f=await fixture(),target=await fixture();try {
    const file=join(f.dir,'image.png');writeFileSync(file,pngBytes);const photo=f.service.addPhoto(file);
    for(const kind of ['command','program','link','note','photo'] as const) f.service.save({...draft(kind),kind,url:kind==='link'?'https://example.com':'',category:kind==='command'?'İş':kind==='photo'?'':'Kişisel',tags:[kind],assets:kind==='photo'?[photo]:[]});
    const deleted=f.service.save({...draft('silinen komut'),kind:'command',category:'İş'});f.service.trash(deleted.id);
    f.service.category('add','Boş');
    assert.throws(()=>f.service.exportBytes({kind:'types',types:[]}));assert.throws(()=>f.service.exportBytes({kind:'categories',categories:[]}));assert.throws(()=>f.service.exportBytes({kind:'categories',categories:['olmayan']}));
    for(const kind of ['command','program','link','note','photo'] as const){
      const bytes=f.service.exportBytes({kind:'types',types:[kind]});const files=unzipSync(bytes);const manifest=JSON.parse(strFromU8(files['manifest.json']));
      assert.equal(manifest.entries.length,1);assert.equal(manifest.entries[0].kind,kind);assert.deepEqual(manifest.tags,[kind]);assert.equal(Object.keys(files).filter(p=>p.startsWith('photos/')).length,kind==='photo'?1:0);
      assert.throws(()=>target.service.importBytes(bytes,'replace'),/tam yedek/);assert.equal(target.service.importBytes(bytes,'merge'),1);
    }
    assert.equal(target.service.snapshot().entries.length,5);
    const categories=JSON.parse(strFromU8(unzipSync(f.service.exportBytes({kind:'categories',categories:['İş','','Boş','İş']}))['manifest.json']));
    assert.deepEqual(categories.categories,['İş','Boş']);assert.equal(categories.entries.length,2);assert.equal(categories.entries.some((e: {deletedAt:string|null})=>e.deletedAt),false);
    const all=JSON.parse(strFromU8(unzipSync(f.service.exportBytes())['manifest.json']));assert.equal(all.entries.length,6);
  }finally{f.close();target.close();}
});
test('bütün verileri sil yazılı onay ister; fotoğraf, geçmiş ve yerel yedekleri temizler', async()=>{
  const f=await fixture();try {
    const path=join(f.dir,'source.png');writeFileSync(path,pngBytes);const asset=f.service.addPhoto(path);
    const e=f.service.save({...draft('Gizli veri'),assets:[asset]});f.service.save({...draft('Yeni sürüm'),assets:[asset]},e.id);f.service.createBackup();
    f.repo.setting('theme','light');assert.throws(()=>f.service.deleteAllData('sil'));assert.equal(f.service.snapshot().entries.length,1);
    f.service.deleteAllData('BÜTÜN VERİLERİ SİL');assert.deepEqual(f.service.snapshot(),{entries:[],categories:[],tags:[]});
    assert.deepEqual(readdirSync(f.service.assetPath),[]);assert.deepEqual(f.service.backups(),[]);assert.equal(f.service.settings().theme,'dark');
    assert.equal(readFileSync(join(f.dir,'sakli.sqlite')).includes(Buffer.from('Gizli veri')),false);
    f.service.save(draft('Yeni başlangıç'));assert.equal(f.service.snapshot().entries.length,1);
  }finally{f.close();}
});
test('klasör taşıma Chrome gelen kutusunu, veritabanını, fotoğrafları ve yedekleri korur',async()=>{
  const root=mkdtempSync(join(tmpdir(),'dubbitig-migration-'));try{
    const legacy=join(root,'sakli');mkdirSync(legacy);const repo=await SQLiteRepository.open(join(legacy,'sakli.sqlite'));const service=new ArchiveService(repo,legacy);
    const file=join(root,'a.png');writeFileSync(file,pngBytes);service.save({...draft(),assets:[service.addPhoto(file)]});service.createBackup();repo.setting('theme','light');repo.close();
    const inbox=join(root,'DubBitig','capture-inbox');mkdirSync(inbox,{recursive:true});writeFileSync(join(inbox,'pending.json'),'request');
    const result=migrateDataLocation(root);assert.equal(result,join(root,'DubBitig'));assert.equal(existsSync(legacy),false);assert.equal(readFileSync(join(inbox,'pending.json'),'utf8'),'request');
    const migrated=await SQLiteRepository.open(join(result,'sakli.sqlite'));try{const current=new ArchiveService(migrated,result);assert.equal(current.snapshot().entries.length,1);assert.equal(current.settings().theme,'light');assert.equal(current.backups().length,1);assert.equal(readdirSync(current.assetPath).length,1);}finally{migrated.close();}
    assert.equal(migrateDataLocation(root),result);
  }finally{rmSync(root,{recursive:true,force:true});}
});
test('Markdown ve kod dili yedekleme ve sürüm geçmişinde korunur',async()=>{
  const f=await fixture();try{const content='# Başlık\n\n**Kalın**\n\n```powershell\nGet-Process\n```';const e=f.service.save({...draft(),content,language:'powershell'});f.service.save({...draft(),content:'Yeni'},e.id);assert.equal(f.service.history(e.id)[0].draft.content,content);assert.equal(f.service.history(e.id)[0].draft.language,'powershell');f.service.restoreRevision(e.id,f.service.history(e.id)[0].id);assert.equal(f.repo.get(e.id)?.language,'powershell');}finally{f.close();}
});
test('harici kayıtlar doğrulanır, yinelenmez ve komut metni aynen korunur',async()=>{
  const f=await fixture();try{const p={id:randomUUID(),type:'save',kind:'command',text:'echo "$(whoami) & < > Türkçe"',sourceUrl:'https://example.com'};
  const e=saveCapture(f.service,p);assert.equal(e.content,p.text);assert.equal(e.kind,'command');saveCapture(f.service,p);assert.equal(f.service.snapshot().entries.length,1);
  assert.throws(()=>captureDraft({...p,kind:'link',url:'javascript:alert(1)'}));assert.throws(()=>captureDraft({...p,text:''}));
  assert.equal(clipboardRequest('https://example.com/').kind,'link');assert.equal(clipboardRequest('Get-Process').kind,'note');
  }finally{f.close();}
});
test('Windows metin ve komut dosyaları içerik olarak, bilinmeyen dosyalar konum olarak kaydedilir',async()=>{
  const f=await fixture();try{const p=join(f.dir,'örnek.ps1');writeFileSync(p,'Write-Output "Merhaba"');assert.equal(captureFile(f.service,p).kind,'command');
  const u=join(f.dir,'örnek.url');writeFileSync(u,'[InternetShortcut]\r\nURL=https://example.com/test');assert.equal(captureFile(f.service,u).url,'https://example.com/test');
  const b=join(f.dir,'örnek.bin');writeFileSync(b,Buffer.from([1,2,3]));assert.equal(captureFile(f.service,b).content,b);
  }finally{f.close();}
});
test('gelen kutusu yalnızca doğrulanmış kayıtları alır ve kalıcı makbuz üretir',async()=>{
  const f=await fixture();try{drainInbox(f.service,()=>{});const id=randomUUID();const folder=join(f.dir,'capture-inbox');const file=join(folder,id+'.json');
  const p={id,type:'save',kind:'note',text:'Kaybolmayan kayıt'};writeFileSync(file,JSON.stringify(p));drainInbox(f.service,()=>{});
  assert.equal(JSON.parse(readFileSync(join(folder,id+'.result'),'utf8')).ok,true);assert.equal(existsSync(file),false);
  writeFileSync(file,JSON.stringify(p));drainInbox(f.service,()=>{});assert.equal(f.service.snapshot().entries.length,1);
  const invalid=randomUUID();writeFileSync(join(folder,invalid+'.json'),JSON.stringify({...p,id:'../escape'}));drainInbox(f.service,()=>{});assert.equal(JSON.parse(readFileSync(join(folder,invalid+'.result'),'utf8')).ok,false);
  }finally{f.close();}
});

test('kategori temizliği bir kez çalışır, kayıtları korur ve önce yedek alır', async () => {
  const f = await fixture(); try {
    const e = f.service.save(draft()); f.service.clearExistingCategories();
    assert.equal(f.repo.get(e.id)?.category,''); assert.equal(f.repo.get(e.id)?.content,e.content);
    assert.deepEqual(f.service.snapshot().categories,[]);
    const backup = f.service.backups().find(b => b.name.includes('before-category-clear')); assert.ok(backup);
    const old = JSON.parse(strFromU8(unzipSync(readFileSync(join(f.service.backupPath,backup.name)))['manifest.json'])); assert.equal(old.entries[0].category,'Günlük');
    f.service.category('add','Yeni'); f.service.clearExistingCategories(); assert.deepEqual(f.service.snapshot().categories,['Yeni']);
  } finally { f.close(); }
});
test('takvim aylık tekrarları ay sonunda sabit güne geri getirir', () => {
  const jan = new Date(2028,0,31,10,30).toISOString(); const feb = advanceDate(jan,'monthly');
  assert.equal(new Date(feb).getDate(),29); assert.equal(new Date(feb).getHours(),10);
  const march = nextReminder(jan,'monthly',new Date(2028,2,1),31); assert.equal(new Date(march).getMonth(),2); assert.equal(new Date(march).getDate(),31);
  assert.equal(new Date(advanceDate(jan,'weekly')).getTime()-new Date(jan).getTime(),7*86400000);
});
test('haftalık ve aylık yedek sıklığı kalıcıdır ve erken yedek oluşturmaz', async () => {
  const f = await fixture(); try {
    f.service.setBackupPeriod('weekly'); f.service.autoBackup(); f.service.save(draft());
    f.service.autoBackup(new Date(Date.now()+2*86400000)); assert.equal(f.service.backups().length,1);
    f.service.autoBackup(new Date(Date.now()+8*86400000)); assert.equal(f.service.backups().length,2);
    f.service.setBackupPeriod('monthly'); assert.equal(f.service.settings().backupPeriod,'monthly');
    assert.throws(() => f.service.setBackupPeriod('invalid' as never));
    const repo = await SQLiteRepository.open(join(f.dir,'sakli.sqlite')); assert.equal(new ArchiveService(repo,f.dir).settings().backupPeriod,'monthly'); repo.close();
  } finally { f.close(); }
});
test('sürüm geri yükleme mevcut içeriği saklar ve kategori/etiketleri geri almaz', async () => {
  const f = await fixture(); try {
    const original = f.service.save(draft()); const e = f.service.save({...original,content:'Yeni içerik'},original.id);
    assert.equal(e.history?.length,1); f.service.category('delete','Günlük'); f.service.tag('delete','iş');
    const restored = f.service.restoreRevision(e.id,e.history![0].id);
    assert.equal(restored.content,original.content); assert.equal(restored.category,''); assert.deepEqual(restored.tags,[]);
    assert.equal(restored.history?.[0].draft.content,'Yeni içerik');
    let current = restored; for(let i=0;i<55;i++) current = f.service.save({...current,content:`Sürüm ${i}`},current.id);
    assert.equal(current.history?.length,50);
  } finally { f.close(); }
});
test('geçmişte kalan fotoğraf yedekten başka bilgisayara geri gelir', async () => {
  const a=await fixture(), b=await fixture(); try {
    const file=join(a.dir,'old.png'); writeFileSync(file,pngBytes); const asset=a.service.addPhoto(file);
    const e=a.service.save({...draft(),assets:[asset]}); a.service.save({...e,assets:[],content:'Fotoğraf kaldırıldı'},e.id);
    b.service.importBytes(a.service.exportBytes(),'merge'); const h=b.service.history(e.id)[0];
    assert.equal(b.service.image(h.draft.assets[0].id),`data:image/png;base64,${pngBytes.toString('base64')}`);
    assert.equal(b.service.restoreRevision(e.id,h.id).assets.length,1);
  } finally {a.close();b.close();}
});
test('hatırlatma, aylık tekrar, son kullanım ve okundu durumu yalnızca bir kez işlenir', async () => {
  const f=await fixture(); try {
    const at=new Date(2028,0,31,10).toISOString(); const now=new Date(2028,1,5,10);
    const e=f.service.save({...draft(),reminder:{at,repeat:'monthly',enabled:true},expiresAt:at}); let delivered=0;
    f.service.processReminders(()=>{delivered++;throw new Error('Windows kapalı');},now);
    let current=f.repo.get(e.id)!; assert.equal(delivered,2); assert.equal(current.notices?.length,2); assert.equal(new Date(current.reminder!.at).getDate(),29);
    f.service.processReminders(()=>delivered++,now); assert.equal(delivered,2);
    f.service.readNotice(e.id,current.notices![0].id); assert.equal(f.repo.get(e.id)!.notices![0].read,true);
    f.service.processReminders(()=>delivered++,new Date(2028,2,1)); current=f.repo.get(e.id)!; assert.equal(new Date(current.reminder!.at).getDate(),31); assert.equal(delivered,3);
    const once=f.service.save({...draft('Bir kez'),reminder:{at,repeat:'once',enabled:true}});
    const trashed=f.service.save({...draft('Silinmiş'),reminder:{at,repeat:'once',enabled:true}}); f.service.trash(trashed.id);
    f.service.processReminders(()=>delivered++,now); assert.equal(f.repo.get(once.id)!.reminder!.enabled,false); assert.equal(f.repo.get(trashed.id)!.notices?.length,0);
  } finally {f.close();}
});
test('web metadatası, yerel ikon ve önizleme arşivde taşınır', async () => {
  const a=await fixture(), b=await fixture(); try {
    const html='<title>Yedek başlık</title><meta property="og:title" content="Türkçe &amp; Başlık"><meta name="description" content="Açıklama"><meta property="og:image" content="/cover.png"><link rel="icon" href="/icon.png">';
    const meta=parseMetadata(html,'https://example.com/post'); assert.equal(meta.title,'Türkçe & Başlık'); assert.equal(meta.imageUrl,'https://example.com/cover.png');
    const fetcher:WebFetcher=async url=>({url,status:200,headers:{'content-type':url.endsWith('.png')?'image/png':'text/html'},bytes:url.endsWith('.png')?pngBytes:Buffer.from(html)});
    const preview=await a.service.previewUrl('https://example.com/post',b=>b,fetcher); assert.ok(preview.favicon);assert.ok(preview.image);
    const e=a.service.save({...draft(),kind:'link',url:preview.url,preview}); b.service.importBytes(a.service.exportBytes(),'merge');
    assert.equal(b.service.image(b.repo.get(e.id)!.preview!.image!.id),`data:image/png;base64,${pngBytes.toString('base64')}`);
    assert.equal(a.service.save({...e,url:'https://example.com/new'},e.id).preview,null);
  } finally {a.close();b.close();}
});
test('bağlantı denetimi 404/410 kırık, 403/zaman aşımı belirsiz ve 200 sağlam ayırır', async () => {
  for(const [status,state] of [[404,'broken'],[410,'broken'],[403,'unknown'],[500,'unknown'],[200,'ok']] as const) {
    const c=await checkUrl('https://example.com',async url=>({url,status,headers:{},bytes:Buffer.alloc(0)})); assert.equal(c.state,state);
  }
  assert.equal((await checkUrl('https://example.com',async()=>{throw new Error('timeout');})).state,'unknown');
  for(const url of ['http://127.0.0.1','http://169.254.169.254','http://192.168.1.1','http://[::1]','file:///etc/passwd','https://example.com:1234','https://user:pass@example.com']) assert.throws(()=>publicUrl(url));
  assert.equal(isPublicAddress('10.0.0.1'),false); assert.equal(isPublicAddress('8.8.8.8'),true);
});
test('arka plan denetimi düzenlenen URL üzerine eski sonuç yazmaz ve günlük tekrarlar', async () => {
  const f=await fixture();try {
    const e=f.service.save({...draft(),kind:'link',url:'https://example.com/old'});
    const r=await f.service.checkLinks(undefined,async url=>{f.service.save({...f.repo.get(e.id)!,url:'https://example.com/new'},e.id); return {url,status:404,headers:{},bytes:Buffer.alloc(0)};}); assert.equal(r.checked,0); assert.equal(f.repo.get(e.id)!.linkCheck,null);
    const fetcher:WebFetcher=async url=>({url,status:404,headers:{},bytes:Buffer.alloc(0)});
    assert.equal((await f.service.checkLinks(undefined,fetcher,true)).broken,1); assert.equal((await f.service.checkLinks(undefined,fetcher,true)).checked,0);
  } finally {f.close();}
});

test('kayıtlar, Unicode ve değişiklikler SQLite yeniden açılınca korunur', async () => {
  const f = await fixture();
  try { const e = f.service.save(draft('Türkçe ŞİĞÖÇÜ')); const updated = f.service.save({ ...e, content: 'Düzenlendi', favorite: true }, e.id); assert.equal(updated.createdAt, e.createdAt); assert.equal(updated.revision, 2); const second = await SQLiteRepository.open(join(f.dir, 'sakli.sqlite')); assert.equal(second.get(e.id)?.content, 'Düzenlendi'); assert.equal(second.get(e.id)?.favorite, true); assert.ok(second.categories().includes('Günlük')); second.close(); } finally { f.close(); }
});
test('silme, geri alma ve kategori değişikliği kayıtları korur', async () => { const f = await fixture(); try { const e = f.service.save(draft()); f.service.trash(e.id); assert.ok(f.repo.get(e.id)?.deletedAt); f.service.trash(e.id, true); assert.equal(f.repo.get(e.id)?.deletedAt, null); f.service.category('rename', 'Günlük', 'İş'); assert.equal(f.repo.get(e.id)?.category, 'İş'); f.service.category('delete', 'İş'); assert.equal(f.repo.get(e.id)?.category, ''); assert.throws(() => f.service.category('add', '')); } finally { f.close(); } });
test('fotoğraflar dahil dışarı aktarma ve başka veritabanına geri yükleme', async () => {
  const a = await fixture(); const b = await fixture();
  try { const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64'); const p = join(a.dir, 'fotoğraf.png'); writeFileSync(p, png); const asset = a.service.addPhoto(p); const saved = a.service.save({ ...draft('Fotoğrafım'), kind: 'photo', assets: [asset] }); const archive = a.service.exportBytes(); assert.equal(b.service.importBytes(archive, 'merge'), 1); assert.deepEqual(b.repo.get(saved.id), saved); assert.equal(b.service.image(asset.id), `data:image/png;base64,${png.toString('base64')}`); assert.equal(b.service.importBytes(archive, 'merge'), 0); assert.ok(b.service.backups().length); } finally { a.close(); b.close(); }
});
test('bozuk yedek mevcut kayıtlara dokunmaz; eski sürüm yenisini ezmez', async () => { const f = await fixture(); try { const e = f.service.save(draft()); const exported = f.service.exportBytes(); f.service.save({ ...e, content: 'Yeni içerik' }, e.id); f.service.importBytes(exported, 'merge'); assert.equal(f.repo.get(e.id)?.content, 'Yeni içerik'); assert.throws(() => f.service.importBytes(zipSync({ 'manifest.json': strToU8('{bozuk') }), 'replace')); assert.equal(f.repo.get(e.id)?.content, 'Yeni içerik'); } finally { f.close(); } });
test('eksik fotoğraflı arşiv reddedilir ve mevcut veriler değişmez', async () => { const f = await fixture(); try { f.service.save(draft()); const files = unzipSync(f.service.exportBytes()); const manifest = JSON.parse(strFromU8(files['manifest.json'])); manifest.entries[0].assets = [{ id: '2f6d5a73-874d-44e9-b0d9-24bc143063ea', name: 'x.png', mime: 'image/png', size: 9 }]; files['manifest.json'] = strToU8(JSON.stringify(manifest)); assert.throws(() => f.service.importBytes(zipSync(files), 'replace'), /eksik veya bozuk/); assert.equal(f.service.snapshot().entries[0].assets.length, 0); } finally { f.close(); } });
test('tam geri yükleme öncesinde güvenlik yedeği alınır', async () => { const f = await fixture(); try { const first = f.service.save(draft('İlk')); const backup = f.service.exportBytes(); f.service.save(draft('İkinci')); f.service.importBytes(backup, 'replace'); assert.deepEqual(f.service.snapshot().entries.map(e => e.id), [first.id]); const safety = f.service.backups().find(b => b.name.includes('before-import')); assert.ok(safety); const manifest = JSON.parse(strFromU8(unzipSync(readFileSync(join(f.service.backupPath, safety.name)))['manifest.json'])); assert.equal(manifest.entries.length, 2); } finally { f.close(); } });
test('kimlik ve URL doğrulama; fotoğrafta dosya yolu kaçışı engellenir', async () => { const f = await fixture(); try { assert.throws(() => f.service.image('../sakli.sqlite')); assert.throws(() => f.service.save({ ...draft(), kind: 'link', url: 'javascript:alert(1)' })); assert.throws(() => f.service.save({ ...draft(), kind: 'command', content: '' })); assert.throws(() => f.service.save({ ...draft(), kind: 'photo' })); assert.throws(() => f.service.restoreBackup('../sakli.sqlite')); assert.ok(existsSync(f.dir)); } finally { f.close(); } });
test('otomatik yedek değişmemiş veriyi çoğaltmaz ve kapatılabilir', async () => { const f = await fixture(); try { f.service.save(draft()); f.service.autoBackup(); assert.equal(f.service.backups().length, 1); f.service.autoBackup(); assert.equal(f.service.backups().length, 1); f.repo.setting('autoBackup', 'false'); f.service.save(draft('Yeni')); f.service.autoBackup(); assert.equal(f.service.backups().length, 1); } finally { f.close(); } });
test('kategori değişiklikleri süre dolunca otomatik yedeğe dahil edilir', async () => { const f = await fixture(); try { f.service.autoBackup(); f.service.category('add', 'Boş kategori'); f.service.autoBackup(); assert.equal(f.service.backups().length, 1); f.service.autoBackup(new Date(Date.now() + 86401000)); assert.equal(f.service.backups().length, 2); } finally { f.close(); } });

test('kategori aktarımı başka kategorileri, çöp kutusunu ve ilgisiz fotoğrafları içermez', async () => {
  const f = await fixture(); try {
    const path = join(f.dir, 'db.png'); writeFileSync(path, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64'));
    const a = f.service.addPhoto(path); const b = f.service.addPhoto(path);
    f.service.save({ ...draft('A kaydı'), category: 'A', assets: [a] });
    f.service.save({ ...draft('B kaydı'), category: 'B', assets: [b] });
    const trash = f.service.save({ ...draft('Silinmiş'), category: 'A' }); f.service.trash(trash.id);
    const files = unzipSync(f.service.exportBytes({ kind: 'category', category: 'A' }));
    const manifest = JSON.parse(strFromU8(files['manifest.json']));
    assert.equal(manifest.entries.length, 1); assert.deepEqual(manifest.categories, ['A']);
    assert.equal(manifest.scope.kind, 'category'); assert.ok(files[`photos/${a.id}`]); assert.equal(files[`photos/${b.id}`], undefined);
    assert.throws(() => f.service.importBytes(f.service.exportBytes({ kind: 'category', category: 'A' }), 'replace'), /tam yedek/);
    assert.equal(f.service.snapshot().entries.length, 3);
  } finally { f.close(); }
});
test('bir kategoriye içe aktarma orijinalleri taşımadan yeni kayıt kimlikleri oluşturur', async () => {
  const f = await fixture(); try {
    const source = f.service.save({ ...draft('Kaynak'), category: 'A' });
    const bytes = f.service.exportBytes({ kind: 'category', category: 'A' });
    assert.equal(f.service.importBytes(bytes, 'merge', { kind: 'category', category: 'B' }), 1);
    const all = f.service.snapshot(); assert.equal(all.entries.length, 2);
    assert.equal(f.repo.get(source.id)?.category, 'A');
    const copied = all.entries.find(e => e.category === 'B')!; assert.ok(copied); assert.notEqual(copied.id, source.id); assert.equal(copied.content, source.content);
    assert.ok(all.categories.includes('B')); assert.throws(() => f.service.importBytes(bytes, 'replace', { kind: 'category', category: 'B' }));
  } finally { f.close(); }
});
test('kategorisiz ve boş kategori ayrı aktarılabilir; eski Saklı arşivleri okunur', async () => {
  const a = await fixture(); const b = await fixture(); try {
    a.service.save({ ...draft(), category: '' }); a.service.category('add', 'Boş');
    assert.equal(JSON.parse(strFromU8(unzipSync(a.service.exportBytes({ kind: 'category', category: '' }))['manifest.json'])).entries.length, 1);
    b.service.importBytes(a.service.exportBytes({ kind: 'category', category: 'Boş' }), 'merge'); assert.ok(b.service.snapshot().categories.includes('Boş')); assert.equal(b.service.snapshot().entries.length, 0);
    const files = unzipSync(a.service.exportBytes()); const legacy = JSON.parse(strFromU8(files['manifest.json'])); delete legacy.scope;
    files['manifest.json'] = strToU8(JSON.stringify(legacy)); assert.equal(b.service.importBytes(zipSync(files), 'merge'), 1);
  } finally { a.close(); b.close(); }
});
test('tema tercihi yeniden açılış ve arşiv geri yüklemesinden sonra korunur', async () => {
  const f = await fixture(); try {
    assert.equal(f.service.settings().theme, 'dark'); f.repo.setting('theme', 'light');
    const bytes = f.service.exportBytes(); f.service.importBytes(bytes, 'replace'); assert.equal(f.service.settings().theme, 'light');
    const second = await SQLiteRepository.open(join(f.dir, 'sakli.sqlite')); assert.equal(second.setting('theme'), 'light'); second.close();
  } finally { f.close(); }
});

test('etiket yönetimi aktif ve silinmiş kayıtları koruyarak etiketleri günceller', async () => {
  const f = await fixture(); try {
    const active = f.service.save(draft('Aktif')); const removed = f.service.save(draft('Çöpte')); f.service.trash(removed.id);
    f.service.tag('add', 'boş etiket'); f.service.tag('rename', 'iş', 'çalışma');
    assert.deepEqual(f.repo.get(active.id)?.tags, ['çalışma']); assert.deepEqual(f.repo.get(removed.id)?.tags, ['çalışma']);
    assert.throws(() => f.service.tag('rename', 'çalışma', 'boş etiket'));
    f.service.tag('delete', 'çalışma'); assert.equal(f.service.snapshot().entries.length, 2);
    assert.deepEqual(f.repo.get(active.id)?.tags, []); assert.deepEqual(f.repo.get(removed.id)?.tags, []); assert.ok(f.repo.get(removed.id)?.deletedAt);
    const reopened = await SQLiteRepository.open(join(f.dir, 'sakli.sqlite')); assert.deepEqual(reopened.snapshot().tags, ['boş etiket']); reopened.close();
    f.service.tag('delete', 'boş etiket'); assert.deepEqual(f.service.snapshot().tags, []);
  } finally { f.close(); }
});
test('kullanılmayan etiketler yedeklenir; eski arşivlerin etiketleri kayıtlardan türetilir', async () => {
  const a = await fixture(); const b = await fixture(); try {
    a.service.tag('add', 'sonra'); a.service.save(draft()); b.service.importBytes(a.service.exportBytes(), 'merge');
    assert.ok(b.service.snapshot().tags.includes('sonra')); assert.ok(b.service.snapshot().tags.includes('iş'));
    const files = unzipSync(a.service.exportBytes()); const legacy = JSON.parse(strFromU8(files['manifest.json'])); delete legacy.tags; files['manifest.json'] = strToU8(JSON.stringify(legacy));
    b.service.importBytes(zipSync(files), 'replace'); assert.deepEqual(b.service.snapshot().tags, ['iş']);
  } finally { a.close(); b.close(); }
});
