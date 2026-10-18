import { useId, useState, type InputHTMLAttributes, type KeyboardEvent, type ReactNode, type Ref } from 'react';
import { cn } from '@/lib/utils';

export interface Suggestion { key: string; label: string; group?: string; hint?: string; icon?: ReactNode }

/** Accessible combobox: arrow keys move, Enter picks, Escape closes the list before anything else. */
export function Typeahead({ value, onValueChange, items, onPick, inputRef, wrapperClassName, leading, trailing, onKeyDown, ...input }: Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> & { value: string; onValueChange: (value: string) => void; items: Suggestion[]; onPick: (item: Suggestion) => void; inputRef?: Ref<HTMLInputElement>; wrapperClassName?: string; leading?: ReactNode; trailing?: ReactNode }) {
  const id = useId(); const [open, setOpen] = useState(false); const [active, setActive] = useState(-1);
  const shown = open && items.length > 0;
  const pick = (item: Suggestion) => { onPick(item); setOpen(false); setActive(-1); };
  const keys = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!items.length) return;
      e.preventDefault(); setOpen(true);
      setActive(i => e.key === 'ArrowDown' ? (i + 1) % items.length : (i <= 0 ? items.length : i) - 1);
      return;
    }
    if (e.key === 'Enter' && shown && active >= 0 && items[active]) { e.preventDefault(); pick(items[active]); return; }
    if (e.key === 'Escape' && shown) { e.preventDefault(); e.stopPropagation(); setOpen(false); setActive(-1); return; }
    if (e.key === 'Tab') setOpen(false);
    onKeyDown?.(e);
  };
  let lastGroup: string | undefined;
  return <div className={cn('typeahead', wrapperClassName)}>
    {leading}
    <input {...input} ref={inputRef} value={value} role="combobox" aria-autocomplete="list" aria-expanded={shown} aria-controls={id} aria-activedescendant={shown && active >= 0 ? `${id}-${active}` : undefined} autoComplete="off"
      onChange={e => { onValueChange(e.target.value); setOpen(true); setActive(-1); }} onFocus={e => { setOpen(true); input.onFocus?.(e); }} onBlur={e => { setOpen(false); setActive(-1); input.onBlur?.(e); }} onKeyDown={keys}/>
    {trailing}
    {shown && <ul id={id} role="listbox" className="typeahead-list" onMouseDown={e => e.preventDefault()}>
      {items.map((item, index) => {
        const heading = item.group && item.group !== lastGroup ? item.group : undefined; lastGroup = item.group;
        return <li key={item.key} role="presentation">{heading && <span className="typeahead-group">{heading}</span>}<div id={`${id}-${index}`} role="option" aria-selected={index === active} className={cn('typeahead-option', index === active && 'active')} onMouseEnter={() => setActive(index)} onClick={() => pick(item)}>{item.icon}<span>{item.label}</span>{item.hint && <small>{item.hint}</small>}</div></li>;
      })}
    </ul>}
  </div>;
}

// Case- and accent-insensitive Turkish matching shared by every suggestion list.
export const fold = (v: string) => v.toLocaleLowerCase('tr-TR').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ı/g, 'i');
export function matches(values: string[], query: string, limit = 8) {
  const q = fold(query.trim()); if (!q) return values.slice(0, limit);
  const starts = values.filter(v => fold(v).startsWith(q)), contains = values.filter(v => !fold(v).startsWith(q) && fold(v).includes(q));
  return [...starts, ...contains].slice(0, limit);
}
