import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";

const MIN = 340;
const MAX = 460;
const STORAGE_KEY = "sat-authoring-rail-width";

export function useRailWidth() {
  const [width, setWidth] = useState(() => {
    if (typeof window === "undefined") return 392;
    const stored = Number(window.localStorage.getItem(STORAGE_KEY));
    if (!Number.isFinite(stored)) return 392;
    return Math.min(MAX, Math.max(MIN, stored));
  });
  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, String(width));
  }, [width]);
  return { width, setWidth };
}

/**
 * Optional user resizing, clamped to the usable minimum. Keyboard operable
 * (Arrow keys) and exposed with slider semantics.
 */
export function RailResizer({ width, onWidthChange }: { width: number; onWidthChange: (value: number) => void }) {
  const [dragging, setDragging] = useState(false);
  const frame = useRef(0);

  const clamp = useCallback((value: number) => Math.min(MAX, Math.max(MIN, Math.round(value))), []);

  useEffect(() => {
    if (!dragging) return;
    const onMove = (event: PointerEvent) => {
      cancelAnimationFrame(frame.current);
      frame.current = requestAnimationFrame(() => onWidthChange(clamp(event.clientX)));
    };
    const onUp = () => setDragging(false);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      cancelAnimationFrame(frame.current);
    };
  }, [clamp, dragging, onWidthChange]);

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    let next = -1;
    if (event.key === "ArrowLeft") next = width - 16;
    else if (event.key === "ArrowRight") next = width + 16;
    else if (event.key === "Home") next = MIN;
    else if (event.key === "End") next = MAX;
    if (next < 0) return;
    event.preventDefault();
    onWidthChange(clamp(next));
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize question navigator"
      aria-valuenow={width}
      aria-valuemin={MIN}
      aria-valuemax={MAX}
      tabIndex={0}
      // Resize handle: separator role is the correct semantic for a divider
      // that supports keyboard adjustment.
      // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
      onPointerDown={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onKeyDown={onKeyDown}
      onDoubleClick={() => onWidthChange(392)}
      className="sat-spine__resizer"
    />
  );
}
