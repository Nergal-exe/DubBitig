import { useState } from 'react';
import { Archive, Folder, Shapes, ShieldCheck } from 'lucide-react';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from './ui/dialog';
import { getAPI } from '../api';
import { kinds, labels, type Kind, type Snapshot, type TransferScope } from '../shared/model';

export function TransferPanel({ mode, snapshot, initialCategory, close, changed, notify }: { mode: 'import' | 'export'; snapshot: Snapshot; initialCategory: string; close: () => void; changed: () => Promise<void>; notify: (v: string, e?: boolean) => void }) {
  const isExport = mode === 'export';
  const [selection,setSelection] = useState<'all'|'categories'|'types'>(isExport && initialCategory ? 'categories' : 'all');
  const [categories,setCategories] = useState<string[]>(initialCategory ? [initialCategory === '__none' ? '' : initialCategory] : []);
  const [types,setTypes] = useState<Kind[]>([]);
  const [copyCategory,setCopyCategory] = useState(false);
  const [target,setTarget] = useState(snapshot.categories[0] ?? '');
  const [busy,setBusy] = useState(false); const [error,setError] = useState('');
  const entries = snapshot.entries.filter(e => selection === 'all' || !e.deletedAt && (selection === 'categories' ? categories.includes(e.category) : types.includes(e.kind)));
  const photos = new Set(entries.flatMap(e => [e, ...(e.history ?? []).map(h => h.draft)].flatMap(d => [...d.assets, d.preview?.favicon, d.preview?.image].filter(Boolean).map(a => a!.id)))).size;
  const noSelection = isExport && (selection === 'categories' && !categories.length || selection === 'types' && !types.length);
  const submit = async () => {
    if (noSelection) return;
    setBusy(true);setError('');
    try {
      if (isExport) {
        const scope: TransferScope = selection === 'categories' ? {kind:'categories',categories} : selection === 'types' ? {kind:'types',types} : {kind:'all'};
        if (!await getAPI().exportArchive(scope)) return;
        notify(selection === 'all' ? 'Tüm arşiv dışarı aktarıldı.' : selection === 'categories' ? 'Seçilen kategoriler dışarı aktarıldı.' : 'Seçilen kayıt türleri dışarı aktarıldı.');
      } else {
        const count = await getAPI().importArchive('merge',copyCategory ? {kind:'category',category:target} : {kind:'all'});
        if (count === null) return;await changed();notify(`${count} kayıt içeri aktarıldı.`);
      }
      close();
    } catch(e) { setError(String(e).replace(/^Error: Error invoking remote method '[^']+': Error: /,'')); }
    finally {setBusy(false);}
  };
  return <Dialog open onOpenChange={open=>{if(!open&&!busy)close();}}><DialogContent className="sm:max-w-xl max-h-[90dvh] overflow-y-auto"><DialogHeader><DialogTitle>{isExport?'Arşivi dışarı aktar':'Arşive içeri aktar'}</DialogTitle><DialogDescription>{isExport?'Tüm arşivi, kategorileri veya kayıt türlerini fotoğrafları ve geçmişiyle taşı.':'Tam arşiv, kategori veya kayıt türü dosyalarını içeri aktar. Dosyadaki kayıt türleri ve kategoriler korunur.'}</DialogDescription></DialogHeader>
    {isExport ? <>
      <div className="scope-picker" role="group" aria-label="Aktarım kapsamı">
        <button disabled={busy} aria-pressed={selection==='all'} onClick={()=>setSelection('all')}><Archive size={22}/><span><strong>Tümünü dışa aktar</strong><small>Çöp kutusu dahil bütün arşiv</small></span></button>
        <button disabled={busy} aria-pressed={selection==='categories'} onClick={()=>setSelection('categories')}><Folder size={22}/><span><strong>Kategorileri dışa aktar</strong><small>Bir veya birden fazla kategori seç</small></span></button>
        <button disabled={busy} aria-pressed={selection==='types'} onClick={()=>setSelection('types')}><Shapes size={22}/><span><strong>Kayıt türlerini dışa aktar</strong><small>Komut, program, bağlantı, not veya fotoğraf</small></span></button>
      </div>
      {selection==='categories' && <fieldset className="space-y-2"><legend className="font-medium mb-2">Dışarı aktarılacak kategoriler</legend>{[...snapshot.categories,''].map(c=><label key={c} className="flex items-center gap-3 rounded-lg border border-border p-3"><input type="checkbox" aria-label={`${c||'Kategorisiz'} kategorisini aktar`} checked={categories.includes(c)} disabled={busy} onChange={e=>setCategories(values=>e.target.checked?[...values,c]:values.filter(v=>v!==c))}/><span className="flex-1">{c||'Kategorisiz'}</span><span className="text-xs text-muted-foreground">{snapshot.entries.filter(e=>!e.deletedAt&&e.category===c).length} kayıt</span></label>)}</fieldset>}
      {selection==='types' && <fieldset className="space-y-2"><legend className="font-medium mb-2">Dışarı aktarılacak kayıt türleri</legend>{kinds.map(k=><label key={k} className="flex items-center gap-3 rounded-lg border border-border p-3"><input type="checkbox" aria-label={`${labels[k]} türünü aktar`} checked={types.includes(k)} disabled={busy} onChange={e=>setTypes(values=>e.target.checked?[...values,k]:values.filter(v=>v!==k))}/><span className="flex-1">{labels[k]}</span><span className="text-xs text-muted-foreground">{snapshot.entries.filter(e=>!e.deletedAt&&e.kind===k).length} kayıt</span></label>)}</fieldset>}
      <div className="transfer-summary"><ShieldCheck size={20}/><div><strong>{entries.length} kayıt ve {photos} fotoğraf</strong><p>{selection==='all'?'Kategoriler, etiketler ve çöp kutusu dahil edilir.':'Yalnızca seçilen aktif kayıtlar aktarılır. Her tür/kategori için ayrı dosya istiyorsan tek tek seçip aktar; çoklu seçim tek dosyada birleşir.'}</p></div></div>
    </> : <div className="space-y-4"><div className="transfer-summary"><ShieldCheck size={20}/><div><strong>Mevcut kayıtların korunur</strong><p>Aynı kaydın daha yeni sürümü kullanılır. Eşzamanlı farklı içerikler ayrı kopyalar olarak saklanır.</p></div></div><label className="flex items-center gap-3"><input type="checkbox" checked={copyCategory} disabled={busy} onChange={e=>setCopyCategory(e.target.checked)}/>Hedef kategoriye yeni kopyalar ekle</label>{copyCategory&&<label className="transfer-category">Hedef kategori<select value={target} disabled={busy} onChange={e=>setTarget(e.target.value)}><option value="">Kategorisiz</option>{snapshot.categories.map(c=><option key={c} value={c}>{c}</option>)}</select><small>Her aktarım yeni kopyalar oluşturur. Hatırlatıcılar kopyalarda sıfırlanır.</small></label>}</div>}
    <p className="hint">DubBitig ve eski Saklı .sakli arşivleri desteklenir. Dosya sınırı 512 MB.</p>
    {error&&<p className="form-error" role="alert">{error}</p>}
    <div className="flex justify-end gap-2"><Button variant="outline" disabled={busy} onClick={close}>Vazgeç</Button><Button disabled={busy||noSelection} onClick={submit}>{busy?'İşlem sürüyor…':isExport?'Dosyaya aktar':'Dosya seç ve aktar'}</Button></div>
  </DialogContent></Dialog>;
}
