import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from 'react';
import { Maximize2, Minimize2, X } from 'lucide-react';
import { SAT_COPY } from '../../domain/satCopy';
import type { SatLineReaderLines } from '../../domain/satReadingPreferences';
import { SAT_OVERLAY_Z } from '../primitives/satOverlayZ';
import { SatExamOverlayPortal } from '../zoom/SatExamZoomContext';

/** Persisted frame. Fractions are of the exam layer, so they survive resizes and zoom. */
export interface SatLineReaderFrame {
  /** Panel top as a fraction of the layer height; undefined = place over the first passage line. */
  position?: number | undefined;
  /** Collapsed panel left edge as a fraction of the layer width. */
  x?: number | undefined;
  lines?: SatLineReaderLines | undefined;
  expanded?: boolean | undefined;
}

// Bluebook geometry (logical px, measured from the reference at 100% zoom).
const HEADER = 40;
const FOOTER = 30;
const WINDOW_INSET = 16;
const CARET_ZONE = 40;
const MIN_WIDTH = 320;
const MAX_LINES = 3;
const TAP_SLOP = 6;
const HINT_MS = 4000;
const SIDE_STEP = 24;

/** Where focus lands when the reader closes: its top-bar toggle, else More. */
export const SAT_LINE_READER_TRIGGER = '[data-sat-focus="topbar-line-reader"], [data-sat-focus="topbar-more"]';

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), Math.max(min, max));
// iOS-style edge resistance: past the bound the panel follows at a third of the finger.
const rubberBand = (value: number, min: number, max: number) =>
  value < min ? min + (value - min) / 3 : value > max ? max + (value - max) / 3 : value;

/** Passage line height in logical px; the passage drives the window so it always frames whole lines. */
function measureLineHeight(): number {
  const prose = document.querySelector<HTMLElement>('[data-sat-passage-scroll] > div')
    ?? document.querySelector<HTMLElement>('[data-student-exam-scroll-owner]');
  if (!prose) return 24;
  const style = getComputedStyle(prose);
  const lineHeight = parseFloat(style.lineHeight);
  if (Number.isFinite(lineHeight) && lineHeight > 0) return lineHeight;
  const fontSize = parseFloat(style.fontSize);
  return Number.isFinite(fontSize) && fontSize > 0 ? fontSize * 1.45 : 24;
}

/** Viewport rect of the text line under a point, or null when no text is there. */
function lineRectAt(x: number, y: number): DOMRect | null {
  const doc = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  let range: Range | null = null;
  if (doc.caretPositionFromPoint) {
    const caret = doc.caretPositionFromPoint(x, y);
    if (caret) { range = document.createRange(); range.setStart(caret.offsetNode, caret.offset); }
  } else if (doc.caretRangeFromPoint) {
    range = doc.caretRangeFromPoint(x, y);
  }
  if (!range || range.startContainer.nodeType !== Node.TEXT_NODE) return null;
  const rect = range.getClientRects()[0] ?? range.getBoundingClientRect();
  return rect && rect.height > 0 ? rect : null;
}

type Gesture =
  | { kind: 'pending' | 'move'; id: number; startX: number; startY: number; originX: number; originY: number; target: 'grip' | 'above' | 'below' | 'chrome' }
  | { kind: 'lines'; id: number; startY: number; origin: SatLineReaderLines; moved: boolean };

/**
 * Bluebook Line Reader: a floating dark frame with a clear window over 1–3
 * lines. Six-dot grip and dark frame move it (snapping to the text line on
 * release), the caret below the window shows more or fewer lines, expand
 * stretches it across the screen. Closing destroys only the overlay; answers,
 * scroll and highlights are untouched. The window passes pointer input
 * through, so text stays selectable and answers tappable beneath it.
 */
