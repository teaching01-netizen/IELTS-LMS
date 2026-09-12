import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Maximize2, Minus, Plus, RotateCcw, X } from "lucide-react";
import { SAT_COPY } from "../../domain/satCopy";
import { satOverlayZClass } from "../primitives/satOverlayZ";

export interface SatImageViewerProps {
  src: string;
  alt: string;
  open: boolean;
  onClose: () => void;
  returnFocusSelector?: string | undefined;
}

const MIN_ZOOM = 1;
const MAX_ZOOM = 4;
const ZOOM_STEP = 0.5;

/**
 * Bluebook image/graph lightbox (Phase 10). Opens from an Enlarge affordance
 * on question visuals: zoom 100-400% (buttons + keyboard), drag to pan when
 * zoomed, Reset restores fit, Escape/Close returns focus to the opener.
 * Non-modal by design (aria-modal false): exam chrome stays reachable.
 * Timer, answers, and persistence are untouched — pure presentation.
 * Layer imageViewer (89): above Help/Shortcuts (88), below break veil.
 */
function SatImageViewerImpl(props: SatImageViewerProps) {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ sx: number; sy: number; px: number; py: number } | null>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const titleId = useId();

  useEffect(() => {
    if (props.open) { setZoom(1); setPan({ x: 0, y: 0 }); }
  }, [props.open, props.src]);

  // Focus-back: explicit selector wins; otherwise the opener captured at
  // open time (usually the Enlarge button that launched the viewer).
  const focusBack = useCallback(() => {
    if (props.returnFocusSelector) {
      const el = document.querySelector<HTMLElement>(props.returnFocusSelector);
      if (el) { el.focus(); return; }
    }
    if (openerRef.current?.isConnected) openerRef.current.focus();
  }, [props.returnFocusSelector]);

  useEffect(() => {
    if (!props.open) return;
    openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    toolbarRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.key === "Escape") {
        event.preventDefault();
        props.onClose();
        focusBack();
        return;
      }
      if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        setZoom((z) => Math.min(MAX_ZOOM, Math.round((z + ZOOM_STEP) * 100) / 100));
      } else if (event.key === "-" || event.key === "_") {
        event.preventDefault();
        setZoom((z) => Math.max(MIN_ZOOM, Math.round((z - ZOOM_STEP) * 100) / 100));
      } else if (event.key === "0") {
        event.preventDefault();
        setZoom(1); setPan({ x: 0, y: 0 });
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- onClose identity churns; open-state is the stable seam.
  }, [props.open, focusBack]);

  if (!props.open) return null;
  const zoomed = zoom > 1;
  const percent = Math.round(zoom * 100) + "%";

  return (
    <div className={"sat-ui fixed inset-0 flex items-center justify-center bg-black/60 p-4 sm:p-8 " + satOverlayZClass("imageViewer")} data-testid="sat-image-viewer">
      <div
        role="dialog"
        aria-modal="false"
        aria-labelledby={titleId}
        className="flex max-h-full w-full max-w-[880px] flex-col overflow-hidden rounded-[10px] border border-[var(--sat-divider)] bg-[var(--sat-surface)] text-[var(--sat-text)] shadow-[var(--sat-shadow-modal)]"
      >
        <h2 id={titleId} className="sr-only">{SAT_COPY.imageViewer.title}</h2>
        <div
          ref={toolbarRef}
          role="toolbar"
          aria-label="Image viewer controls"
          tabIndex={-1}
          className="flex min-h-12 shrink-0 items-center gap-1 border-b border-[var(--sat-divider-soft)] px-2 focus-visible:outline-none"
        >
          <span className="sat-tabular min-w-[52px] px-2 text-[13px] font-semibold" aria-live="polite">{percent}</span>
          <button type="button" onClick={() => setZoom((z) => Math.min(MAX_ZOOM, Math.round((z + ZOOM_STEP) * 100) / 100))} aria-label={SAT_COPY.imageViewer.zoomIn} className="sat-touch-target grid w-11 place-items-center rounded hover:bg-[var(--sat-surface-hover)]">
            <Plus className="h-5 w-5" aria-hidden="true" />
          </button>
          <button type="button" onClick={() => setZoom((z) => Math.max(MIN_ZOOM, Math.round((z - ZOOM_STEP) * 100) / 100))} aria-label={SAT_COPY.imageViewer.zoomOut} disabled={!zoomed} className="sat-touch-target grid w-11 place-items-center rounded hover:bg-[var(--sat-surface-hover)] disabled:opacity-40">
            <Minus className="h-5 w-5" aria-hidden="true" />
          </button>
          <button type="button" onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }} aria-label={SAT_COPY.imageViewer.resetZoom} disabled={!zoomed && pan.x === 0 && pan.y === 0} className="sat-touch-target grid w-11 place-items-center rounded hover:bg-[var(--sat-surface-hover)] disabled:opacity-40">
            <RotateCcw className="h-5 w-5" aria-hidden="true" />
          </button>
          <span className="min-w-0 flex-1" />
          <button type="button" onClick={() => { props.onClose(); focusBack(); }} aria-label={SAT_COPY.imageViewer.close} data-sat-image-viewer-close className="sat-touch-target grid w-11 place-items-center rounded hover:bg-[var(--sat-surface-hover)]">
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
        <div
          className={zoomed ? "max-h-[70dvh] min-h-0 flex-1 cursor-grab overflow-auto touch-none active:cursor-grabbing" : "max-h-[70dvh] min-h-0 flex-1 overflow-auto"}
          onPointerDown={(event) => {
            if (!zoomed) return;
            (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
            dragRef.current = { sx: event.clientX, sy: event.clientY, px: pan.x, py: pan.y };
          }}
          onPointerMove={(event) => {
            if (!dragRef.current) return;
            setPan({ x: dragRef.current.px + (event.clientX - dragRef.current.sx), y: dragRef.current.py + (event.clientY - dragRef.current.sy) });
          }}
          onPointerUp={() => { dragRef.current = null; }}
          onPointerCancel={() => { dragRef.current = null; }}
        >
          <img
            src={props.src}
            alt={props.alt}
            draggable={false}
            className="mx-auto max-w-none select-none"
            style={{ width: (zoom * 100) + "%", transform: "translate(" + pan.x + "px, " + pan.y + "px)" }}
          />
        </div>
      </div>
    </div>
  );
}

