import { _electron as electron, expect } from '@playwright/test';
import { mkdirSync,readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { unzipSync,strFromU8 } from 'fflate';
const root=process.cwd(),data=path.join(root,'.test-data',`tray-transfer-${Date.now()}`);mkdirSync(data,{recursive:true});mkdirSync('test-results',{recursive:true});
const env={...process.env,DUBBITIG_DATA_DIR:data};delete env.ELECTRON_RUN_AS_NODE;
const exe=process.env.SAKLI_TEST_EXE;
const app=await electron.launch({...(exe?{executablePath:exe,args:[]}:{args:['.']}),cwd:root,env});
try {
  const page=await app.firstWindow();await page.waitForLoadState('networkidle');
  await page.evaluate(async()=>{await window.sakli.setLinkChecker(false);const draft={title:'Komut denemesi',kind:'command',content:'Get-Process',description:'',url:'',category:'İş',tags:[],favorite:false,assets:[]};await window.sakli.save(draft);await window.sakli.save({...draft,title:'Not denemesi',kind:'note',content:'Not',category:'Kişisel'});});
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].close());
  expect(await app.evaluate(({BrowserWindow})=>({count:BrowserWindow.getAllWindows().length,visible:BrowserWindow.getAllWindows()[0].isVisible()}))).toEqual({count:1,visible:false});
  expect((await page.evaluate(()=>window.sakli.snapshot())).entries).toHaveLength(2);
  // Opening the app again must reveal the same window, not start a second archive writer.
  const executable=await app.evaluate(()=>process.execPath);
  const child=spawn(executable,exe?[]:['.'],{cwd:root,env,windowsHide:true});
  await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>{child.kill();reject(Error('Second instance did not exit'));},15000);child.on('error',reject);child.on('exit',code=>{clearTimeout(timeout);code===0?resolve():reject(Error('Second instance exit '+code));});});
  expect(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isVisible())).toBe(true);
  await page.reload();await page.waitForLoadState('networkidle');
  const output=path.join(data,'types.sakli');await app.evaluate(({dialog},output)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:output});},output);
  await page.getByRole('button',{name:'Dışarı aktar',exact:true}).click();
  await expect(page.getByRole('button',{name:/Tümünü dışa aktar/})).toBeVisible();
  await page.getByRole('button',{name:/Kayıt türlerini dışa aktar/}).click();await expect(page.getByRole('button',{name:'Dosyaya aktar',exact:true})).toBeDisabled();
  await page.getByRole('checkbox',{name:'Komut türünü aktar',exact:true}).check();await expect(page.getByText('1 kayıt ve 0 fotoğraf')).toBeVisible();
  await page.screenshot({path:'test-results/type-transfer.png',animations:'disabled'});
  await page.getByRole('button',{name:'Dosyaya aktar',exact:true}).click();await expect(page.getByRole('status')).toContainText('Seçilen kayıt türleri');
  const manifest=JSON.parse(strFromU8(unzipSync(readFileSync(output))['manifest.json']));expect(manifest.entries.map(e=>e.kind)).toEqual(['command']);expect(manifest.categories).toEqual(['İş']);
  await app.evaluate(({dialog},output)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[output]});},output);
  await page.getByRole('button',{name:'İçeri aktar',exact:true}).click();await page.getByRole('button',{name:'Dosya seç ve aktar',exact:true}).click();await expect(page.getByRole('status')).toContainText('0 kayıt');
  console.log('PASS: close-to-tray keeps process and data alive; second instance reveals window; type-only export and import.');
}finally{await app.close();}
