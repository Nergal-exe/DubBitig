const HOST = 'com.dubbitig.capture';
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id:'dubbitig', title:'DubBitig’e kaydet', contexts:['page','selection','link'] });
    chrome.contextMenus.create({ id:'link',parentId:'dubbitig',title:'Bağlantıyı kaydet',contexts:['link'],targetUrlPatterns:['http://*/*','https://*/*'] });
    chrome.contextMenus.create({ id:'command',parentId:'dubbitig',title:'Seçimi komut olarak kaydet',contexts:['selection'] });
    chrome.contextMenus.create({ id:'note',parentId:'dubbitig',title:'Seçimi not olarak kaydet',contexts:['selection'] });
    chrome.contextMenus.create({ id:'page',parentId:'dubbitig',title:'Bu sayfayı kaydet',contexts:['page'],documentUrlPatterns:['http://*/*','https://*/*'] });
  });
});
const web = value => {try {return ['http:','https:'].includes(new URL(value).protocol)?value:'';}catch{return '';}};
async function send(request) {
  try {
    if(request.text.length>200000)throw new Error('Seçili metin en fazla 200.000 karakter olabilir.');
    const result=await chrome.runtime.sendNativeMessage(HOST,request);
    if(!result?.ok)throw new Error(result?.error || 'Kayıt alınamadı.');
    const text=result.queued?result.title:`Kaydedildi: ${result.title}`;
    await chrome.storage.local.set({lastStatus:text});await chrome.action.setBadgeText({text:result.queued?'…':'✓'});
    await chrome.action.setBadgeBackgroundColor({color:'#287e61'});
    await chrome.notifications.create({type:'basic',iconUrl:'icon.png',title:'DubBitig',message:text});
    return {ok:true,text};
  } catch(error) {
    const text=`Kaydedilemedi: ${error.message}. DubBitig Setup kurulmuş olmalı.`;
    await chrome.storage.local.set({lastStatus:text});await chrome.action.setBadgeText({text:'!'});await chrome.action.setBadgeBackgroundColor({color:'#b92e45'});
    await chrome.notifications.create({type:'basic',iconUrl:'icon.png',title:'DubBitig bağlantısı',message:text});return {ok:false,text};
  }
}
function make(kind,info,tab) {
  const url=kind==='link'?web(info.linkUrl || tab?.url || info.pageUrl):'';
  return {id:crypto.randomUUID(),type:'save',kind,text:kind==='link'?'':info.selectionText || '',url,title:kind==='link'?(info.linkUrl?'':tab?.title || '').slice(0,200):'',sourceUrl:web(info.pageUrl || tab?.url || '')};
}
chrome.contextMenus.onClicked.addListener((info,tab) => {
  const kind=['link','page'].includes(info.menuItemId)?'link':info.menuItemId;
  if(['link','command','note'].includes(kind))void send(make(kind,info,tab));
});
chrome.runtime.onMessage.addListener((message,sender,respond) => {
  if(sender.id!==chrome.runtime.id || sender.url!==chrome.runtime.getURL('popup.html') || message?.type!=='save-page')return false;
  chrome.tabs.query({active:true,currentWindow:true}).then(([tab])=>send(make('link',{},tab))).then(respond);
  return true;
});