export interface SatEnlargeButtonProps {
  label: string;
  disabled?: boolean | undefined;
  enlargeId?: string | undefined;
  onOpen: () => void;
}

function EnlargeButton(props: SatEnlargeButtonProps) {
  return (
    <button
      type="button"
      id={props.enlargeId}
      onClick={props.onOpen}
      disabled={props.disabled}
      aria-label={"Enlarge image: " + props.label}
      title={SAT_COPY.imageViewer.enlarge}
      className="sat-touch-target sat-pressable inline-flex items-center gap-1.5 rounded-full border border-[var(--sat-divider)] bg-[var(--sat-surface)] px-3 text-[12px] font-semibold text-[var(--sat-text-secondary)] hover:text-[var(--sat-text)] disabled:cursor-not-allowed disabled:opacity-50"
    >
      <Maximize2 className="h-4 w-4" aria-hidden="true" />
      {SAT_COPY.imageViewer.enlarge}
    </button>
  );
}

// Compound component: <SatImageViewer/> + <SatImageViewer.EnlargeButton/>.
export type SatImageViewerComponent = ((props: SatImageViewerProps) => React.JSX.Element | null) & {
  EnlargeButton: typeof EnlargeButton;
};
export const SatImageViewer: SatImageViewerComponent = Object.assign(SatImageViewerImpl, {
  EnlargeButton,
});
