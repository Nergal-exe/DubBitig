import { _electron as electron, expect } from '@playwright/test';
import {spawn} from 'node:child_process';
import {mkdirSync,readFileSync,writeFileSync,existsSync} from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
const root=process.cwd();const data=path.join(root,'.test-data',`capture-${Date.now()}`);mkdirSync(data,{recursive:true});
const exe=process.env.SAKLI_TEST_EXE || path.join(root,'release-dubbitig/win-unpacked/DubBitig.exe');
const hostDir=path.join(path.dirname(exe),'resources/native-host');
const manifest=JSON.parse(readFileSync(path.join(hostDir,'com.dubbitig.capture.json'),'utf8'));
const env={...process.env,DUBBITIG_DATA_DIR:data,DUBBITIG_CAPTURE_EXE:exe};delete env.ELECTRON_RUN_AS_NODE;
function native(request,origin=manifest.allowed_origins[0]) {return new Promise((resolve,reject)=>{
  const child=spawn(path.join(hostDir,'DubBitig.NativeHost.exe'),[origin],{env,windowsHide:true});let chunks=[];let err='';let completed=false;
  child.stdout.on('data',part=>{chunks.push(part);const b=Buffer.concat(chunks);if(b.length>=4 && b.length>=4+b.readUInt32LE(0)){completed=true;resolve(JSON.parse(b.subarray(4,4+b.readUInt32LE(0)).toString('utf8')));child.stdout.destroy();child.stderr.destroy();child.unref();}});child.stderr.on('data',b=>err+=b);child.on('error',reject);
  child.on('close',()=>{if(!completed)reject(new Error(err || 'Native host did not reply'));});
  const b=Buffer.from(JSON.stringify(request));const header=Buffer.alloc(4);header.writeUInt32LE(b.length);child.stdin.end(Buffer.concat([header,b]));
});}
let coldPid;let app=await electron.launch({executablePath:exe,args:[],env,cwd:root,timeout:30000});
try {
  let page=await app.firstWindow();await page.waitForLoadState('domcontentloaded');
  await page.evaluate(()=>window.sakli.setLinkChecker(false));
  const text='Get-ChildItem "C:\\İş dosyaları"\nWrite-Output \'$() & < > Türkçe\'';
  const request={id:randomUUID(),type:'save',kind:'command',text,title:'',url:'',sourceUrl:'https://example.com/'};
  const saved=await native(request);expect(saved.ok).toBe(true);
  await expect(page.locator('.detail-panel h2')).toHaveText(text.split('\n')[0]);
  let snapshot=await page.evaluate(()=>window.sakli.snapshot());expect(snapshot.entries).toHaveLength(1);expect(snapshot.entries[0].content).toBe(text);
  expect((await native(request)).ok).toBe(true);expect((await page.evaluate(()=>window.sakli.snapshot())).entries).toHaveLength(1);
  expect((await native({...request,id:randomUUID()},'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/')).ok).toBe(false);
  expect((await native({...request,id:randomUUID(),kind:'link',text:'',url:'javascript:alert(1)'})).ok).toBe(false);
  await app.evaluate(async({clipboard})=>{await clipboard.writeText('Panodan Türkçe not');});
  await page.evaluate(()=>window.sakli.captureClipboard());await expect(page.locator('.detail-panel h2')).toHaveText('Panodan Türkçe not');
  const file=path.join(data,'İş komutu & örnek.ps1');writeFileSync(file,'Write-Output "Merhaba"');
  await new Promise((resolve,reject)=>{const p=spawn(exe,['--capture-file',file],{env,windowsHide:true,stdio:'ignore'});p.on('error',reject);p.on('exit',resolve);});
  await expect.poll(async()=> (await page.evaluate(()=>window.sakli.snapshot())).entries.map(e=>e.title),{timeout:15000}).toContain(path.basename(file));
  await expect(page.locator('.detail-panel h2')).toHaveText(path.basename(file));
  snapshot=await page.evaluate(()=>window.sakli.snapshot());expect(snapshot.entries).toHaveLength(3);expect(snapshot.entries.find(e=>e.title===path.basename(file)).kind).toBe('command');
  // Cold startup from native messaging is a separate path from second-instance delivery.
  await app.close();
  const cold={...request,id:randomUUID(),kind:'note',text:'Kapalı uygulamaya kayıt',title:'Soğuk başlangıç'};
  const coldResult=await native(cold);coldPid=coldResult.startedProcessId;expect(coldResult.ok).toBe(true);
  // Inspect persistence without writing through a second repository instance.
  const {SQLiteRepository}=await import('../dist-electron/electron/repository.js');
  const repo=await SQLiteRepository.open(path.join(data,'sakli.sqlite'));expect(repo.get(cold.id).content).toBe(cold.text);repo.close();
  console.log('PASS: native messaging, origin validation, Unicode, command safety, retry deduplication, clipboard, file capture, cold startup.');
} finally {
  try{await app.close();}catch{}
  // Close only the app process using this unique test data path (cold launch belongs to this test).
  if(coldPid)try{process.kill(coldPid);}catch{}
}
