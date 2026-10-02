import { readFileSync,writeFileSync,mkdirSync,existsSync } from 'node:fs';
import { createHash,generateKeyPairSync } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
const root=process.cwd();const dir=path.join(root,'build/native-host');mkdirSync(dir,{recursive:true});
const manifestPath='chrome-extension/manifest.json';
let manifest=existsSync(manifestPath)?JSON.parse(readFileSync(manifestPath,'utf8')):null;
// The public key fixes the unpacked extension ID across installation paths. No signing secret is stored.
const key=manifest?.key || generateKeyPairSync('rsa',{modulusLength:2048}).publicKey.export({type:'spki',format:'der'}).toString('base64');
manifest={manifest_version:3,name:'DubBitig’e kaydet',version:'1.6.0',description:'Seçili metinleri, komutları ve bağlantıları yerel DubBitig arşivine kaydet.',key,permissions:['contextMenus','nativeMessaging','storage','notifications','activeTab'],background:{service_worker:'background.js'},action:{default_popup:'popup.html',default_title:'DubBitig’e kaydet'},icons:{128:'icon.png'}};
writeFileSync(manifestPath,JSON.stringify(manifest,null,2)+'\n');
const id=[...createHash('sha256').update(Buffer.from(key,'base64')).digest().subarray(0,16)].map(b=>String.fromCharCode(97+(b>>4),97+(b&15))).join('');
const storeId=process.env.DUBBITIG_CHROME_STORE_ID;
if(storeId && storeId!==id)throw new Error('Mağaza kimliği manifest public key ile uyuşmalı. Chrome Web Store public key değerini manifest.key alanına koy.');
writeFileSync('build/chrome-store.nsh',storeId?`!define DUBBITIG_CHROME_STORE_ID "${storeId}"\n`:'; Mağazada yayımlandıktan sonra DUBBITIG_CHROME_STORE_ID ile derle.\n');
writeFileSync(path.join(dir,'com.dubbitig.capture.json'),JSON.stringify({name:'com.dubbitig.capture',description:'DubBitig yerel kayıt bağlantısı',path:'DubBitig.NativeHost.exe',type:'stdio',allowed_origins:[`chrome-extension://${id}/`]},null,2));
execFileSync('C:/Windows/Microsoft.NET/Framework64/v4.0.30319/csc.exe',['/nologo','/optimize+','/target:exe','/r:System.Web.Extensions.dll',`/out:${path.join(dir,'DubBitig.NativeHost.exe')}`,path.join(root,'integrations','NativeHost.cs')],{stdio:'inherit'});
console.log('Chrome extension ID: '+id);
