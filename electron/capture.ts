import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { z } from 'zod';
import type { Draft, Entry } from '../src/shared/model.js';
import { atomicWrite } from './repository.js';
import type { ArchiveService } from './service.js';

const webUrl = z.string().max(4000).refine(v => { try { return ['http:','https:'].includes(new URL(v).protocol); } catch { return false; } }, 'Geçerli bir HTTP/HTTPS bağlantısı gerekli.');
export const captureSchema = z.object({ id:z.string().uuid(), type:z.literal('save'), kind:z.enum(['note','command','link']), text:z.string().max(200000).default(''), title:z.string().max(200).default(''), url:z.union([webUrl,z.literal('')]).default(''), sourceUrl:z.union([webUrl,z.literal('')]).default('') }).superRefine((v,ctx) => { if(v.kind === 'link' ? !v.url : !v.text.trim()) ctx.addIssue({code:'custom',message:'Kaydedilecek içerik boş.'}); });
export type CaptureRequest = z.infer<typeof captureSchema>;
export function captureDraft(input: unknown): Draft {
  const p=captureSchema.parse(input);
  return {kind:p.kind,title:(p.title.trim() || (p.kind==='link'?new URL(p.url).hostname:p.text.trim().split(/\r?\n/)[0])).slice(0,200),content:p.kind==='link'?'':p.text,url:p.url,description:p.sourceUrl && p.sourceUrl!==p.url?`Kaynak: ${p.sourceUrl}`:'',category:'',tags:['hızlı kayıt'],favorite:false,assets:[]};
}
export function saveCapture(service: ArchiveService, input: unknown): Entry {
  const p=captureSchema.parse(input); const existing=service.repo.get(p.id);
  // Request UUID is the entry UUID: retries and crash recovery cannot create duplicate records.
  return existing ?? service.save(captureDraft(p),undefined,p.id);
}
export function clipboardRequest(text: string): CaptureRequest {
  text=text.trim(); const isLink=webUrl.safeParse(text).success;
  return captureSchema.parse({id:randomUUID(),type:'save',kind:isLink?'link':'note',text:isLink?'':text,url:isLink?text:'',title:'',sourceUrl:''});
}
export function captureFile(service: ArchiveService, path: string) {
  const stat=statSync(path); if(!stat.isFile())throw new Error('Bir dosya seç.');
  const extension=extname(path).toLowerCase();
  const base:Draft={title:basename(path).slice(0,200),kind:'note',content:path,url:'',description:`Dosya: ${path}`,category:'',tags:['hızlı kayıt'],favorite:false,assets:[]};
  if(['.png','.jpg','.jpeg','.gif','.webp'].includes(extension)) { base.kind='photo';base.assets=[service.addPhoto(path)];base.content=''; }
  else if(['.txt','.md','.ps1','.cmd','.bat','.sh','.url'].includes(extension)) {
    if(stat.size>200000)throw new Error('Metin dosyası en fazla 200 KB olabilir.');
    const bytes=readFileSync(path); const text=bytes[0]===255 && bytes[1]===254?bytes.subarray(2).toString('utf16le'):bytes.toString('utf8').replace(/^\uFEFF/,'');
    if(extension==='.url') { base.url=webUrl.parse(text.match(/^URL=(.+)$/im)?.[1].trim());base.kind='link';base.content=''; }
    else {base.content=text;base.kind=['.ps1','.cmd','.bat','.sh'].includes(extension)?'command':'note';}
  } else if(extension==='.exe') {base.kind='program';base.description='Program konumu kaydedildi; dosya kopyalanmadı.';}
  else base.description='Dosya konumu kaydedildi; dosyanın kendisi kopyalanmadı.';
  return service.save(base);
}
export function drainInbox(service: ArchiveService, onSaved:(e:Entry)=>void) {
  const folder=join(service.dataPath,'capture-inbox');mkdirSync(folder,{recursive:true});
  for(const name of readdirSync(folder).filter(n=>/^[a-f0-9-]{36}\.json$/.test(n)).slice(0,100)) {
    const file=join(folder,name);const id=name.slice(0,-5);const receipt=join(folder,`${id}.result`);
    try {
      if(statSync(file).size>1024*1024)throw new Error('İçerik boyut sınırını aşıyor.');
      const p=captureSchema.parse(JSON.parse(readFileSync(file,'utf8').replace(/^\uFEFF/,'')));if(p.id!==id)throw new Error('İstek kimliği uyuşmuyor.');
      const entry=saveCapture(service,p);atomicWrite(receipt,JSON.stringify({ok:true,id:entry.id,title:entry.title}));unlinkSync(file);onSaved(entry);
    } catch(e) {atomicWrite(receipt,JSON.stringify({ok:false,error:e instanceof Error?e.message:'Kayıt alınamadı.'}));if(existsSync(file))unlinkSync(file);}
  }
  // A disconnected browser may leave a receipt behind; no archive data is removed.
  for(const name of readdirSync(folder).filter(n=>/^[a-f0-9-]{36}\.result$/.test(n))) {const file=join(folder,name);if(Date.now()-statSync(file).mtimeMs>86400000)unlinkSync(file);}
}
