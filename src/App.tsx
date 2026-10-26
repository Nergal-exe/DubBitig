import { TransferPanel } from './components/transfer-panel';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Archive, ArrowCounterClockwise, ArrowSquareOut, ArrowsDownUp, Bell, BookOpen, Check, CheckCircle, Checks, Clock, Copy, DownloadSimple, FileText, FilmSlate, Folder, FolderOpen, FunnelSimple, GearSix, GridFour, ImageSquare, Link as LinkIcon, List, MagnifyingGlass, Plus, ShieldCheck, SquaresFour, Star, Sun, Moon, Tag, TerminalWindow, Trash, UploadSimple, WarningCircle, X, PencilSimple, PlugsConnected } from '@phosphor-icons/react';
import { createPortal } from 'react-dom';
import { AppWindow } from './components/window';
import { Button } from './components/ui/button';
import { Typeahead, matches, type Suggestion } from './components/typeahead';
import { ContentEditor, RichContent } from './components/rich-content';
import { SettingsPanel } from './components/settings-panel';
import { getAPI } from './api';
import { draftSchema, duplicateKeys, isListKind, kinds, labels, normalizeUrl, uiKinds, type Asset, type Draft, type Entry, type Kind, type Snapshot, type Theme, type DesignStyle, type UpdateInfo } from './shared/model';

