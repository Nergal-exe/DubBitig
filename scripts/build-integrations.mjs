import { readFileSync,writeFileSync,mkdirSync,existsSync,copyFileSync,rmSync } from 'node:fs';
import { createHash,generateKeyPairSync } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
const root=process.cwd();const dir=path.join(root,'build/native-host');mkdirSync(dir,{recursive:true});
const version=JSON.parse(readFileSync('package.json','utf8')).version;
const name='DubBitig’e kaydet',description='Seçili metinleri, komutları ve bağlantıları yerel DubBitig arşivine kaydet.';
const permissions=['contextMenus','nativeMessaging','storage','notifications','activeTab'];
const action={default_popup:'popup.html',default_title:name};
const manifestPath='chrome-extension/manifest.json';
let manifest=existsSync(manifestPath)?JSON.parse(readFileSync(manifestPath,'utf8')):null;
// The public key fixes the unpacked extension ID across installation paths. No signing secret is stored.
const key=manifest?.key || generateKeyPairSync('rsa',{modulusLength:2048}).publicKey.export({type:'spki',format:'der'}).toString('base64');
manifest={manifest_version:3,name,version,description,key,permissions,background:{service_worker:'background.js'},action,icons:{128:'icon.png'}};
writeFileSync(manifestPath,JSON.stringify(manifest,null,2)+'\n');
const id=[...createHash('sha256').update(Buffer.from(key,'base64')).digest().subarray(0,16)].map(b=>String.fromCharCode(97+(b>>4),97+(b&15))).join('');
const storeId=process.env.DUBBITIG_CHROME_STORE_ID;
if(storeId && storeId!==id)throw new Error('Mağaza kimliği manifest public key ile uyuşmalı. Chrome Web Store public key değerini manifest.key alanına koy.');
writeFileSync('build/chrome-store.nsh',storeId?`!define DUBBITIG_CHROME_STORE_ID "${storeId}"\n`:'; Mağazada yayımlandıktan sonra DUBBITIG_CHROME_STORE_ID ile derle.\n');

// Firefox shares the extension code; only the manifest differs (background script, fixed add-on ID).
const firefoxId='dubbitig@nergal-exe.github.io';
const firefox='firefox-extension';rmSync(firefox,{recursive:true,force:true});mkdirSync(firefox,{recursive:true});
for(const file of ['background.js','popup.html','popup.css','popup.js','icon.png'])copyFileSync(path.join('chrome-extension',file),path.join(firefox,file));
writeFileSync(path.join(firefox,'manifest.json'),JSON.stringify({manifest_version:3,name,version,description,browser_specific_settings:{gecko:{id:firefoxId,strict_min_version:'115.0'}},permissions,background:{scripts:['background.js']},action,icons:{128:'icon.png'}},null,2)+'\n');
writeFileSync(path.join(firefox,'README.md'),`# DubBitig Firefox eklentisi

Seçili metni, komutu veya bağlantıyı sağ tık menüsünden yerel DubBitig arşivine kaydeder. Masaüstü DubBitig kurulu olmalıdır; kurulum Firefox ile yerel bağlantıyı (native messaging) kendisi kaydeder.

## Yükleme

- **Geçici (her Firefox sürümü):** \`about:debugging#/runtime/this-firefox\` → **Geçici eklenti yükle** → bu klasördeki \`manifest.json\`. Firefox kapanınca kaldırılır.
- **Kalıcı:** Firefox kararlı sürümü yalnızca Mozilla tarafından imzalanmış eklentileri kalıcı kurar. Eklentiyi addons.mozilla.org üzerinden (liste dışı da olabilir) imzalatıp oluşan \`.xpi\` dosyasını Firefox'a sürükleyin. Firefox Developer Edition / Nightly'de \`xpinstall.signatures.required\` ayarı kapatılarak imzasız kurulabilir.

Eklenti kimliği: \`${firefoxId}\`. Komutlar saklanır, çalıştırılmaz.
`);

// Native messaging host manifests. Windows registers these paths in the registry; Linux copies them per user at startup.
writeFileSync(path.join(dir,'com.dubbitig.capture.json'),JSON.stringify({name:'com.dubbitig.capture',description:'DubBitig yerel kayıt bağlantısı',path:'DubBitig.NativeHost.exe',type:'stdio',allowed_origins:[`chrome-extension://${id}/`]},null,2));
writeFileSync(path.join(dir,'com.dubbitig.capture.firefox.json'),JSON.stringify({name:'com.dubbitig.capture',description:'DubBitig yerel kayıt bağlantısı',path:'DubBitig.NativeHost.exe',type:'stdio',allowed_extensions:[firefoxId]},null,2));
copyFileSync(path.join(root,'integrations','native-host.cjs'),path.join(dir,'native-host.cjs'));
const csc='C:/Windows/Microsoft.NET/Framework64/v4.0.30319/csc.exe';
if(process.platform==='win32')execFileSync(csc,['/nologo','/optimize+','/target:exe','/r:System.Web.Extensions.dll',`/out:${path.join(dir,'DubBitig.NativeHost.exe')}`,path.join(root,'integrations','NativeHost.cs')],{stdio:'inherit'});
else console.log('Windows yerel bağlantı programı yalnızca Windows üzerinde derlenir; Linux Node tabanlı bağlantıyı kullanır.');
console.log('Chrome extension ID: '+id+'\nFirefox add-on ID: '+firefoxId);
