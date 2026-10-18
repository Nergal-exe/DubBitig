import { useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { X } from '@phosphor-icons/react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog';
import { Button } from './ui/button';
import { cn } from '@/lib/utils';

let topLayer = 50;
const raise = () => ++topLayer;

/**
 * Modeless by default: the main window stays usable, several windows can be open together,
 * and each can be dragged by its title bar. Pass `modal` for confirmations that must block.
 */
export function AppWindow({ title, description, children, close, size = 'md', modal = false, className }: { title: ReactNode; description?: ReactNode; children: ReactNode; close: () => void; size?: 'sm' | 'md' | 'lg'; modal?: boolean; className?: string }) {
  const [layer, setLayer] = useState(raise);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; from: { x: number; y: number } } | null>(null);
  const start = (e: PointerEvent<HTMLDivElement>) => {
    if (modal || e.button !== 0 || (e.target as HTMLElement).closest('button,input,select,textarea,a')) return;
    drag.current = { x: e.clientX, y: e.clientY, from: offset }; e.currentTarget.setPointerCapture(e.pointerId);
  };
  const move = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current; if (!d) return;
    // Keep the title bar reachable inside the app window.
    const x = Math.max(-innerWidth / 2 + 80, Math.min(innerWidth / 2 - 80, d.from.x + e.clientX - d.x));
    const y = Math.max(-innerHeight / 2 + 40, Math.min(innerHeight / 2 - 40, d.from.y + e.clientY - d.y));
    setOffset({ x, y });
  };
  return <Dialog open modal={modal} onOpenChange={open => { if (!open) close(); }}>
    <DialogContent showCloseButton={false} {...(description ? {} : { 'aria-describedby': undefined })}
      onInteractOutside={e => { if (!modal) e.preventDefault(); }}
      onPointerDownCapture={() => { if (!modal && layer !== topLayer) setLayer(raise()); }}
      style={{ zIndex: modal ? 1000 : layer, translate: `calc(-50% + ${offset.x}px) calc(-50% + ${offset.y}px)` }}
      className={cn('archive-dialog app-window p-0 gap-0', size === 'lg' ? 'sm:max-w-3xl' : size === 'sm' ? 'sm:max-w-md' : 'sm:max-w-xl', !modal && 'modeless', className)}>
      <DialogHeader className="modal-head" onPointerDown={start} onPointerMove={move} onPointerUp={() => { drag.current = null; }} onDoubleClick={() => setOffset({ x: 0, y: 0 })}>
        <div className="min-w-0"><DialogTitle>{title}</DialogTitle>{description && <DialogDescription className="modal-sub">{description}</DialogDescription>}</div>
        <Button variant="ghost" size="icon" aria-label="Pencereyi kapat" onClick={close}><X size={20}/></Button>
      </DialogHeader>
      {children}
    </DialogContent>
  </Dialog>;
}
