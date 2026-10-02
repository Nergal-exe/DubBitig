import { useRef } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import hljs from 'highlight.js/lib/common';
import powershell from 'highlight.js/lib/languages/powershell';
import { Tabs, TabsList, TabsTrigger, TabsContent } from './ui/tabs';
import { Button } from './ui/button';
import { Textarea } from './ui/textarea';
import { getAPI } from '../api';
import type { Draft } from '../shared/model';

hljs.registerLanguage('powershell', powershell);
export const languages = { auto: 'Otomatik', plaintext: 'Düz metin', powershell: 'PowerShell', bash: 'Bash / Shell', dos: 'CMD / Batch', javascript: 'JavaScript', typescript: 'TypeScript', python: 'Python', json: 'JSON', sql: 'SQL', yaml: 'YAML', css: 'CSS', xml: 'HTML / XML', csharp: 'C#' };
export function CodeContent({ content, language = 'auto' }: { content: string; language?: Draft['language'] }) {
  // Highlight.js escapes source text; no user HTML is interpreted here.
  const html = language !== 'auto' && hljs.getLanguage(language) ? hljs.highlight(content, { language }).value : hljs.highlightAuto(content, ['powershell','bash','javascript','python','sql','json']).value;
  return <pre className="code-content hljs"><code dangerouslySetInnerHTML={{ __html: html }}/></pre>;
}
export function RichContent({ draft }: { draft: Pick<Draft, 'kind' | 'content' | 'language'> }) {
  if (draft.kind === 'command') return <CodeContent content={draft.content} language={draft.language}/>;
  return <div className="markdown-content"><Markdown remarkPlugins={[remarkGfm]} rehypePlugins={[[rehypeHighlight, { languages: { powershell }, detect: false }]]} components={{
    a: ({ children, href }) => <a href={href} onClick={e => { e.preventDefault(); if (href && /^https?:\/\//i.test(href)) void getAPI().openUrl(href).catch(() => {}); }}>{children}</a>,
    img: ({ alt }) => <span className="muted">[Görsel: {alt || 'görsel'} — fotoğraf olarak ekleyebilirsin]</span>,
  }}>{draft.content}</Markdown></div>;
}
export function ContentEditor({ draft, update }: { draft: Draft; update: <K extends keyof Draft>(key: K, value: Draft[K]) => void }) {
  const input = useRef<HTMLTextAreaElement>(null);
  const wrap = (before: string, after = '') => { const el = input.current; const start = el?.selectionStart ?? draft.content.length; const end = el?.selectionEnd ?? start; update('content', draft.content.slice(0,start) + before + (draft.content.slice(start,end) || 'metin') + after + draft.content.slice(end)); requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(start + before.length, end + before.length); }); };
  const label = draft.kind === 'command' ? 'Komut *' : draft.kind === 'program' ? 'Kullanım notları' : 'İçerik';
  return <section className="rich-editor">
    <div className="flex items-center justify-between gap-4"><strong className="text-sm">{label}</strong>{draft.kind === 'command' ? <label className="language-picker">Dil<select aria-label="Kod dili" value={draft.language ?? 'auto'} onChange={e => update('language', e.target.value as Draft['language'])}>{Object.entries(languages).map(([value,name]) => <option key={value} value={value}>{name}</option>)}</select></label> : <span className="text-xs text-muted-foreground">Markdown desteklenir</span>}</div>
    <Tabs defaultValue="edit" className="mt-3 gap-3"><TabsList><TabsTrigger value="edit">Düzenle</TabsTrigger><TabsTrigger value="preview">Önizleme</TabsTrigger></TabsList>
      <TabsContent value="edit">{draft.kind !== 'command' && <div className="format-toolbar" aria-label="Metin biçimlendirme"><Button type="button" variant="ghost" size="sm" onClick={() => wrap('**','**')}>Kalın</Button><Button type="button" variant="ghost" size="sm" onClick={() => wrap('*','*')}>İtalik</Button><Button type="button" variant="ghost" size="sm" onClick={() => wrap('\n## ')}>Başlık</Button><Button type="button" variant="ghost" size="sm" onClick={() => wrap('\n- ')}>Liste</Button><Button type="button" variant="ghost" size="sm" onClick={() => wrap('\n```powershell\n','\n```\n')}>Kod</Button><Button type="button" variant="ghost" size="sm" onClick={() => wrap('[','](https://example.com)')}>Bağlantı</Button></div>}
        <Textarea ref={input} aria-label={label} className="code-input min-h-40 resize-y" rows={7} required={draft.kind === 'command'} maxLength={200000} value={draft.content} onChange={e => update('content', e.target.value)} placeholder={draft.kind === 'command' ? 'Komutunu buraya yapıştır…' : '# Başlık\n\nNotlarını Markdown ile biçimlendir…'}/>
      </TabsContent><TabsContent value="preview" className="editor-rendered"><RichContent draft={draft}/>{!draft.content && <p className="muted">Yazdığın içerik burada görünecek.</p>}</TabsContent>
    </Tabs><p className="hint">{draft.kind === 'command' ? 'Komutlar saklanır ve tek tıkla kopyalanır; çalıştırılmaz.' : 'Başlıklar, listeler, tablolar, bağlantılar ve kod blokları desteklenir.'}</p>
  </section>;
}
