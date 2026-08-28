import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { GripHorizontal, X } from 'lucide-react';

interface Point { x: number; y: number }

export interface SatToolWindowProps {
  title: string;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}

const DESKTOP_WIDTH = 720;
const DESKTOP_HEIGHT = 620;
const EDGE_GAP = 16;
const COMPACT_TOOL_QUERY = '(max-width: 1099px), (pointer: coarse)';

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(value, max));
}

function defaultPosition(): Point {
  return {
    x: Math.max(EDGE_GAP, window.innerWidth - DESKTOP_WIDTH - 28),
    y: 84,
  };
}

export function SatToolWindow({ title, open, onClose, children }: SatToolWindowProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const dragCleanupRef = useRef<(() => void) | null>(null);
  const [compact, setCompact] = useState(() => window.matchMedia(COMPACT_TOOL_QUERY).matches);
  const [position, setPosition] = useState<Point>(() => defaultPosition());

  useEffect(() => {
    const media = window.matchMedia(COMPACT_TOOL_QUERY);
    const update = () => setCompact(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  const keepInViewport = useCallback((next: Point) => {
    const rect = panelRef.current?.getBoundingClientRect();
    const width = rect?.width ?? DESKTOP_WIDTH;
    const height = rect?.height ?? DESKTOP_HEIGHT;
    return {
      x: clamp(next.x, EDGE_GAP, Math.max(EDGE_GAP, window.innerWidth - width - EDGE_GAP)),
      y: clamp(next.y, EDGE_GAP, Math.max(EDGE_GAP, window.innerHeight - height - EDGE_GAP)),
    };
  }, []);

  useEffect(() => {
    if (!open || compact) return;
    const onResize = () => setPosition((current) => keepInViewport(current));
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [compact, keepInViewport, open]);

  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return () => { if (opener?.isConnected) opener.focus(); };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const focusCloseButton = window.requestAnimationFrame(() => {
      if (compact) panelRef.current?.querySelector<HTMLElement>('[data-sat-tool-close]')?.focus();
    });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) {
        event.preventDefault();
        onClose();
        return;
      }
      if (!compact || event.key !== 'Tab' || !panelRef.current) return;
      const focusable = [...panelRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )].filter((element) => element.getClientRects().length > 0 || element === document.activeElement);
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      window.cancelAnimationFrame(focusCloseButton);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [compact, onClose, open]);

  useEffect(() => () => dragCleanupRef.current?.(), []);

  const beginDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (compact || event.button !== 0) return;
    event.preventDefault();
    dragCleanupRef.current?.();
    const start = { x: event.clientX, y: event.clientY };
    const origin = position;
    const onMove = (moveEvent: PointerEvent) => {
      setPosition(keepInViewport({
        x: origin.x + moveEvent.clientX - start.x,
        y: origin.y + moveEvent.clientY - start.y,
      }));
    };
    const cleanup = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', cleanup);
      window.removeEventListener('pointercancel', cleanup);
      dragCleanupRef.current = null;
    };
    dragCleanupRef.current = cleanup;
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', cleanup, { once: true });
    window.addEventListener('pointercancel', cleanup, { once: true });
  };

  if (!open) return null;

  const panel = (
    <div
      ref={panelRef}
      role="dialog"
      aria-modal={compact ? true : undefined}
      aria-label={title}
      tabIndex={-1}
      className={compact
        ? 'fixed inset-x-0 bottom-0 top-14 z-[70] flex min-h-0 flex-col overflow-hidden rounded-t-[24px] border border-slate-200 bg-white shadow-2xl'
        : 'fixed z-[70] flex h-[min(620px,calc(100dvh-116px))] w-[min(720px,calc(100vw-32px))] min-h-[420px] flex-col overflow-hidden rounded-[20px] border border-slate-200 bg-white shadow-2xl'}
      style={compact ? undefined : { left: position.x, top: position.y }}
    >
      <div className="flex h-14 shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-4">
        <div
          onPointerDown={beginDrag}
          className={compact ? 'flex flex-1 items-center gap-2' : 'flex flex-1 cursor-grab touch-none items-center gap-2 active:cursor-grabbing'}
        >
          {!compact ? <GripHorizontal className="h-4 w-4 text-slate-400" aria-hidden="true" /> : null}
          <h2 className="text-sm font-semibold tracking-tight text-slate-950">{title}</h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="grid h-9 w-9 place-items-center rounded-full text-slate-500 transition hover:bg-slate-100 hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
          aria-label={`Close ${title}`}
          data-sat-tool-close
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );

  return compact ? (
    <div className="fixed inset-0 z-[69] bg-slate-950/20 backdrop-blur-[2px]">{panel}</div>
  ) : panel;
}
