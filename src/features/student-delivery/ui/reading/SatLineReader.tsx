import { useEffect, useRef, useState } from 'react';
import { SAT_COPY } from '../../domain/satCopy';

const clamp = (value: number) => Math.max(0.05, Math.min(0.95, value));

/**
 * Bluebook Line Reader (Phase 4): dark reading mask with a single readable
 * band. Header controls: move handle (drag + arrow keys), reset, close.
 * Launched only from More → Line Reader. Closing destroys only the overlay —
 * answers, scroll, and highlights are untouched. Vertical-only v1: full-width
 * band, fixed height; no horizontal geometry (documented cut).
 */
export function SatLineReader({ position, onPositionChange, onDisable, onReset }: {
  position: number;
  onPositionChange: (position: number) => void;
  onDisable: () => void;
  onReset?: (() => void) | undefined;
}) {
  const root = useRef<HTMLDivElement>(null);
  const drag = useRef<{ y: number; position: number } | null>(null);
  const [current, setCurrent] = useState(position);
  useEffect(() => { setCurrent(position); }, [position]);
  // Escape is arbitrated by the shell (route modals own it when open; the
  // interaction machine orders surface > selection > line reader). This local
  // listener is a fallback for preview/debug mounts without shell arbitration.
  // Focus returns to the More trigger — Line Reader launches only from More.
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      onDisable();
      document.querySelector<HTMLElement>('[data-sat-focus="topbar-more"]')?.focus();
    };
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, [onDisable]);
  const reset = () => {
    setCurrent(0.5);
    onPositionChange(0.5);
    onReset?.();
  };
  const moveBy = (delta: number) => {
    const next = clamp(current + delta);
    setCurrent(next);
    onPositionChange(next);
  };
  return <div ref={root} className="pointer-events-none absolute inset-0 z-20 overflow-hidden" data-sat-line-reader>
    {/* Control bar: move hint, reset, close. Pure presentation — closing
        destroys only this overlay. */}
    <div data-sat-line-reader-header className="pointer-events-auto absolute inset-x-0 top-0 flex items-center gap-2 border-b border-[var(--sat-divider)] bg-[var(--sat-reader-mask)] px-3 py-1 text-[13px] text-white">
      <span aria-hidden="true" className="select-none text-[15px] leading-none">⠿</span>
      <p className="min-w-0 flex-1 truncate">Drag the handle or focus it and use ↑ ↓ keys.</p>
      <button type="button" onClick={reset} aria-label="Reset line reader position"
        className="sat-touch-target grid w-11 place-items-center rounded text-[15px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--sat-focus)]"
      ><span aria-hidden="true">↗</span></button>
      <button type="button" onClick={onDisable} aria-label={SAT_COPY.more.lineReader + ", close"}
        className="sat-touch-target grid w-11 place-items-center rounded text-[17px] leading-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--sat-focus)]"
      ><span aria-hidden="true">×</span></button>
    </div>
    <div data-sat-line-reader-window className="absolute inset-x-0 -translate-y-1/2 border-y border-[var(--sat-focus)] bg-white"
      style={{ top: `${current * 100}%`, height: '3.5em', boxShadow: '0 0 0 100vmax var(--sat-reader-mask)' }}>
      <button type="button" role="slider" aria-label="Reading line position" aria-orientation="vertical"
        aria-valuemin={5} aria-valuemax={95} aria-valuenow={Math.round(current * 100)}
        aria-valuetext={`${Math.round(current * 100)} percent down the reading viewport`}
        className="pointer-events-auto absolute right-0 top-1/2 grid h-11 w-11 -translate-y-1/2 touch-none place-items-center rounded-l border bg-[var(--sat-surface)] text-[var(--sat-text)] shadow focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--sat-focus)]"
        onPointerDown={(event) => {
          event.preventDefault();
          drag.current = { y: event.clientY, position: current };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (!drag.current || !root.current) return;
          const height = root.current.getBoundingClientRect().height;
          if (height > 0) setCurrent(clamp(drag.current.position + (event.clientY - drag.current.y) / height));
        }}
        onPointerUp={(event) => {
          if (!drag.current) return;
          drag.current = null;
          event.currentTarget.releasePointerCapture(event.pointerId);
          onPositionChange(current);
        }}
        onPointerCancel={() => { drag.current = null; setCurrent(position); }}
        onKeyDown={(event) => {
          const delta = event.key === 'ArrowDown' ? 0.03 : event.key === 'ArrowUp' ? -0.03 : event.key === 'PageDown' ? 0.15 : event.key === 'PageUp' ? -0.15 : 0;
          if (!delta && event.key !== 'Home' && event.key !== 'End') return;
          event.preventDefault();
          const next = event.key === 'Home' ? 0.05 : event.key === 'End' ? 0.95 : clamp(current + delta);
          setCurrent(next); onPositionChange(next);
        }}><span aria-hidden="true">⠿</span></button>
    </div>
    {/* Keyboard nudge pad for touch/switch users: same moveBy action as drag. */}
    <div data-sat-line-reader-nudge className="pointer-events-auto absolute bottom-2 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full border border-[var(--sat-divider)] bg-white px-2 py-1 text-[var(--sat-text)] shadow">
      <button type="button" onClick={() => moveBy(-0.03)} aria-label="Move line reader up"
        className="sat-touch-target grid w-11 place-items-center rounded-full hover:bg-[var(--sat-surface-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--sat-focus)]"
      ><span aria-hidden="true">↑</span></button>
      <button type="button" onClick={() => moveBy(0.03)} aria-label="Move line reader down"
        className="sat-touch-target grid w-11 place-items-center rounded-full hover:bg-[var(--sat-surface-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--sat-focus)]"
      ><span aria-hidden="true">↓</span></button>
    </div>
  </div>;
}
