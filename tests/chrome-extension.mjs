import {chromium,expect,_electron as electron} from '@playwright/test';
import {mkdirSync,readFileSync} from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
const root=process.cwd();const data=path.join(root,'.test-data',`chrome-${Date.now()}`);mkdirSync(data,{recursive:true});
const extension=path.join(root,'chrome-extension');
const env={...process.env,DUBBITIG_DATA_DIR:data,DUBBITIG_CAPTURE_EXE:path.join(root,'release-dubbitig/win-unpacked/DubBitig.exe')};delete env.ELECTRON_RUN_AS_NODE;
const app=await electron.launch({executablePath:env.DUBBITIG_CAPTURE_EXE,args:[],env});await app.firstWindow();
const context=await chromium.launchPersistentContext(path.join(data,'browser'),{channel:'chrome',headless:true,env,ignoreDefaultArgs:['--disable-extensions'],args:['--enable-unsafe-extension-debugging']});
try {
  const cdp=await context.browser().newBrowserCDPSession();await cdp.send('Extensions.loadUnpacked',{path:extension});
  const worker=context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const id=new URL(worker.url()).hostname;
  const expected=JSON.parse(readFileSync('build/native-host/com.dubbitig.capture.json','utf8')).allowed_origins[0];expect(`chrome-extension://${id}/`).toBe(expected);
  const result=await worker.evaluate(async request=>await chrome.runtime.sendNativeMessage('com.dubbitig.capture',request),{id:randomUUID(),type:'save',kind:'command',title:'Chrome gerçek bağlantı testi',text:'Get-Process | Sort-Object CPU',url:'',sourceUrl:'https://example.com/'});
  expect(result.ok).toBe(true);
  const output=await worker.evaluate(async()=>await send(make('note',{selectionText:'Chrome seçili Türkçe metin',pageUrl:'https://example.com/'},{title:'Örnek',url:'https://example.com/'})));
  expect(output.ok).toBe(true);
  const popup=await context.newPage();await popup.goto(`chrome-extension://${id}/popup.html`);
  await expect(popup.locator('#status')).toContainText('Kaydedildi: Chrome seçili Türkçe metin');
  const {SQLiteRepository}=await import('../dist-electron/electron/repository.js');const repo=await SQLiteRepository.open(path.join(data,'sakli.sqlite'));
  expect(repo.snapshot().entries).toHaveLength(2);expect(repo.snapshot().entries.find(e=>e.kind==='command').content).toBe('Get-Process | Sort-Object CPU');repo.close();
  console.log('PASS: actual Chromium Manifest V3 service worker, fixed extension ID, native host discovery, command and selected-text save, popup status.');
}finally{await app.close();await context.close();}