const typeIcons = { command: TerminalWindow, program: SquaresFour, link: LinkIcon, note: FileText, photo: ImageSquare, movie: FilmSlate, book: BookOpen };
const plurals: Record<Kind, string> = { command: 'Komutlar', program: 'Programlar', link: 'Bağlantılar', note: 'Notlar', photo: 'Fotoğraflar', movie: 'Diziler/Filmler', book: 'Kitaplar' };
const blank = (kind: Kind = 'note'): Draft => ({ title: '', kind, description: '', content: '', url: '', category: '', tags: [], favorite: false, assets: [] });
const date = (v: string) => new Date(v).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', year: 'numeric' });
const dateTime = (v: string) => new Date(v).toLocaleString('tr-TR', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const relative = (v: string) => {
  const seconds = (new Date(v).getTime() - Date.now()) / 1000; const abs = Math.abs(seconds);
  const [value, unit]: [number, Intl.RelativeTimeFormatUnit] = abs < 3600 ? [seconds / 60, 'minute'] : abs < 86400 ? [seconds / 3600, 'hour'] : abs < 86400 * 30 ? [seconds / 86400, 'day'] : [seconds / 86400 / 30, 'month'];
  return new Intl.RelativeTimeFormat('tr', { numeric: 'auto' }).format(Math.round(value), unit);
};
const size = (v: number) => v < 1024 * 1024 ? `${Math.max(1, Math.round(v / 1024))} KB` : `${(v / 1024 / 1024).toFixed(1)} MB`;
const searchText = (v: string) => v.toLocaleLowerCase('tr-TR').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ı/g, 'i');
// Card summaries show readable text, not Markdown syntax.
const plainText = (v: string) => v.replace(/```[\s\S]*?(```|$)/g, ' ').replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+/gm, '').replace(/(\*\*|__|~~|\*|`)(.+?)\1/g, '$2').replace(/\s+/g, ' ').trim();
const isTyping = (target: EventTarget | null) => target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
function message(error: unknown) { return (error instanceof Error ? error.message : String(error)).replace(/^Error invoking remote method '[^']+': Error: /, ''); }
// A record type from a newer DubBitig (e.g. on the other OS sharing the data folder) falls back instead of crashing.
function TypeIcon({ kind, size = 22 }: { kind: Kind; size?: number }) { const Icon = typeIcons[kind] ?? FileText; return <Icon size={size} />; }
function Photo({ asset, className = '', onClick }: { asset: Asset; className?: string; onClick?: () => void }) {
  const [src, setSrc] = useState(''); const [failed, setFailed] = useState(false);
  useEffect(() => { let active = true; setSrc(''); setFailed(false); getAPI().image(asset.id).then(v => { if (active) setSrc(v); }).catch(() => { if (active) setFailed(true); }); return () => { active = false; }; }, [asset.id]);
  return src ? <img src={src} alt={asset.name} className={className} onClick={onClick} /> : <div className={`image-loading ${className}`} role="img" aria-label={failed ? 'Fotoğraf okunamadı' : 'Fotoğraf yükleniyor'}><ImageSquare size={30} />{failed && <span>Fotoğraf okunamadı</span>}</div>;
}
function Modal({ title, children, close, wide = false, modal = false }: { title: string; children: ReactNode; close: () => void; wide?: boolean; modal?: boolean }) {
  return <AppWindow title={title} close={close} size={wide ? 'lg' : 'md'} modal={modal}>{children}</AppWindow>;
}
// The record (other than the one being edited) that already uses one of the draft's unique fields.
function findDuplicate(entries: Entry[], draft: Pick<Draft, 'kind' | 'title' | 'url' | 'content'>, original?: Entry | Draft) {
  const own = new Set(original ? duplicateKeys(original).map(([k]) => k) : []);
  const keys = duplicateKeys({ ...draft, url: normalizeUrl(draft.url) }).filter(([k]) => !own.has(k));
  for (const entry of entries) {
    if (original && 'id' in original && entry.id === original.id) continue;
    const theirs = new Set(duplicateKeys(entry).map(([k]) => k));
    const hit = keys.find(([k]) => theirs.has(k));
    if (hit) return { entry, reason: hit[1], key: hit[0].split(':')[0] };
  }
  return undefined;
}

function Notification({ text, error, close }: { text: string; error: boolean; close: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.showPopover(); }, [text]);
  return createPortal(<div ref={ref} aria-live={error ? 'assertive' : 'polite'} popover="manual" className={`toast ${error ? 'error' : ''}`} role={error ? 'alert' : 'status'}>{error ? <WarningCircle size={20}/> : <CheckCircle size={20}/>}<span>{text}</span><button className="icon-button" aria-label="Bildirimi kapat" onClick={close}><X size={16}/></button></div>, document.body);
}
function NavItem({ active, icon, label, count, tone, dot, onClick }: { active?: boolean; icon: ReactNode; label: string; count?: number | string; tone?: 'danger' | 'accent'; dot?: string; onClick: () => void }) {
  return <button className={`nav-item ${active ? 'active' : ''}`} aria-current={active ? 'page' : undefined} aria-description={dot} title={dot} onClick={onClick}>{icon}<em>{label}</em>{count ? <span className={`nav-count ${tone ?? ''}`}> {count}</span> : null}{dot && <span className="update-dot" aria-hidden="true"/>}</button>;
}

export default function App() {
  const [snapshot, setSnapshot] = useState<Snapshot>({ entries: [], categories: [], tags: [] });
  const [loading, setLoading] = useState(true); const [fatal, setFatal] = useState('');
  const [section, setSection] = useState('all'); const [query, setQuery] = useState(''); const [category, setCategory] = useState(''); const [tag, setTag] = useState('');
  const [sort, setSort] = useState('newest'); const [layout, setLayout] = useState<'grid' | 'list'>(() => { try { return localStorage.getItem('dubbitig-layout') === 'list' ? 'list' : 'grid'; } catch { return 'grid'; } });
  const [flash, setFlash] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null); const [editor, setEditor] = useState<Entry | Draft | null>(null);
  const [showSettings, setShowSettings] = useState(false); const [showCategories, setShowCategories] = useState(false); const [showTags, setShowTags] = useState(false);
  const [theme, setTheme] = useState<Theme>('dark'); const [themeBusy, setThemeBusy] = useState(false); const [designStyle, setDesignStyle] = useState<DesignStyle>('dubbitig');
  const [transfer, setTransfer] = useState<'import' | 'export' | null>(null);
  const [historyId, setHistoryId] = useState<string | null>(null); const [inbox, setInbox] = useState(false);
  const [integrations, setIntegrations] = useState(false);
  const [toast, setToast] = useState<{ text: string; error: boolean } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Entry | null>(null); const [purge, setPurge] = useState<Entry | 'all' | null>(null); const [lightbox, setLightbox] = useState<Asset | null>(null);
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const notify = useCallback((text: string, error = false) => setToast({ text, error }), []);
  const reload = useCallback(async () => { const data = await getAPI().snapshot(); setSnapshot(data); }, []);
  useEffect(() => { Promise.all([reload(), getAPI().settings().then(s => { setTheme(s.theme); setDesignStyle(s.designStyle); })]).catch(e => setFatal(message(e))).finally(() => setLoading(false)); }, [reload]);
  useEffect(() => getAPI().onCaptured(value => { void reload(); setSection('all'); setCategory(''); setTag(''); setQuery(''); setSelected(value.id); notify('DubBitig’e kaydedildi: ' + value.title); }), [reload, notify]);
  useEffect(() => { getAPI().integrationWelcome().then(setIntegrations).catch(() => {}); }, []);
  useEffect(() => { const check = () => void getAPI().checkUpdate().then(setUpdate).catch(() => {}); const first = setTimeout(check, 3000); const timer = setInterval(check, 6 * 3600 * 1000); return () => { clearTimeout(first); clearInterval(timer); }; }, []);
  useEffect(() => { const timer = setInterval(() => { if (!document.hidden) void reload().catch(() => {}); }, 15000); return () => clearInterval(timer); }, [reload]);
  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  useEffect(() => { document.documentElement.dataset.style = designStyle; }, [designStyle]);
  useEffect(() => { try { localStorage.setItem('dubbitig-layout', layout); } catch { /* Layout preference is optional. */ } }, [layout]);
  useEffect(() => { if (!flash) return; const timer = setTimeout(() => setFlash(null), 2400); return () => clearTimeout(timer); }, [flash]);
  const changeTheme = async (value: Theme) => { setThemeBusy(true); try { await getAPI().setTheme(value); setTheme(value); } catch (e) { notify(message(e), true); } finally { setThemeBusy(false); } };
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(null), toast.error ? 9000 : 4000); return () => clearTimeout(timer); }, [toast]);
  useEffect(() => {
    const listener = (e: KeyboardEvent) => {
      const inWindow = e.target instanceof HTMLElement && !!e.target.closest('[role=dialog]');
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k' || e.key === '/' && !isTyping(e.target) && !inWindow) { e.preventDefault(); searchRef.current?.focus(); searchRef.current?.select(); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n' && !document.querySelector('[data-modal=true]')) { e.preventDefault(); setEditor(value => value ?? blank()); }
      if (e.key === 'Escape' && !inWindow && !isTyping(e.target)) setSelected(null);
    };
    document.addEventListener('keydown', listener); return () => document.removeEventListener('keydown', listener);
  }, []);
  const run = async (action: () => Promise<unknown>, success?: string) => { try { await action(); await reload(); if (success) notify(success); } catch (e) { notify(message(e), true); } };
  const alive = snapshot.entries.filter(e => !e.deletedAt);
  const tags = [...snapshot.tags].sort((a, b) => a.localeCompare(b, 'tr'));
  const categories = [...snapshot.categories].sort((a, b) => a.localeCompare(b, 'tr'));
  useEffect(() => { if (!loading && tag && !snapshot.tags.includes(tag)) setTag(''); if (!loading && category && category !== '__none' && !snapshot.categories.includes(category)) setCategory(''); }, [snapshot, loading, tag, category]);
  const filtered = useMemo(() => {
    const words = searchText(query).split(/\s+/).filter(Boolean);
    return snapshot.entries.filter(e => {
      if (section === 'trash' ? !e.deletedAt : e.deletedAt) return false;
      if (section === 'favorites' && !e.favorite) return false;
      if (section === 'broken' && e.linkCheck?.state !== 'broken') return false;
      if (kinds.includes(section as Kind) && e.kind !== section) return false;
      if (category && (category === '__none' ? !!e.category : e.category !== category)) return false;
      if (tag && !e.tags.includes(tag)) return false;
      const haystack = searchText([e.title, e.description, e.content, e.url, e.category, ...e.tags, ...e.assets.map(a => a.name)].join(' '));
      return words.every(word => haystack.includes(word));
    }).sort((a, b) => sort === 'title' ? a.title.localeCompare(b.title, 'tr') : sort === 'oldest' ? a.createdAt.localeCompare(b.createdAt) : sort === 'updated' ? b.updatedAt.localeCompare(a.updatedAt) : b.createdAt.localeCompare(a.createdAt));
  }, [snapshot, section, query, category, tag, sort]);
  const current = snapshot.entries.find(e => e.id === selected);
  const heading = section === 'favorites' ? 'Favoriler' : section === 'broken' ? 'Kırık bağlantılar' : section === 'trash' ? 'Çöp kutusu' : kinds.includes(section as Kind) ? plurals[section as Kind] : 'Tüm kayıtlar';
  const subtitle = section === 'trash' ? 'Sildiğin kayıtlar burada; istediğin zaman geri alabilirsin.' : section === 'favorites' ? 'Yıldızladığın kayıtlara hızlı erişim.' : section === 'broken' ? 'Denetimde 404 veya 410 yanıtı veren bağlantılar.' : 'Bilgini kaydet. İhtiyacın olduğunda bul.';
  const navigate = (next: string, cat = '') => { setSection(next); setCategory(cat); setSelected(null); setTag(''); };
  const newEntry = () => setEditor({ ...blank(kinds.includes(section as Kind) ? section as Kind : 'note'), category: category === '__none' ? '' : category });
  const copyText = (entry: Entry) => entry.kind === 'link' ? entry.url : isListKind(entry.kind) ? entry.url || entry.title : entry.content || entry.url || entry.description || entry.title;
  const copy = (text: string) => run(() => getAPI().copy(text), 'Panoya kopyalandı.');
  const toggleFavorite = (entry: Entry) => run(() => getAPI().save({ ...entry, favorite: !entry.favorite }, entry.id), entry.favorite ? 'Favorilerden çıkarıldı.' : 'Favorilere eklendi.');
  const unread = alive.reduce((n, e) => n + (e.notices?.filter(v => !v.read).length ?? 0), 0);
  const broken = alive.filter(e => e.linkCheck?.state === 'broken').length;
  const trashed = snapshot.entries.length - alive.length;
  const filtersActive = !!(query || tag || category);
  const suggestions: Suggestion[] = query.trim() ? [
    ...matches(categories, query, 4).map(c => ({ key: 'c:' + c, label: c, group: 'Kategoriler', hint: `${alive.filter(e => e.category === c).length} kayıt`, icon: <Folder size={15}/> })),
    ...matches(tags, query, 4).map(t => ({ key: 't:' + t, label: '#' + t, group: 'Etiketler', hint: `${alive.filter(e => e.tags.includes(t)).length} kayıt`, icon: <Tag size={15}/> })),
    ...matches(alive.map(e => e.title), query, 5).map(title => { const e = alive.find(v => v.title === title)!; return { key: 'e:' + e.id, label: title, group: 'Kayıtlar', hint: labels[e.kind], icon: <TypeIcon kind={e.kind} size={15}/> }; }),
  ] : [];
  const pickSuggestion = (item: Suggestion) => {
    const [type, ...rest] = item.key.split(':'); const value = rest.join(':');
    if (type === 'c') { setCategory(value); setQuery(''); setSelected(null); }
    else if (type === 't') { setTag(value); setQuery(''); setSelected(null); }
    else { setSection('all'); setSelected(value); }
  };
  if (fatal) return <div className="startup-error"><WarningCircle size={42}/><h1>DubBitig açılamadı</h1><p>{fatal}</p><button onClick={() => location.reload()}>Yeniden dene</button></div>;
  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><img className="brand-symbol" src="./db.jpg" alt="DubBitig logosu"/><div><strong>DubBitig</strong><small>Kişisel bilgi arşivi</small></div></div>
      <button className="new-entry" onClick={newEntry}><Plus size={18} weight="bold"/> Yeni kayıt <kbd>Ctrl N</kbd></button>
      <nav aria-label="Arşiv bölümleri">
        <p className="nav-label">Arşiv</p>
        <NavItem active={section === 'all'} icon={<Archive size={19}/>} label="Tüm kayıtlar" count={alive.length} onClick={() => navigate('all')}/>
        <NavItem active={section === 'favorites'} icon={<Star size={19}/>} label="Favoriler" count={alive.filter(e => e.favorite).length} onClick={() => navigate('favorites')}/>
        <NavItem icon={<Bell size={19}/>} label="Hatırlatıcılar" count={unread || ''} tone="accent" onClick={() => setInbox(true)}/>
        <NavItem active={section === 'broken'} icon={<WarningCircle size={19}/>} label="Kırık bağlantılar" count={broken} tone={broken ? 'danger' : undefined} onClick={() => navigate('broken')}/>
        <p className="nav-label">Kayıt türleri</p>
        {uiKinds.map(kind => <NavItem key={kind} active={section === kind} icon={<span className={`nav-kind ${kind}`}><TypeIcon kind={kind} size={15}/></span>} label={plurals[kind]} count={alive.filter(e => e.kind === kind).length} onClick={() => navigate(kind)}/>)}
        <p className="nav-label">Düzen</p>
        <NavItem icon={<Folder size={19}/>} label="Kategorileri yönet" onClick={() => setShowCategories(true)}/>
        <NavItem icon={<Tag size={19}/>} label="Etiketleri yönet" onClick={() => setShowTags(true)}/>
        <NavItem active={section === 'trash'} icon={<Trash size={19}/>} label="Çöp kutusu" count={trashed || ''} onClick={() => navigate('trash')}/>
      </nav>
      <div className="sidebar-bottom">
        <NavItem icon={<GearSix size={19}/>} label="Ayarlar ve yedekler" onClick={() => setShowSettings(true)} dot={update?.available ? `Yeni sürüm: ${update.latest}` : undefined}/>
        <div className="sidebar-footer">
          <div className="theme-picker" role="group" aria-label="Tema seçimi"><button disabled={themeBusy} aria-pressed={theme === 'light'} onClick={() => changeTheme('light')}><Sun size={16}/><span>Açık</span></button><button disabled={themeBusy} aria-pressed={theme === 'dark'} onClick={() => changeTheme('dark')}><Moon size={16}/><span>Koyu</span></button></div>
          <span className="local-status" title="Kayıtların ve fotoğrafların bu bilgisayarda saklanır."><ShieldCheck size={16}/>Yerel</span>
        </div>
      </div>
    </aside>
    <main className="workspace">
      <header className="topbar">
        <div className="page-title"><h1>{heading}</h1><p>{subtitle}</p></div>
        <div className="top-actions">
          <button className="text-button" title="Pano, dosya ve tarayıcıdan hızlı kayıt" onClick={() => setIntegrations(true)}><PlugsConnected size={18}/><span className="label">Hızlı kayıt</span></button>
          <button className="text-button" title="İçeri aktar" onClick={() => setTransfer('import')}><DownloadSimple size={18}/><span className="label">İçeri aktar</span></button>
          <button className="text-button" title="Dışarı aktar" onClick={() => setTransfer('export')}><UploadSimple size={18}/><span className="label">Dışarı aktar</span></button>
        </div>
      </header>
      <section className="content-area">
        <div className="toolbar">
          <Typeahead wrapperClassName="search-box" inputRef={searchRef} aria-label="Arşivde ara" placeholder="Kayıt, kategori veya etiket ara…" value={query} onValueChange={setQuery} items={suggestions} onPick={pickSuggestion} onKeyDown={e => { if (e.key === 'Escape' && query) { e.stopPropagation(); setQuery(''); } }} leading={<MagnifyingGlass size={19}/>} trailing={query ? <button className="icon-button" aria-label="Aramayı temizle" onClick={() => { setQuery(''); searchRef.current?.focus(); }}><X size={15}/></button> : <kbd>Ctrl K</kbd>}/>
          <label className={`select-chip ${category ? 'on' : ''}`}><Folder size={16}/><select aria-label="Kategoriye göre filtrele" value={category} onChange={e => { setCategory(e.target.value); setSelected(null); }}><option value="">Tüm kategoriler</option><option value="__none">Kategorisiz</option>{categories.map(c => <option key={c} value={c}>{c}</option>)}</select></label>
          <label className={`select-chip ${tag ? 'on' : ''}`}><Tag size={16}/><select aria-label="Etikete göre filtrele" value={tag} onChange={e => setTag(e.target.value)}><option value="">Tüm etiketler</option>{tags.map(t => <option key={t} value={t}>{t}</option>)}</select></label>
          <label className="select-chip"><ArrowsDownUp size={16}/><select aria-label="Kayıt sıralaması" value={sort} onChange={e => setSort(e.target.value)}><option value="newest">En yeni önce</option><option value="oldest">En eski önce</option><option value="updated">Son düzenlenen</option><option value="title">Başlık A–Z</option></select></label>
          <div className="view-toggle" role="group" aria-label="Görünüm"><button className={layout === 'grid' ? 'selected' : ''} aria-label="Kart görünümü" aria-pressed={layout === 'grid'} onClick={() => setLayout('grid')}><GridFour size={18}/></button><button className={layout === 'list' ? 'selected' : ''} aria-label="Liste görünümü" aria-pressed={layout === 'list'} onClick={() => setLayout('list')}><List size={18}/></button></div>
        </div>
        <div className="filter-row">
          <span className="result-count"><strong>{filtered.length}</strong> kayıt</span>
          {category && <span className="filter-chip"><Folder size={13}/>{category === '__none' ? 'Kategorisiz' : category}<button aria-label="Kategori filtresini kaldır" onClick={() => setCategory('')}><X size={11}/></button></span>}
          {tag && <span className="filter-chip"><Tag size={13}/>#{tag}<button aria-label="Etiket filtresini kaldır" onClick={() => setTag('')}><X size={11}/></button></span>}
          {query && <span className="filter-chip"><MagnifyingGlass size={13}/>“{query}”</span>}
          {section === 'trash' && trashed > 0 && <button className="small danger empty-trash" onClick={() => setPurge('all')}><Trash size={15}/>Çöp kutusunu boşalt</button>}
          {filtersActive && <button className="clear-filter" onClick={() => { setQuery(''); setTag(''); setCategory(''); }}><FunnelSimple size={13}/>Filtreleri temizle</button>}
        </div>
        {loading ? <div className="empty"><Archive size={40}/><h2>Arşivin açılıyor…</h2></div> : !filtered.length ? <div className="empty">
          <div className="empty-illustration">{filtersActive ? <MagnifyingGlass size={46} weight="duotone"/> : <Archive size={50} weight="duotone"/>}</div>
          <h2>{filtersActive ? 'Eşleşen kayıt bulunamadı' : section === 'trash' ? 'Çöp kutusu boş' : section === 'favorites' ? 'Favorilerin burada görünecek' : section === 'broken' ? 'Kırık bağlantı yok' : 'Her şey bir kayıtla başlar'}</h2>
          <p>{filtersActive ? 'Başka bir kelime dene veya filtreleri temizle.' : section === 'trash' ? 'Sildiğin kayıtlar, geri alabilmen için burada saklanır.' : section === 'favorites' ? 'Sık kullandığın kayıtların yıldızına basarak buraya ekle.' : section === 'broken' ? 'Bağlantıların erişilebilir görünüyor. Denetim günde bir yapılır.' : 'Bir komut, unutmaman gereken bir bağlantı, küçük bir not. Hepsine burada yer var.'}</p>
          {filtersActive ? <button onClick={() => { setQuery(''); setTag(''); setCategory(''); }}><FunnelSimple size={17}/>Filtreleri temizle</button> : !['trash', 'favorites', 'broken'].includes(section) && <><button className="primary" onClick={newEntry}><Plus size={18}/> İlk kaydını ekle</button><div className="empty-types">{uiKinds.map(k => <button key={k} className={`kind-chip ${k}`} onClick={() => setEditor({ ...blank(k), category: category === '__none' ? '' : category })}><TypeIcon kind={k} size={16}/>{labels[k]}</button>)}</div></>}
        </div> : <div className={`entries ${layout}`}>{filtered.map(entry => <EntryCard key={entry.id} entry={entry} layout={layout} flash={flash === entry.id} chosen={selected === entry.id} open={() => setSelected(entry.id)} favorite={() => toggleFavorite(entry)} copy={() => entry.deletedAt ? run(() => getAPI().trash(entry.id, true), 'Kayıt geri alındı.') : copy(copyText(entry))}/>)}</div>}
      </section>
    </main>
    {current && <aside className="detail-panel" aria-label="Kayıt ayrıntıları">
      <div className="detail-top"><span className={`type-badge ${current.kind}`}><TypeIcon kind={current.kind} size={17}/>{labels[current.kind]}</span><div>{!current.deletedAt && <button className={`icon-button favorite ${current.favorite ? 'is-favorite' : ''}`} aria-label={current.favorite ? 'Favorilerden çıkar' : 'Favorilere ekle'} title={current.favorite ? 'Favorilerden çıkar' : 'Favorilere ekle'} onClick={() => toggleFavorite(current)}><Star size={19} weight={current.favorite ? 'fill' : 'regular'}/></button>}<button className="icon-button" aria-label="Ayrıntıları kapat" title="Kapat (Esc)" onClick={() => setSelected(null)}><X size={19}/></button></div></div>
      <div className="detail-body">
        <h2>{current.preview?.favicon && <Photo asset={current.preview.favicon} className="site-favicon"/>}{current.title}</h2>
        {current.description && <p className="detail-description">{current.description}</p>}
        {current.deletedAt && <div className="notice"><Trash size={16}/>Bu kayıt çöp kutusunda.</div>}
        <EntryDates entry={current}/>
        {current.url && <button className="url-button" title={current.url} onClick={() => run(() => getAPI().openUrl(current.url))}><LinkIcon size={17}/><span>{current.url.replace(/^https?:\/\//, '')}</span><ArrowSquareOut size={17}/></button>}
        {current.kind === 'link' && <div className="detail-extra"><SitePreview draft={current}/><div className="link-row"><LinkStatus entry={current}/><LinkActions entry={current} changed={reload} notify={notify}/></div></div>}
        {current.content && <div className="content-block"><div className="block-label">{current.kind === 'command' ? 'Komut' : current.kind === 'program' ? 'Kullanım notları' : 'İçerik'}<button className="icon-button" aria-label="İçeriği kopyala" title="Kopyala" onClick={() => copy(current.content)}><Copy size={16}/></button></div><RichContent draft={current}/></div>}
        {current.assets.length > 0 && <div className="detail-photos">{current.assets.map(a => <button key={a.id} className="photo-button" onClick={() => setLightbox(a)}><Photo asset={a}/><span>{a.name}</span></button>)}</div>}
        {['note', 'command'].includes(current.kind) && <button className="history-button" onClick={() => setHistoryId(current.id)}><Clock size={17}/> Sürüm geçmişi <span>{current.history?.length ?? 0}</span></button>}
        <dl className="metadata">{!isListKind(current.kind) && <div><dt><Folder size={15}/>Kategori</dt><dd>{current.category ? <button className="meta-link" onClick={() => { setCategory(current.category); setSelected(null); }}>{current.category}</button> : 'Kategorisiz'}</dd></div>}<div><dt><Clock size={15}/>Oluşturulma</dt><dd>{dateTime(current.createdAt)}</dd></div><div><dt><PencilSimple size={15}/>Düzenlenme</dt><dd>{dateTime(current.updatedAt)}</dd></div></dl>
        {current.tags.length > 0 && <div className="detail-tags">{current.tags.map(t => <button key={t} title="Bu etiketle filtrele" onClick={() => { setTag(t); setSelected(null); }}>#{t}</button>)}</div>}
      </div>
      <div className="detail-actions">{current.deletedAt ? <><button className="primary" onClick={() => run(() => getAPI().trash(current.id, true), 'Kayıt geri alındı.')}><ArrowCounterClockwise size={18}/>Kaydı geri al</button><button className="danger icon-button bordered" aria-label="Kaydı kalıcı olarak sil" title="Kalıcı olarak sil" onClick={() => setPurge(current)}><Trash size={19}/></button></> : <>
        {current.kind === 'link' || isListKind(current.kind) && current.url ? <button className="primary" onClick={() => run(() => getAPI().openUrl(current.url))}><ArrowSquareOut size={18}/>Bağlantıyı aç</button> : <button className="primary" onClick={() => copy(copyText(current))}><Copy size={18}/>{current.kind === 'command' ? 'Komutu kopyala' : 'Kopyala'}</button>}
        <button onClick={() => setEditor(current)}><PencilSimple size={18}/>Düzenle</button>
        <button className="danger icon-button bordered" aria-label="Kaydı sil" title="Çöp kutusuna taşı" onClick={() => setConfirmDelete(current)}><Trash size={19}/></button>
      </>}</div>
    </aside>}
    {editor && <EntryEditor initial={editor} entries={snapshot.entries} categories={categories} knownTags={snapshot.tags} close={() => setEditor(null)} saved={async entry => { await reload(); setEditor(null); setFlash(entry.id); notify('Kayıt kaydedildi.'); }}/>}
    {showCategories && <CategoryManager browse={value => { navigate('all', value); setShowCategories(false); }} snapshot={snapshot} close={() => setShowCategories(false)} changed={reload} notify={notify}/>}
    {showTags && <CategoryManager kind="tag" snapshot={snapshot} close={() => setShowTags(false)} changed={reload} notify={notify}/>}
    {integrations && <Modal title="Hızlı kayıt: masaüstü ve tarayıcılar" close={() => setIntegrations(false)}><div className="modal-body integration">
      <section><h3><TerminalWindow size={18}/>Windows’tan hızlı kayıt</h3><p>Setup, masaüstü ve Dosya Gezgini sağ tık menülerine <strong>DubBitig’e kaydet</strong> seçeneğini ekler. Windows 11’de <em>Daha fazla seçenek</em> altında görünebilir.</p><p>Herhangi bir uygulamada metni kopyala ve DubBitig açıkken <kbd>Ctrl</kbd> + <kbd>Alt</kbd> + <kbd>D</kbd> tuşlarına bas. Bağlantılar link, diğer metinler not olarak kaydedilir.</p><button onClick={() => run(() => getAPI().captureClipboard())}><Copy size={17}/>Panodakini şimdi kaydet</button></section>
      <section><h3><PlugsConnected size={18}/>Chrome eklentisi</h3><ol><li>Aşağıdaki düğmeyle eklenti klasörünü aç.</li><li>Chrome adres çubuğuna <strong>chrome://extensions</strong> yaz.</li><li>Geliştirici modunu aç; <strong>Paketlenmemiş öğe yükle</strong> ile bu klasörü seç.</li></ol><button onClick={() => run(() => getAPI().integrationFolder())}><FolderOpen size={17}/>Chrome eklentisi klasörünü aç</button></section>
      <section><h3><PlugsConnected size={18}/>Firefox eklentisi</h3><ol><li>Aşağıdaki düğmeyle Firefox eklenti klasörünü aç.</li><li>Firefox adres çubuğuna <strong>about:debugging#/runtime/this-firefox</strong> yaz.</li><li><strong>Geçici eklenti yükle</strong> ile klasördeki <strong>manifest.json</strong> dosyasını seç. Kalıcı kurulum için eklentinin Mozilla tarafından imzalanması gerekir.</li></ol><button onClick={() => run(() => getAPI().integrationFolder('firefox'))}><FolderOpen size={17}/>Firefox eklentisi klasörünü aç</button></section>
      <p className="hint">Setup, Chrome ile bağlantıyı otomatik kurar. Mağazada yayımlanana kadar eklenti bir kez elle yüklenmelidir. Chrome’da bağlantıya veya seçili metne sağ tıkla → DubBitig’e kaydet. Eklenti yalnızca sen kaydet dediğinde içerik aktarır; komutları çalıştırmaz.</p>
    </div></Modal>}
    {historyId && snapshot.entries.find(e => e.id === historyId) && <HistoryPanel entry={snapshot.entries.find(e => e.id === historyId)!} close={() => setHistoryId(null)} changed={reload} notify={notify}/>}
    {inbox && <ReminderInbox entries={alive} close={() => setInbox(false)} changed={reload} notify={notify} show={e => { setInbox(false); navigate('all'); setSelected(e.id); }} edit={e => { setInbox(false); setSelected(e.id); setEditor(e); }}/>}
    {showSettings && <SettingsPanel update={update} checkUpdate={async () => { const info = await getAPI().checkUpdate(true); setUpdate(info); return info; }} reset={async () => { setSelected(null); setCategory(''); setTag(''); setQuery(''); setSection('all'); const s = await getAPI().settings(); setTheme(s.theme); setDesignStyle(s.designStyle); await reload(); }} designStyle={designStyle} changeDesignStyle={async value => { await getAPI().setDesignStyle(value); setDesignStyle(value); }} theme={theme} close={() => setShowSettings(false)} changed={reload} notify={notify} transfer={mode => { setShowSettings(false); setTransfer(mode); }}/>}
    {transfer && <TransferPanel mode={transfer} snapshot={snapshot} initialCategory={category} close={() => setTransfer(null)} changed={reload} notify={notify}/>}
    {confirmDelete && <Modal modal title="Kaydı çöp kutusuna taşı" close={() => setConfirmDelete(null)}><div className="modal-body"><p><strong>{confirmDelete.title}</strong> çöp kutusuna taşınacak. Daha sonra Çöp kutusu bölümünden geri alabilirsin.</p></div><div className="modal-actions"><button onClick={() => setConfirmDelete(null)}>Vazgeç</button><button className="danger-solid" onClick={() => run(async () => { await getAPI().trash(confirmDelete.id); setConfirmDelete(null); setSelected(null); }, 'Kayıt çöp kutusuna taşındı.')}><Trash size={18}/>Çöp kutusuna taşı</button></div></Modal>}
    {purge && <Modal modal title={purge === 'all' ? 'Çöp kutusunu boşalt' : 'Kaydı kalıcı olarak sil'} close={() => setPurge(null)}><div className="modal-body"><p>{purge === 'all' ? <><strong>{trashed} kayıt</strong> ve yalnızca bu kayıtlara ait fotoğraflar kalıcı olarak silinecek.</> : <><strong>{purge.title}</strong> ve yalnızca bu kayda ait fotoğraflar kalıcı olarak silinecek.</>}</p><p className="muted">Bu işlem geri alınamaz. Daha önce alınmış yedeklerdeki kopyalar korunur.</p></div><div className="modal-actions"><button onClick={() => setPurge(null)}>Vazgeç</button><button className="danger-solid" onClick={() => run(async () => { const result = await getAPI().emptyTrash(purge === 'all' ? undefined : purge.id); setPurge(null); setSelected(null); notify(`${result.entries} kayıt kalıcı olarak silindi${result.files ? `, ${result.files} dosya temizlendi (${size(result.bytes)})` : ''}.`); })}><Trash size={18}/>{purge === 'all' ? 'Çöp kutusunu boşalt' : 'Kalıcı olarak sil'}</button></div></Modal>}
    {lightbox && <Modal title={lightbox.name} close={() => setLightbox(null)} wide><Photo asset={lightbox} className="lightbox-image"/></Modal>}
    {toast && <Notification {...toast} close={() => setToast(null)}/>}
  </div>;
}

function EntryCard({ entry, layout, flash, chosen, open, favorite, copy }: { entry: Entry; layout: 'grid' | 'list'; flash: boolean; chosen: boolean; open: () => void; favorite: () => void; copy: () => void }) {
  const summary = entry.description || (entry.kind === 'note' || entry.kind === 'program' ? plainText(entry.content) : '') || (entry.assets.length ? `${entry.assets.length} fotoğraf` : '');
  const cover = entry.assets[0] ?? (entry.kind === 'link' ? entry.preview?.image : undefined);
  const ref = useRef<HTMLElement>(null);
  useEffect(() => { if (flash) ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, [flash]);
  return <article ref={ref} className={`entry-card ${entry.kind} ${chosen ? 'chosen' : ''} ${flash ? 'flash' : ''}`}>
    <button className="card-open" aria-label={`${entry.title} kaydını aç`} onClick={open}>
      <span className="card-top"><span className={`type-badge ${entry.kind}`}><TypeIcon kind={entry.kind} size={16}/><span>{labels[entry.kind]}</span></span><span className="card-date">{date(entry.createdAt)}</span></span>
      <h3>{layout === 'list' && entry.assets[0] && <Photo asset={entry.assets[0]} className="list-thumb"/>}{entry.preview?.favicon && <Photo asset={entry.preview.favicon} className="site-favicon"/>}{entry.title}</h3>
      {entry.kind === 'command' && <pre className="command-preview"><span>›</span>{entry.content}</pre>}
      {cover && layout === 'grid' && <Photo asset={cover} className="card-photo"/>}
      {(entry.kind === 'link' || isListKind(entry.kind) && entry.url) && <span className="link-preview"><LinkIcon size={14}/>{entry.url.replace(/^https?:\/\/(www\.)?/, '')}</span>}
      {summary && <span className="card-description">{summary}</span>}
      {(entry.reminder?.enabled || entry.expiresAt || entry.kind === 'link') && <span className="card-meta"><EntryDates entry={entry} compact/>{entry.kind === 'link' && <LinkStatus entry={entry}/>}</span>}
    </button>
    <div className="card-footer">
      <span className="card-tags">{!isListKind(entry.kind) && <span className="card-category" title={entry.category || 'Kategorisiz'}><Folder size={13}/><span>{entry.category || 'Kategorisiz'}</span></span>}{entry.tags.slice(0, 2).map(t => <span key={t}>#{t}</span>)}{entry.tags.length > 2 && <span>+{entry.tags.length - 2}</span>}</span>
      <div>{!entry.deletedAt && <button className={`icon-button favorite ${entry.favorite ? 'is-favorite' : ''}`} title={entry.favorite ? 'Favorilerden çıkar' : 'Favorilere ekle'} aria-label={entry.favorite ? `${entry.title} favorilerden çıkar` : `${entry.title} favorilere ekle`} onClick={favorite}><Star size={17} weight={entry.favorite ? 'fill' : 'regular'}/></button>}<button className="icon-button" title={entry.deletedAt ? 'Geri al' : entry.kind === 'link' || isListKind(entry.kind) && entry.url ? 'Bağlantıyı kopyala' : 'Kopyala'} aria-label={`${entry.title} ${entry.deletedAt ? 'geri al' : 'kopyala'}`} onClick={copy}>{entry.deletedAt ? <ArrowCounterClockwise size={17}/> : <Copy size={17}/>}</button></div>
    </div>
  </article>;
}

function EntryEditor({ initial, entries, categories, knownTags, close, saved }: { initial: Entry | Draft; entries: Entry[]; categories: string[]; knownTags: string[]; close: () => void; saved: (entry: Entry) => Promise<void> }) {
  const [draft, setDraft] = useState<Draft>({ ...initial, kind: initial.kind === 'photo' ? 'note' : initial.kind }); const [tagText, setTagText] = useState(initial.tags.join(', '));
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const [discard, setDiscard] = useState(false);
  const [previewState, setPreviewState] = useState(''); const [previewAttempt, setPreviewAttempt] = useState(0); const [fetching, setFetching] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const list = isListKind(draft.kind);
  useEffect(() => {
    const url = normalizeUrl(draft.url);
    if (draft.kind !== 'link' || !/^https?:\/\/[^/]+\.[^/]+/i.test(url) || (draft.preview?.url === url && previewAttempt === 0)) return;
    let active = true; setPreviewState('');
    const timer = setTimeout(() => { setFetching(true); setPreviewState('Site başlığı ve önizlemesi alınıyor…');
      getAPI().previewUrl(url).then(preview => { if (!active) return; setDraft(d => ({ ...d, preview, title: !d.title || d.title === d.preview?.title ? preview.title : d.title, description: !d.description || d.description === d.preview?.description ? preview.description : d.description })); setPreviewState('Site bilgileri alındı.'); }).catch(e => { if (active) setPreviewState(message(e)); }).finally(() => { if (active) setFetching(false); });
    }, 800);
    return () => { active = false; clearTimeout(timer); setFetching(false); };
  }, [draft.url, draft.kind, previewAttempt]);
  const duplicate = findDuplicate(entries, draft, initial);
  const changed = JSON.stringify(draft) !== JSON.stringify(initial) || tagText !== initial.tags.join(', ');
  const requestClose = () => changed ? setDiscard(true) : close();
  const update = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft(d => ({ ...d, [key]: value }));
  const tagValues = tagText.split(',').map(v => v.trim()).filter(Boolean);
  const submit = async (event: FormEvent) => {
    event.preventDefault(); if (busy || fetching) return; setError(''); setBusy(true);
    try {
      // Fields hidden by the chosen type must not be saved invisibly.
      const hasUrl = draft.kind === 'link' || draft.kind === 'program' || list;
      const input = { ...draft, url: hasUrl ? normalizeUrl(draft.url) : '', preview: draft.kind === 'link' ? draft.preview : null, tags: [...new Set(tagValues)], ...(list ? { content: '', category: '', assets: [], reminder: null, expiresAt: null } : {}) };
      if (duplicate) throw new Error(`${duplicate.reason}: “${duplicate.entry.title}”${duplicate.entry.deletedAt ? ' (çöp kutusunda)' : ''}.`);
      const result = draftSchema.safeParse(input); if (!result.success) throw new Error(result.error.issues.map(i => i.message).join(' '));
      await saved(await getAPI().save(result.data, 'id' in initial ? initial.id : undefined));
    } catch (e) { setError(message(e)); } finally { setBusy(false); }
  };
  return <Modal title={'id' in initial ? 'Kaydı düzenle' : 'Yeni kayıt'} close={() => { if (!busy) requestClose(); }} wide><form ref={formRef} onSubmit={submit} onKeyDown={e => { if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 's' || e.key === 'Enter')) { e.preventDefault(); formRef.current?.requestSubmit(); } }}><div className="editor-body">
    <div className="kind-picker" role="group" aria-label="Kayıt türü">{uiKinds.map(k => <button key={k} type="button" aria-pressed={draft.kind === k} className={`${k} ${draft.kind === k ? 'active' : ''}`} onClick={() => update('kind', k)}><TypeIcon kind={k} size={18}/>{labels[k]}</button>)}</div>
    {(draft.kind === 'link' || draft.kind === 'program' || list) && <label>{draft.kind === 'program' ? 'Programın web sitesi' : list ? 'Bağlantı' : 'Bağlantı *'}<input type="text" inputMode="url" spellCheck={false} required={draft.kind === 'link'} autoFocus={draft.kind === 'link'} maxLength={4000} placeholder={draft.kind === 'movie' ? 'imdb.com/title/…' : draft.kind === 'book' ? 'goodreads.com/book/…' : 'ornek.com'} value={draft.url} onChange={e => update('url', e.target.value)} onBlur={() => { const url = normalizeUrl(draft.url); if (url !== draft.url) update('url', url); }}/>{draft.url && !/^[a-z][a-z0-9+.-]*:/i.test(draft.url.trim()) && normalizeUrl(draft.url) !== draft.url.trim() && <small>Kaydedilirken <strong>{normalizeUrl(draft.url)}</strong> olarak eklenecek.</small>}<FieldWarning duplicate={duplicate} keys={['url', 'program-url', 'movie-url', 'book-url']}/></label>}
    {draft.kind === 'link' && <div className="editor-preview"><p className="hint" role="status">{previewState || 'Bağlantıyı yapıştırınca başlık, site ikonu ve varsa önizleme otomatik alınır. Yazdığın başlık korunur.'}</p>{draft.preview?.url === normalizeUrl(draft.url) && <SitePreview draft={draft}/>}<button type="button" className="small" disabled={fetching || !draft.url} onClick={() => setPreviewAttempt(v => v + 1)}>Site bilgilerini yenile</button></div>}
    <label>{draft.kind === 'movie' ? 'Dizi / film adı' : draft.kind === 'book' ? 'Kitap adı' : 'Başlık'} <span className="required">*</span><input autoFocus={draft.kind !== 'link'} required maxLength={200} value={draft.title} onChange={e => update('title', e.target.value)} placeholder={draft.kind === 'command' ? 'Örn. Çalışan işlemleri listele' : draft.kind === 'link' ? 'Örn. Tasarım kaynaklarım' : draft.kind === 'movie' ? 'Örn. Kurtlar Vadisi' : draft.kind === 'book' ? 'Örn. Tutunamayanlar' : 'Kaydına bir isim ver'}/><FieldWarning duplicate={duplicate} keys={['title']}/></label>
    <label>Açıklama<textarea rows={list ? 4 : 2} maxLength={10000} value={draft.description} onChange={e => update('description', e.target.value)} placeholder={draft.kind === 'movie' ? 'Konusu, kim önerdi, izledin mi…' : draft.kind === 'book' ? 'Yazarı, kim önerdi, okudun mu…' : 'Ne için kullanıyorsun? Hatırlamak istediğin ayrıntılar…'}/></label>
    {!list && <ContentEditor draft={draft} update={update}/>}
    <FieldWarning duplicate={duplicate} keys={['command']} block/>
    <div className={list ? '' : 'form-columns'}>
      {!list && <label>Kategori<Typeahead maxLength={80} value={draft.category} onValueChange={v => update('category', v)} items={matches(categories.filter(c => c !== draft.category), draft.category).map(c => ({ key: c, label: c, icon: <Folder size={14}/> }))} onPick={item => update('category', item.label)} placeholder="Seç veya yeni kategori yaz"/>{draft.category.trim() && !categories.includes(draft.category.trim()) && <small>Yeni kategori olarak eklenecek.</small>}</label>}
      <label>Etiketler<Typeahead value={tagText} onValueChange={setTagText} items={matches(knownTags.filter(t => !tagValues.includes(t)), tagText.split(',').pop() ?? '').map(t => ({ key: t, label: '#' + t, icon: <Tag size={14}/> }))} onPick={item => setTagText([...tagText.split(',').slice(0, -1).map(v => v.trim()).filter(Boolean), item.key].join(', ') + ', ')} placeholder="windows, iş, faydalı"/><small>Virgülle ayır; yazarken öneriler çıkar.</small></label>
    </div>
    {[...new Set([...knownTags, ...tagValues])].length > 0 && <div className="editor-tag-options">{[...new Set([...knownTags, ...tagValues])].sort((a, b) => a.localeCompare(b, 'tr')).map(t => { const chosen = tagValues.includes(t); return <button type="button" key={t} aria-pressed={chosen} aria-label={`${t} etiketini ${chosen ? 'kayıttan kaldır' : 'kayda ekle'}`} onClick={() => setTagText((chosen ? tagValues.filter(v => v !== t) : [...tagValues, t]).join(', '))}>#{t}{chosen ? <X size={11}/> : <Plus size={11}/>}</button>; })}</div>}
    {!list && <section className="editor-section"><div className="attachment-heading"><span><ImageSquare size={18}/>Fotoğraflar {draft.assets.length > 0 && <small>({draft.assets.length}/30)</small>}</span><button type="button" className="small" disabled={busy} onClick={async () => { setBusy(true); try { const photos = await getAPI().addPhotos(); if (draft.assets.length + photos.length > 30) throw new Error('Bir kayda en fazla 30 fotoğraf ekleyebilirsin.'); update('assets', [...draft.assets, ...photos]); } catch (e) { setError(message(e)); } finally { setBusy(false); } }}><Plus size={15}/>Fotoğraf ekle</button></div>{draft.assets.length ? <div className="attachment-list">{draft.assets.map(asset => <div key={asset.id}><Photo asset={asset}/><span>{asset.name}<small>{size(asset.size)}</small></span><button type="button" className="icon-button" aria-label={`${asset.name} kaldır`} onClick={() => update('assets', draft.assets.filter(a => a.id !== asset.id))}><X size={16}/></button></div>)}</div> : <p className="attachment-hint">PNG, JPEG, WebP veya GIF · Dosya başına en fazla 20 MB{draft.kind === 'photo' && ' · Bu kayıt türünde en az bir fotoğraf gerekir'}</p>}</section>}
    {!list && <ScheduleFields draft={draft} update={update}/>}
    <label className="checkbox-row"><input type="checkbox" checked={draft.favorite} onChange={e => update('favorite', e.target.checked)}/><Star size={17} weight={draft.favorite ? 'fill' : 'regular'}/>Favorilere ekle</label>
    {error && <p className="form-error" role="alert"><WarningCircle size={19}/>{error}</p>}
  </div>
  {discard && <div className="discard-notice" role="alert"><p><WarningCircle size={18}/>Kaydedilmemiş değişikliklerin var. Kaydetmeden çıkılsın mı?</p><div><button type="button" onClick={() => setDiscard(false)}>Düzenlemeye devam et</button><button type="button" className="danger-solid" onClick={close}>Kaydetmeden çık</button></div></div>}
  <div className="modal-actions"><span><kbd>Ctrl</kbd>+<kbd>S</kbd> ile kaydet</span><button type="button" disabled={busy} onClick={requestClose}>Vazgeç</button><button className="primary" type="submit" disabled={busy || fetching}><Check size={18}/>{busy ? 'Kaydediliyor…' : fetching ? 'Önizleme alınıyor…' : 'Kaydet'}</button></div></form></Modal>;
}

function CategoryManager({ snapshot, close, changed, notify, browse, kind = 'category' }: { browse?: (category: string) => void; snapshot: Snapshot; close: () => void; changed: () => Promise<void>; notify: (v: string, e?: boolean) => void; kind?: 'category' | 'tag' }) {
  const [name, setName] = useState(''); const [editing, setEditing] = useState<string | null>(null); const [next, setNext] = useState(''); const [busy, setBusy] = useState(false); const [removing, setRemoving] = useState<string | null>(null); const [error, setError] = useState('');
  const isTag = kind === 'tag'; const noun = isTag ? 'Etiket' : 'Kategori'; const title = isTag ? 'Etiketleri yönet' : 'Kategorileri yönet';
  const [filter, setFilter] = useState('');
  const all = [...(isTag ? snapshot.tags : snapshot.categories)].sort((a, b) => a.localeCompare(b, 'tr'));
  const values = filter.trim() ? matches(all, filter, all.length) : all;
  const exists = all.some(v => v.toLocaleLowerCase('tr-TR') === name.trim().toLocaleLowerCase('tr-TR'));
  const count = (value: string) => snapshot.entries.filter(e => isTag ? e.tags.includes(value) : e.category === value).length;
  const action = async (a: 'add' | 'rename' | 'delete', value: string, replacement?: string) => { setBusy(true); setError(''); try { if (isTag) await getAPI().tag(a, value, replacement); else await getAPI().category(a, value, replacement); setName(''); setEditing(null); setRemoving(null); await changed(); notify(isTag ? 'Etiketler güncellendi.' : 'Kategoriler güncellendi.'); } catch (e) { setError(message(e)); } finally { setBusy(false); } };
  return <Modal title={title} close={() => { if (!busy) close(); }}><div className="modal-body"><p className="muted">{isTag ? 'Bir etiketi kaldırdığında etiket, çöp kutusu dahil bütün kayıtlardan çıkarılır. Kayıtların silinmez.' : 'Kategoriyi kaldırdığında kayıtlar Kategorisiz bölümüne taşınır. Kayıtların ve fotoğrafların silinmez.'}</p>
    <form className="inline-form" onSubmit={e => { e.preventDefault(); action('add', name); }}><input required maxLength={isTag ? 40 : 80} aria-label={isTag ? 'Yeni etiket adı' : 'Yeni kategori adı'} placeholder={isTag ? 'Yeni etiket adı' : 'Yeni kategori adı'} value={name} onChange={e => setName(e.target.value)}/><button className="primary" disabled={busy || exists}><Plus size={18}/>Ekle</button></form>
    {exists && <p className="field-warning" role="alert"><WarningCircle size={15}/>{isTag ? 'Bu etiket zaten var.' : 'Bu kategori zaten var.'}</p>}
    {all.length > 3 && <div className="search-box compact"><MagnifyingGlass size={16}/><input aria-label={isTag ? 'Etiketlerde ara' : 'Kategorilerde ara'} placeholder={isTag ? 'Etiketlerde ara…' : 'Kategorilerde ara…'} value={filter} onChange={e => setFilter(e.target.value)}/>{filter && <button className="icon-button" aria-label="Aramayı temizle" onClick={() => setFilter('')}><X size={14}/></button>}</div>}
    <div className="category-list">{values.map(c => <div key={c}>{isTag ? <Tag size={18}/> : <Folder size={18}/>} {editing === c ? <form className="inline-form" onSubmit={e => { e.preventDefault(); action('rename', c, next); }}><input aria-label={noun + ' adı'} autoFocus required maxLength={isTag ? 40 : 80} value={next} onChange={e => setNext(e.target.value)}/><button disabled={busy} aria-label={noun + ' adını kaydet'}><Check size={18}/></button><button type="button" aria-label="Yeniden adlandırmayı iptal et" onClick={() => setEditing(null)}><X size={18}/></button></form> : <><span>{c}<small>{count(c)} kayıt</small></span>{browse && <Button variant="ghost" size="sm" aria-label={c + ' kayıtlarını göster'} onClick={() => browse(c)}>Kayıtları göster</Button>}<button disabled={busy} className="icon-button" aria-label={c + ' yeniden adlandır'} onClick={() => { setEditing(c); setNext(c); setRemoving(null); }}><PencilSimple size={17}/></button><button disabled={busy} className="remove-taxonomy danger" aria-label={c + (isTag ? ' etiketini kaldır' : ' kategorisini kaldır')} onClick={() => { setRemoving(c); setEditing(null); }}><Trash size={16}/>Kaldır</button></>}</div>)}</div>
    {browse && <Button variant="outline" className="mt-4" onClick={() => browse('__none')}>Kategorisiz kayıtları göster</Button>}
    {!values.length && filter && <p className="muted">“{filter}” ile eşleşen {isTag ? 'etiket' : 'kategori'} yok.</p>}
    {!all.length && <p className="muted">{isTag ? 'Henüz etiket yok. Yukarıdan ekleyebilirsin.' : 'Henüz kategori yok. Yukarıdan ekleyebilirsin.'}</p>}
    {removing && <div className="taxonomy-confirm" role="alert"><strong>“{removing}” kaldırılsın mı?</strong><p>{count(removing)} kayıt etkilenecek. {isTag ? 'Yalnızca etiket kaldırılır; kayıtların korunur.' : 'Kayıtlar Kategorisiz bölümüne taşınır.'}</p><button disabled={busy} onClick={() => setRemoving(null)}>Vazgeç</button><button className="danger-solid" disabled={busy} onClick={() => action('delete', removing)}>{isTag ? 'Etiketi kaldır' : 'Kategoriyi kaldır'}</button></div>}
    {error && <p className="form-error" role="alert">{error}</p>}
  </div></Modal>;
}

function FieldWarning({ duplicate, keys, block = false }: { duplicate: ReturnType<typeof findDuplicate>; keys: string[]; block?: boolean }) {
  if (!duplicate || !keys.includes(duplicate.key)) return null;
  return <p className={`field-warning ${block ? 'block' : ''}`} role="alert"><WarningCircle size={15}/>{duplicate.reason}: “{duplicate.entry.title}”{duplicate.entry.deletedAt ? ' (çöp kutusunda)' : ''}</p>;
}
function SitePreview({ draft }: { draft: Draft }) {
  const p = draft.preview; if (!p) return null;
  return <div className="site-preview">{p.image && <Photo asset={p.image} className="web-preview-image"/>}<div>{p.favicon && <Photo asset={p.favicon} className="site-favicon"/>}<span><strong>{p.site}</strong><small>{p.title}</small></span></div></div>;
}
function LinkStatus({ entry }: { entry: Entry }) {
  const c = entry.linkCheck;
  return <span className={`link-health ${c?.state ?? 'unknown'}`} title={c ? `${c.detail} · ${dateTime(c.checkedAt)}` : 'Arka plan denetimi bekleniyor'}><span/>{!c ? 'Henüz denetlenmedi' : c.state === 'ok' ? 'Erişilebilir' : c.state === 'broken' ? 'Kırık bağlantı' : 'Durum belirsiz'}{c?.status ? ` · ${c.status}` : ''}</span>;
}
function LinkActions({ entry, changed, notify }: { entry: Entry; changed: () => Promise<void>; notify: (v: string, e?: boolean) => void }) {
  const [busy, setBusy] = useState(false);
  const act = async (preview: boolean) => { setBusy(true); try { if (preview) { const p = await getAPI().previewUrl(entry.url); const latest = (await getAPI().snapshot()).entries.find(e => e.id === entry.id); if (latest && latest.url === entry.url && !latest.deletedAt) await getAPI().save({ ...latest, preview: p }, entry.id); } else await getAPI().checkLinks(entry.id); await changed(); notify(preview ? 'Önizleme güncellendi.' : 'Bağlantı denetimi tamamlandı.'); } catch (e) { notify(message(e), true); } finally { setBusy(false); } };
  return <div className="detail-link-actions"><button className="small" disabled={busy || !!entry.deletedAt} onClick={() => act(false)}>{busy ? 'Bekle…' : 'Bağlantıyı denetle'}</button><button className="small" disabled={busy || !!entry.deletedAt} onClick={() => act(true)}>Önizlemeyi al</button></div>;
}
const localDateInput = (value?: string | null) => { if (!value) return ''; const d = new Date(value); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };
function ScheduleFields({ draft, update }: { draft: Draft; update: <K extends keyof Draft>(key: K, value: Draft[K]) => void }) {
  const later = (days: number) => { const at = new Date(); at.setDate(at.getDate() + days); at.setHours(9, 0, 0, 0); update('reminder', { at: at.toISOString(), repeat: draft.reminder?.repeat ?? 'once', enabled: true }); };
  return <section className="editor-section schedule-fields"><h3><Bell size={18}/> Hatırlatıcı ve son kullanma tarihi</h3>
    <div className="form-columns"><label>Hatırlatma zamanı<input aria-label="Hatırlatma zamanı" type="datetime-local" value={localDateInput(draft.reminder?.at)} onChange={e => update('reminder', e.target.value ? { at: new Date(e.target.value).toISOString(), repeat: draft.reminder?.repeat ?? 'once', enabled: true } : null)}/></label><label>Tekrar<select aria-label="Hatırlatma tekrarı" disabled={!draft.reminder} value={draft.reminder?.repeat ?? 'once'} onChange={e => draft.reminder && update('reminder', { ...draft.reminder, repeat: e.target.value as NonNullable<Draft['reminder']>['repeat'], enabled: true })}><option value="once">Bir kez</option><option value="daily">Her gün</option><option value="weekly">Her hafta</option><option value="monthly">Her ay</option></select></label></div>
    <div className="schedule-shortcuts"><span>Hızlı seç:</span><button type="button" onClick={() => later(1)}>Yarın 09:00</button><button type="button" onClick={() => later(3)}>3 gün sonra hatırlat</button><button type="button" onClick={() => later(7)}>1 hafta sonra</button>{draft.reminder && <><label className="checkbox-row"><input type="checkbox" checked={draft.reminder.enabled} onChange={e => draft.reminder && update('reminder', { ...draft.reminder, enabled: e.target.checked })}/>Etkin</label><button type="button" className="danger" onClick={() => update('reminder', null)}>Hatırlatıcıyı kaldır</button></>}</div>
    <label className="expiry-field">Son kullanma tarihi<input aria-label="Son kullanma tarihi" type="datetime-local" value={localDateInput(draft.expiresAt)} onChange={e => update('expiresAt', e.target.value ? new Date(e.target.value).toISOString() : null)}/></label>
    <p className="hint">Tarih geldiğinde bildirim gösterilir; kayıt silinmez. Uygulama kapalıyken kaçırılan hatırlatmalar sonraki açılışta gösterilir.</p></section>;
}
function EntryDates({ entry, compact = false }: { entry: Entry; compact?: boolean }) {
  const expired = entry.expiresAt && new Date(entry.expiresAt) <= new Date();
  if (!entry.reminder?.enabled && !entry.expiresAt) return null;
  return <span className={`entry-dates ${compact ? 'compact' : ''}`}>{entry.reminder?.enabled && <span className="date-chip" title={dateTime(entry.reminder.at)}><Bell size={13}/>{compact ? relative(entry.reminder.at) : dateTime(entry.reminder.at)}{entry.reminder.repeat !== 'once' && ` · ${({ daily: 'Her gün', weekly: 'Her hafta', monthly: 'Her ay' })[entry.reminder.repeat]}`}</span>}{entry.expiresAt && <span className={`date-chip ${expired ? 'danger' : ''}`} title={dateTime(entry.expiresAt)}><Clock size={13}/>{expired ? 'Süresi doldu' : 'Son kullanım'} · {compact ? relative(entry.expiresAt) : dateTime(entry.expiresAt)}</span>}</span>;
}
function HistoryPanel({ entry, close, changed, notify }: { entry: Entry; close: () => void; changed: () => Promise<void>; notify: (v: string, e?: boolean) => void }) {
  const [selected, setSelected] = useState(entry.history?.[0]?.id ?? ''); const [busy, setBusy] = useState(false); const [confirm, setConfirm] = useState(false);
  const h = entry.history?.find(v => v.id === selected);
  return <Modal title="Sürüm geçmişi" close={() => { if (!busy) close(); }} wide><div className="modal-body"><p className="muted">{entry.title} · Son 50 içerik sürümü tutulur. Geri yükleme sırasında mevcut içerik de geçmişe kaydedilir.</p><div className="history-layout"><div className="history-list">{entry.history?.map(v => <button className={selected === v.id ? 'selected' : ''} key={v.id} onClick={() => { setSelected(v.id); setConfirm(false); }}><strong>Sürüm {v.revision}</strong><small>{dateTime(v.savedAt)}</small></button>)}</div>{h ? <div className="history-content"><h3>{h.draft.title}</h3><p>{h.draft.description}</p><RichContent draft={h.draft}/>{h.draft.assets.map(a => <Photo key={a.id} asset={a} className="web-preview-image"/>)}</div> : <p className="muted">Henüz eski sürüm yok. Not veya komutun içeriğini değiştirdiğinde önceki hali burada saklanır.</p>}</div>{h && !entry.deletedAt && <div className="history-restore">{confirm ? <><p>Seçili sürümün içeriği geri yüklensin mi? Kategori, etiket ve hatırlatıcıların korunur.</p><button disabled={busy} onClick={() => setConfirm(false)}>Vazgeç</button><button className="primary" disabled={busy} onClick={async () => { setBusy(true); try { await getAPI().restoreRevision(entry.id, h.id); await changed(); notify('Eski sürüm geri yüklendi.'); close(); } catch (e) { notify(message(e), true); } finally { setBusy(false); } }}>Geri yüklemeyi onayla</button></> : <button className="primary" onClick={() => setConfirm(true)}><ArrowCounterClockwise size={18}/>Bu sürümü geri yükle</button>}</div>}</div></Modal>;
}
function ReminderInbox({ entries, close, changed, notify, show, edit }: { entries: Entry[]; close: () => void; changed: () => Promise<void>; notify: (v: string, e?: boolean) => void; show: (entry: Entry) => void; edit: (entry: Entry) => void }) {
  const [busy, setBusy] = useState(false);
  const notices = entries.flatMap(e => (e.notices ?? []).map(n => ({ entry: e, notice: n }))).sort((a, b) => b.notice.at.localeCompare(a.notice.at));
  const unread = notices.filter(n => !n.notice.read);
  // Sort by the date that put the entry in this list; a disabled reminder must not decide the order.
  const due = (e: Entry) => [e.reminder?.enabled ? e.reminder.at : null, e.expiresAt && new Date(e.expiresAt) > new Date() ? e.expiresAt : null].filter((v): v is string => !!v).sort()[0];
  const upcoming = entries.filter(e => due(e)).sort((a, b) => due(a).localeCompare(due(b)));
  const read = async (items: typeof notices) => { setBusy(true); try { for (const { entry, notice } of items) await getAPI().readNotice(entry.id, notice.id); await changed(); } catch (e) { notify(message(e), true); } finally { setBusy(false); } };
  return <Modal title="Hatırlatıcılar" close={close} wide><div className="modal-body"><p className="muted">Windows bildirimleri kapalı olsa bile hatırlatmalar burada kalır. Uygulama açıkken tarihler her dakika kontrol edilir.</p>
    <div className="section-heading"><h3>Bildirimler {unread.length > 0 && <span className="pill">{unread.length} yeni</span>}</h3>{unread.length > 1 && <button className="small" disabled={busy} onClick={() => read(unread)}><Checks size={16}/>Tümünü okundu say</button>}</div>
    <div className="reminder-list">{notices.map(({ entry, notice }) => <div key={notice.id} className={notice.read ? '' : 'unread'}>{notice.kind === 'expiry' ? <Clock size={19}/> : <Bell size={19}/>}<button className="reminder-open" onClick={() => show(entry)}><strong>{entry.title}</strong><small>{notice.kind === 'expiry' ? 'Son kullanma tarihi geldi' : 'Hatırlatma'} · {dateTime(notice.at)}</small></button>{!notice.read && <button className="small" disabled={busy} onClick={() => read([{ entry, notice }])}>Okundu</button>}</div>)}{!notices.length && <p className="muted">Henüz bildirim yok.</p>}</div>
    <h3>Planlananlar</h3>
    <div className="reminder-list">{upcoming.map(e => <div key={e.id}><button className="reminder-open" onClick={() => show(e)}><strong>{e.title}</strong><EntryDates entry={e}/></button><button className="small" onClick={() => edit(e)}><PencilSimple size={15}/>Düzenle</button></div>)}{!upcoming.length && <p className="muted">Bir kaydı düzenleyerek hatırlatma zamanı veya son kullanma tarihi ekleyebilirsin.</p>}</div>
  </div></Modal>;
}
