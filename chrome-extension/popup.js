const status=document.getElementById('status');const button=document.getElementById('save');
chrome.storage.local.get('lastStatus').then(s=>{status.textContent=s.lastStatus || 'Setup ile DubBitig bağlantısı kurulur.';});
button.addEventListener('click',async()=>{button.disabled=true;status.textContent='DubBitig’e gönderiliyor…';try{const r=await chrome.runtime.sendMessage({type:'save-page'});status.textContent=r.text;}catch(e){status.textContent=e.message;}finally{button.disabled=false;}});