export function SatLineReader({ frame, onFrameChange, onDisable }: {
  frame: SatLineReaderFrame;
  onFrameChange: (frame: SatLineReaderFrame) => void;
  onDisable: () => void;
}) {
  // State, not a ref: the portal root can arrive after first render, which
  // re-mounts the layer as a new node that must be measured afresh.
  const [layerNode, setLayerNode] = useState<HTMLDivElement | null>(null);
  const gripRef = useRef<HTMLButtonElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const caretDragged = useRef(false);
  // Latest dragged position; pointerup can land before React renders the last move.
  const livePos = useRef<{ x: number; y: number } | null>(null);
  const ids = useId();
  const [layer, setLayer] = useState({ width: 0, height: 0, scale: 1 });
  const [lineHeight, setLineHeight] = useState(24);
  // Placement before anything is stored: window over the passage's first line.
  const [fallback, setFallback] = useState<{ x: number; y: number } | null>(null);
  // Only while a finger is down; otherwise the stored fractions place the panel,
  // so it follows rotation and window resizes.
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null);
  const dragging = drag !== null;
  const [hint, setHint] = useState(true);
  const [coarse, setCoarse] = useState(false);
  const lines = frame.lines ?? 1;
  const expanded = frame.expanded ?? false;

  const bodyHeight = (MAX_LINES + 2) * lineHeight + CARET_ZONE;
  const panelHeight = HEADER + bodyHeight + FOOTER;
  const width = expanded ? layer.width : clamp(layer.width / 2, Math.min(MIN_WIDTH, layer.width), layer.width);
  const maxX = Math.max(0, layer.width - width);
  const maxY = Math.max(0, layer.height - panelHeight);
  const placed = drag ?? {
    x: frame.x !== undefined ? frame.x * layer.width : fallback?.x ?? 0,
    y: frame.position !== undefined ? frame.position * layer.height : fallback?.y ?? 0,
  };
  const x = expanded ? 0 : drag ? drag.x : clamp(placed.x, 0, maxX);
  const y = drag ? drag.y : clamp(placed.y, 0, maxY);
  const windowTop = HEADER + 2 * lineHeight;

  // Track the layer in logical px. scale converts finger deltas (viewport px)
  // into the zoomed plane the panel lives in.
  useLayoutEffect(() => {
    const node = layerNode;
    if (!node) return;
    const measure = () => {
      const rect = node.getBoundingClientRect();
      const width = node.offsetWidth;
      setLayer({ width, height: node.offsetHeight, scale: width > 0 && rect.width > 0 ? rect.width / width : 1 });
      setLineHeight(measureLineHeight());
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [layerNode]);

  useLayoutEffect(() => {
    if (!layer.width || !layer.height) return;
    const first = firstPassageLineTop(layerNode, layer.scale);
    setFallback({
      x: passageLeft(layerNode, layer.scale),
      y: first !== null ? first - windowTop : layer.height * 0.15,
    });
  }, [layer.width, layer.height, layer.scale, layerNode, windowTop]);

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    setCoarse(window.matchMedia('(pointer: coarse)').matches);
  }, []);

  useEffect(() => {
    if (!hint) return;
    const timer = window.setTimeout(() => setHint(false), HINT_MS);
    return () => window.clearTimeout(timer);
  }, [hint]);

  const close = useCallback(() => {
    onDisable();
    document.querySelector<HTMLElement>(SAT_LINE_READER_TRIGGER)?.focus();
  }, [onDisable]);

  // Escape is arbitrated by the shell (route modals own it when open; the
  // interaction machine orders surface > selection > line reader). This local
  // listener is a fallback for preview/debug mounts without shell arbitration.
  // Focus returns to the trigger that opened it.
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      close();
    };
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, [close]);

  const commit = useCallback((next: { x: number; y: number }, patch: SatLineReaderFrame = {}) => {
    setDrag(null);
    // Expanded pins x to 0 on screen; the stored x is kept so collapse restores it.
    onFrameChange({
      ...frame,
      ...(layer.height > 0 ? { position: clamp(next.y, 0, maxY) / layer.height } : {}),
      ...(layer.width > 0 && !expanded ? { x: clamp(next.x, 0, maxX) / layer.width } : {}),
      ...patch,
    });
  }, [expanded, frame, layer.height, layer.width, maxX, maxY, onFrameChange]);

  /** Align the window's first line with the text line beneath it. */
  const snapped = (next: { x: number; y: number }) => {
    if (!layerNode) return next;
    const rect = layerNode.getBoundingClientRect();
    const probeY = rect.top + (next.y + windowTop + lineHeight / 2) * layer.scale;
    const probeX = rect.left + (x + WINDOW_INSET * 3) * layer.scale;
    const line = lineRectAt(probeX, probeY);
    if (!line) return next;
    const delta = ((line.top + line.height / 2) - probeY) / layer.scale;
    return Math.abs(delta) <= lineHeight ? { x: next.x, y: next.y + delta } : next;
  };

  const step = (count: number) => commit({ x, y: y + count * lineHeight });

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const element = event.target as HTMLElement;
    const region = element.closest<HTMLElement>('[data-sat-line-reader-region]')?.dataset['satLineReaderRegion'];
    if (!region || region === 'button') return;
    livePos.current = null;
    gesture.current = {
      kind: 'pending', id: event.pointerId, startX: event.clientX, startY: event.clientY,
      originX: x, originY: y, target: region as 'grip' | 'above' | 'below' | 'chrome',
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const current = gesture.current;
    if (!current || current.kind === 'lines' || current.id !== event.pointerId) return;
    const dx = (event.clientX - current.startX) / layer.scale;
    const dy = (event.clientY - current.startY) / layer.scale;
    if (current.kind === 'pending') {
      if (Math.hypot(dx, dy) * layer.scale < TAP_SLOP) return;
      gesture.current = { ...current, kind: 'move' };
      setHint(false);
    }
    livePos.current = {
      x: expanded ? 0 : rubberBand(current.originX + dx, 0, maxX),
      y: rubberBand(current.originY + dy, 0, maxY),
    };
    setDrag(livePos.current);
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const current = gesture.current;
    if (!current || current.kind === 'lines' || current.id !== event.pointerId) return;
    gesture.current = null;
    releaseCapture(event);
    if (current.kind === 'move') {
      const last = livePos.current ?? { x, y };
      const settled = { x: expanded ? x : clamp(last.x, 0, maxX), y: clamp(last.y, 0, maxY) };
      commit(snapped(settled));
      return;
    }
    // A tap: the single-pointer alternative to dragging (WCAG 2.5.7).
    if (current.target === 'above') step(-1);
    else if (current.target === 'below') step(1);
    else if (current.target === 'grip') { gripRef.current?.focus(); setHint(true); }
  };

  const onPointerCancel = () => {
    gesture.current = null;
    setDrag(null);
  };

  const setLines = (next: number) => {
    const value = clamp(Math.round(next), 1, MAX_LINES) as SatLineReaderLines;
    if (value !== lines) commit({ x, y }, { lines: value });
  };

  const toggleExpanded = () => commit({ x, y }, { expanded: !expanded });

  // The frame is opaque to scrolling: hand wheel input to the pane beneath.
  const forwardWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    const owner = document.elementsFromPoint(event.clientX, event.clientY)
      .find((element) => !event.currentTarget.contains(element))
      ?.closest<HTMLElement>('[data-student-exam-scroll-owner]');
    owner?.scrollBy({ top: event.deltaY, left: event.deltaX });
  };

  const growing = lines < MAX_LINES;
  const percent = layer.height > 0 ? Math.round((y / layer.height) * 100) : Math.round((frame.position ?? 0) * 100);
  const focusRing = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white';

  return <SatExamOverlayPortal>
    <div ref={setLayerNode} className="absolute inset-0 overflow-hidden" data-sat-line-reader
      style={{ zIndex: SAT_OVERLAY_Z.toolSheet, pointerEvents: 'none' }}>
      <div
        role="group"
        aria-label={SAT_COPY.lineReader.label}
        data-sat-line-reader-panel
        data-dragging={dragging || undefined}
        className={'absolute left-0 top-0 touch-none select-none overflow-hidden text-white transition-[transform,width,box-shadow] duration-[var(--sat-motion-state)] ease-[cubic-bezier(.2,.9,.3,1)] motion-reduce:transition-none data-[dragging]:transition-none data-[dragging]:shadow-[var(--sat-shadow-floating)] ' + (dragging ? 'cursor-grabbing' : 'cursor-grab')}
        style={{
          width: width || '50%',
          height: panelHeight,
          transform: `translate3d(${x}px, ${y}px, 0)`,
          pointerEvents: 'auto',
          visibility: layer.width ? undefined : 'hidden',
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onWheel={forwardWheel}
      >
        {/* Header: six-dot grip, expand, close. */}
        <div data-sat-line-reader-header data-sat-line-reader-region="chrome"
          className="absolute inset-x-0 top-0 flex items-center justify-center bg-[var(--sat-tool-chrome)]" style={{ height: HEADER }}>
          <button ref={gripRef} type="button" role="slider" data-sat-line-reader-region="grip"
            aria-label={SAT_COPY.lineReader.move}
            aria-describedby={`${ids}-move`}
            aria-orientation="vertical" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}
            aria-valuetext={`${percent} percent down the screen`}
            className={`sat-touch-target grid w-11 place-items-center rounded-[7px] ${focusRing} ${dragging ? 'cursor-grabbing' : 'cursor-grab'}`}
            onKeyDown={(event) => {
              const big = event.shiftKey ? 5 : 1;
              let next: { x: number; y: number } | null = null;
              if (event.key === 'ArrowUp') next = { x, y: y - lineHeight * big };
              else if (event.key === 'ArrowDown') next = { x, y: y + lineHeight * big };
              else if (event.key === 'PageUp') next = { x, y: y - lineHeight * 5 };
              else if (event.key === 'PageDown') next = { x, y: y + lineHeight * 5 };
              else if (event.key === 'ArrowLeft') next = { x: x - SIDE_STEP * big, y };
              else if (event.key === 'ArrowRight') next = { x: x + SIDE_STEP * big, y };
              else if (event.key === 'Home') next = { x, y: 0 };
              else if (event.key === 'End') next = { x, y: maxY };
              if (!next) return;
              event.preventDefault();
              setHint(false);
              commit(next);
            }}>
            <span aria-hidden="true" className="grid grid-cols-3 gap-x-[3.5px] gap-y-[5px] px-2 py-1.5">
              {Array.from({ length: 6 }, (_, index) => <span key={index} className="size-1 rounded-full bg-current" />)}
            </span>
          </button>
          <div className="absolute inset-y-0 right-1.5 flex items-center gap-0.5">
            <button type="button" data-sat-line-reader-region="button" onClick={toggleExpanded}
              aria-label={expanded ? SAT_COPY.lineReader.collapse : SAT_COPY.lineReader.expand} aria-pressed={expanded}
              className={`sat-touch-target grid w-11 cursor-default place-items-center rounded-[7px] hover:bg-[var(--sat-tool-hover)] ${focusRing}`}>
              {expanded ? <Minimize2 aria-hidden="true" size={18} strokeWidth={2} /> : <Maximize2 aria-hidden="true" size={18} strokeWidth={2} />}
            </button>
            <button type="button" data-sat-line-reader-region="button" onClick={close}
              aria-label={SAT_COPY.lineReader.close}
              className={`sat-touch-target grid w-11 cursor-default place-items-center rounded-[7px] hover:bg-[var(--sat-tool-hover)] ${focusRing}`}>
              <X aria-hidden="true" size={20} strokeWidth={2} />
            </button>
          </div>
        </div>

        {/* Body: dark mask with the clear window. Masks are drag + tap-to-step targets. */}
        <div data-sat-line-reader-region="above" data-sat-line-reader-mask="above"
          className="absolute inset-x-0 bg-[var(--sat-reader-mask)]"
          style={{ top: HEADER, height: windowTop - HEADER }} />
        <div data-sat-line-reader-window aria-hidden="true"
          className="pointer-events-none absolute transition-[height] duration-[var(--sat-motion-state)] ease-out motion-reduce:transition-none"
          style={{ top: windowTop, left: 0, right: 0, height: lines * lineHeight }}>
          {/* Side gutters stay masked; only the inset band reads clear. */}
          <div className="absolute inset-y-0 left-0 bg-[var(--sat-reader-mask)]" style={{ width: WINDOW_INSET }} />
          <div className="absolute inset-y-0 bg-[var(--sat-reader-window)]" style={{ left: WINDOW_INSET, right: WINDOW_INSET }} />
          <div className="absolute inset-y-0 right-0 bg-[var(--sat-reader-mask)]" style={{ width: WINDOW_INSET }} />
        </div>
        <div data-sat-line-reader-region="below" data-sat-line-reader-mask="below"
          className="absolute inset-x-0 bg-[var(--sat-reader-mask)] transition-[top] duration-[var(--sat-motion-state)] ease-out motion-reduce:transition-none"
          style={{ top: windowTop + lines * lineHeight, bottom: FOOTER }} />

        {/* Caret: tap steps 1→2→3 then back to 1; drag sets lines directly. */}
        <button type="button" data-sat-line-reader-region="button" data-sat-line-reader-lines
          aria-label={growing ? SAT_COPY.lineReader.moreLines : SAT_COPY.lineReader.fewerLines}
          aria-describedby={`${ids}-lines`}
          className={`sat-touch-target absolute left-1/2 grid w-11 -translate-x-1/2 -translate-y-1/2 cursor-ns-resize place-items-center ${focusRing} rounded-[7px]`}
          style={{ top: HEADER + bodyHeight - CARET_ZONE / 2 }}
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            gesture.current = { kind: 'lines', id: event.pointerId, startY: event.clientY, origin: lines, moved: false };
            event.currentTarget.setPointerCapture?.(event.pointerId);
          }}
          onPointerMove={(event) => {
            const current = gesture.current;
            if (current?.kind !== 'lines' || current.id !== event.pointerId) return;
            const dy = (event.clientY - current.startY) / layer.scale;
            if (!current.moved && Math.abs(dy) * layer.scale < TAP_SLOP) return;
            current.moved = true;
            setLines(current.origin + dy / lineHeight);
          }}
          onPointerUp={(event) => {
            const current = gesture.current;
            if (current?.kind !== 'lines') return;
            gesture.current = null;
            releaseCapture(event);
            // A drag already set the count; the click that follows must not step it again.
            caretDragged.current = current.moved;
          }}
          onClick={() => {
            if (caretDragged.current) { caretDragged.current = false; return; }
            setLines(growing ? lines + 1 : 1);
          }}
          onKeyDown={(event) => {
            if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
            event.preventDefault();
            setLines(lines + (event.key === 'ArrowDown' ? 1 : -1));
          }}>
          <span aria-hidden="true" className={`block size-0 border-x-[7px] border-x-transparent ${growing ? 'border-t-[7px] border-t-current' : 'border-b-[7px] border-b-current'}`} />
        </button>

        <div data-sat-line-reader-region="chrome" className="absolute inset-x-0 bottom-0 bg-[var(--sat-tool-chrome)]" style={{ height: FOOTER }} />

        {/* Hint hangs under the header: Bluebook's copy for keyboards, gestures for touch. */}
        {hint ? <p data-sat-line-reader-hint data-sat-line-reader-region="chrome"
          className="absolute inset-x-9 rounded-b-2xl bg-[var(--sat-tool-chrome)] px-3 pb-1 pt-0.5 text-center text-[12px] leading-4"
          style={{ top: HEADER }}>
          {coarse ? SAT_COPY.lineReader.hintTouch : SAT_COPY.lineReader.hintKeyboard}
        </p> : null}

        <span id={`${ids}-move`} hidden>{SAT_COPY.lineReader.moveDescription}</span>
        <span id={`${ids}-lines`} className="sr-only" role="status" aria-live="polite">{SAT_COPY.lineReader.linesVisible(lines, MAX_LINES)}</span>
      </div>
    </div>
  </SatExamOverlayPortal>;
}

function releaseCapture(event: ReactPointerEvent<HTMLElement>) {
  if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
}

/** Passage pane's left edge in layer px, so the reader opens over the passage. */
function passageLeft(layer: HTMLElement | null, scale: number): number {
  const passage = document.querySelector<HTMLElement>('[data-sat-passage-scroll]');
  if (!layer || !passage) return 0;
  return Math.max(0, (passage.getBoundingClientRect().left - layer.getBoundingClientRect().left) / scale);
}

/** Top of the passage's first text line in layer px, or null without a passage. */
function firstPassageLineTop(layer: HTMLElement | null, scale: number): number | null {
  const prose = document.querySelector<HTMLElement>('[data-sat-passage-scroll] > div');
  if (!layer || !prose) return null;
  const walker = document.createTreeWalker(prose, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => node.textContent?.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP,
  });
  const text = walker.nextNode();
  if (!text) return null;
  const range = document.createRange();
  range.selectNodeContents(text);
  const rect = range.getClientRects()[0];
  if (!rect) return null;
  return (rect.top - layer.getBoundingClientRect().top) / scale;
}
