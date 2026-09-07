import { useEffect, useRef, useState } from 'react';

const clamp = (value: number) => Math.max(0.05, Math.min(0.95, value));

export function SatLineReader({ position, onPositionChange, onDisable }: {
  position: number;
  onPositionChange: (position: number) => void;
  onDisable: () => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const drag = useRef<{ y: number; position: number } | null>(null);
  const [current, setCurrent] = useState(position);
  useEffect(() => { setCurrent(position); }, [position]);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      onDisable();
      document.querySelector<HTMLButtonElement>('button[aria-label="Line Reader"]')?.focus();
    };
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, [onDisable]);
  return <div ref={root} className="pointer-events-none absolute inset-0 z-20 overflow-hidden" data-sat-line-reader>
    <div className="absolute inset-x-0 -translate-y-1/2 border-y border-[var(--sat-focus)]"
      style={{ top: `${current * 100}%`, height: '3.5em', boxShadow: '0 0 0 100vmax var(--sat-reader-dim, rgba(0,0,0,.32))' }}>
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
        }}><span aria-hidden="true">↕</span></button>
    </div>
  </div>;
}
