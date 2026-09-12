import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { GripVertical, X } from "lucide-react";
import { satOverlayZClass } from "../primitives/satOverlayZ";
import { useSatMediaQuery } from "../useSatMediaQuery";
import {
  SAT_FLOATING_TOOL_CHROME,
  SAT_TOOL_GEOMETRY_MIN_H,
  SAT_TOOL_GEOMETRY_MIN_W,
  clampSatToolGeometry,
  loadSatToolGeometry,
  saveSatToolGeometry,
  type SatToolGeometry,
} from "../../infrastructure/satToolGeometryStore";

export interface SatFloatingToolProps {
  title: string;
  open: boolean;
  geometryKey: string | null;
  defaultGeometry: SatToolGeometry;
  resizable?: boolean | undefined;
  disabled?: boolean | undefined;
  /**
   * Keep one mounted tree while closed (hidden + inert + aria-hidden) so
   * open only flips visibility — never remounts. Required for the Desmos
   * prewarm contract: the same ready iframe nodes revealed on open.
   * Default unmounts on close (Reference behavior).
   */
  keepAlive?: boolean | undefined;
  onClose: () => void;
  children: ReactNode;
}

const DEFAULT_W = 420;
const DEFAULT_H = 520;

/**
 * Shared floating-tool shell (Phase 9): draggable by header (mouse + arrow
 * keys when the grip handle is focused), Calculator resizable from the
 * corner grip. Positions persist per module-attempt for the session.
 *
 * Non-modal on every breakpoint: open tools never trap focus, so Calculator
 * and Reference coexist with the exam and with each other. Escape closes
 * the tool itself. Focus reports to the opener on close. Compact viewports
 * keep the bottom-sheet (no drag/resize by design). Blocked shells render
 * inert + dimmed with positions kept; drag/resize/keys all gate on disabled.
 */
export function SatFloatingTool(props: SatFloatingToolProps) {
  const compact = useSatMediaQuery("(max-width: 639px), (max-height: 560px)");
  // Wave A R-02 option (ii): the compact tool sheet is an explicitly
  // non-modal bottom sheet like the desktop panel — no aria-modal, no Tab
  // trap. The exclusive machine keeps owning popover modality, so at most
  // one aria-modal=true surface is ever open (single-modal rule).
  const [geometry, setGeometry] = useState<SatToolGeometry>(() => ({
    x: props.defaultGeometry.x,
    y: props.defaultGeometry.y,
    w: props.defaultGeometry.w || DEFAULT_W,
    h: props.defaultGeometry.h || DEFAULT_H,
  }));
  const interactive = !props.disabled;
  const dragRef = useRef<{ dx: number; dy: number } | null>(null);
  const resizeRef = useRef<{ w: number; h: number; x: number; y: number } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!props.geometryKey) return;
    const saved = loadSatToolGeometry(props.geometryKey);
    if (saved) {
      setGeometry(clampSatToolGeometry(saved, { w: window.innerWidth, h: window.innerHeight }));
    }
  }, [props.geometryKey]);

  const persist = useCallback((next: SatToolGeometry) => {
    setGeometry(next);
    if (props.geometryKey) saveSatToolGeometry(props.geometryKey, next);
  }, [props.geometryKey]);

  const onHeaderPointerDown = (event: React.PointerEvent) => {
    if (compact || !interactive) return;
    if ((event.target as HTMLElement).closest("button,[role=button]")) return;
    event.preventDefault();
    dragRef.current = { dx: event.clientX - geometry.x, dy: event.clientY - geometry.y };
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  };
  const onHeaderPointerMove = (event: React.PointerEvent) => {
    if (!dragRef.current) return;
    persist(clampSatToolGeometry(
      { ...geometry, x: event.clientX - dragRef.current.dx, y: event.clientY - dragRef.current.dy },
      { w: window.innerWidth, h: window.innerHeight },
    ));
  };
  const endDrag = () => { dragRef.current = null; };

  const moveByKeyboard = (dx: number, dy: number) => {
    if (compact || !interactive) return;
    persist(clampSatToolGeometry(
      { ...geometry, x: geometry.x + dx, y: geometry.y + dy },
      { w: window.innerWidth, h: window.innerHeight },
    ));
  };

  const resizeByKeyboard = (dw: number, dh: number) => {
    if (compact || !interactive || !props.resizable) return;
    persist(clampSatToolGeometry(
      {
        ...geometry,
        w: Math.max(SAT_TOOL_GEOMETRY_MIN_W, geometry.w + dw),
        h: Math.max(SAT_TOOL_GEOMETRY_MIN_H, geometry.h + dh),
      },
      { w: window.innerWidth, h: window.innerHeight },
    ));
  };

  const onResizePointerDown = (event: React.PointerEvent) => {
    if (compact || !interactive || !props.resizable) return;
    event.preventDefault();
    event.stopPropagation();
    resizeRef.current = { w: geometry.w, h: geometry.h, x: event.clientX, y: event.clientY };
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  };
  const onResizePointerMove = (event: React.PointerEvent) => {
    if (!resizeRef.current) return;
    const start = resizeRef.current;
    persist(clampSatToolGeometry(
      {
        ...geometry,
        w: Math.max(SAT_TOOL_GEOMETRY_MIN_W, start.w + (event.clientX - start.x)),
        h: Math.max(SAT_TOOL_GEOMETRY_MIN_H, start.h + (event.clientY - start.y)),
      },
      { w: window.innerWidth, h: window.innerHeight },
    ));
  };
  const endResize = () => { resizeRef.current = null; };

  // Focus reports to the opener (TopBar tool button) when the tool closes.
  useEffect(() => {
    if (!props.open) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return () => { if (opener?.isConnected) opener.focus(); };
  }, [props.open]);

  // Non-modal sheet: Escape closes the tool itself; Tab always leaves (no
  // trap on any breakpoint, compact included). Focus stays free so exam +
  // tools stay co-usable.
  useEffect(() => {
    if (!props.open || props.disabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      props.onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- onClose identity churns; key handling is the stable seam.
  }, [props.open, props.disabled]);

  // keepAlive: one mounted tree across open/close (closed renders hidden,
  // never unmounts) so prewarmed iframes keep node identity. Without it,
  // closed tools unmount as before (Reference behavior).
  if (!props.open && !props.keepAlive) return null;

  if (compact) {
    if (!props.open) {
      return (
        <div className="hidden" aria-hidden="true" inert data-sat-tool-window={props.title} data-sat-tool-presentation="compact-sheet">
          {props.children}
        </div>
      );
    }
    return (
      <div className="sat-backdrop-enter fixed inset-0 z-[83] flex items-end justify-center bg-black/20" data-sat-tool-backdrop>
        <div
          ref={panelRef}
          role="dialog"
          aria-label={props.title}
          inert={props.disabled}
          data-sat-tool-window={props.title}
          data-sat-tool-presentation="compact-sheet"
          data-sat-tool-interaction-disabled={props.disabled ? "true" : undefined}
          className="sat-ui flex max-h-[85dvh] w-full max-w-[520px] flex-col overflow-hidden rounded-t-[14px] border border-b-0 border-[var(--sat-divider)] bg-[var(--sat-surface)] text-[var(--sat-text)] shadow-[0_-18px_60px_rgba(0,0,0,0.22)]"
        >
          <div className="flex min-h-12 shrink-0 items-center gap-2 border-b border-[var(--sat-divider-soft)] px-4">
            <span className="min-w-0 flex-1 truncate text-[15px] font-semibold">{props.title}</span>
            <button type="button" onClick={props.onClose} aria-label={"Close " + props.title} data-sat-tool-close disabled={props.disabled} className="sat-touch-target grid w-11 place-items-center rounded hover:bg-[var(--sat-surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-focus)] disabled:cursor-not-allowed disabled:opacity-50">
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-hidden">{props.children}</div>
        </div>
      </div>
    );
  }

  // Legacy probe attributes (SatToolWindow-era e2e contract): the
  // accessibility spec addresses tools via data-sat-tool-window +
  // data-sat-tool-presentation (+ resizable/detent negatives). Keep them as
  // thin aliases over the floating implementation so the contract survives
  // the window-manager replacement.
  const presentation = compact ? "compact-sheet" : "floating";
  // keepAlive closed: SAME dialog node hidden — never unmounted — so
  // prewarmed iframe identity survives closed -> open. `hidden` removes it
  // from layout; inert + no dialog role keeps it out of the tab order/AT.
  return (
    <div
      ref={panelRef}
      role={props.open ? "dialog" : undefined}
      aria-label={props.title}
      aria-hidden={props.open ? undefined : true}
      hidden={props.open ? undefined : true}
      inert={props.disabled || !props.open}
      data-sat-tool-window={props.title}
      data-sat-tool-presentation={presentation}
      data-sat-tool-resizable={props.resizable && !compact ? "true" : undefined}
      data-sat-tool-interaction-disabled={props.disabled ? "true" : undefined}
      data-sat-floating-tool={props.open ? props.title : undefined}
      className={"sat-ui fixed " + satOverlayZClass("toolSheet") + " flex flex-col overflow-hidden rounded-[6px] border border-[var(--sat-tool-border)] bg-[var(--sat-surface)] text-[var(--sat-text)] shadow-[var(--sat-shadow-floating)]" + (props.disabled ? " opacity-70" : "")}
      style={{ left: geometry.x, top: geometry.y, width: geometry.w, height: geometry.h }}
    >
      <div
        data-sat-tool-header
        className="flex h-11 min-h-11 shrink-0 cursor-move touch-none select-none items-center gap-2 border-b border-[var(--sat-divider-soft)] px-3"
        onPointerDown={onHeaderPointerDown}
        onPointerMove={onHeaderPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <span
          role="button"
          tabIndex={props.disabled ? -1 : 0}
          aria-label={"Move " + props.title + ". Use arrow keys to move."}
          className="grid h-11 w-11 place-items-center rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-focus)]"
          onKeyDown={(event: ReactKeyboardEvent<HTMLElement>) => {
            const step = event.shiftKey ? 24 : 8;
            if (event.key === "ArrowLeft") { event.preventDefault(); moveByKeyboard(-step, 0); }
            else if (event.key === "ArrowRight") { event.preventDefault(); moveByKeyboard(step, 0); }
            else if (event.key === "ArrowUp") { event.preventDefault(); moveByKeyboard(0, -step); }
            else if (event.key === "ArrowDown") { event.preventDefault(); moveByKeyboard(0, step); }
          }}
        >
          <GripVertical className="h-5 w-5 text-[var(--sat-text-secondary)]" aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1 truncate text-[15px] font-semibold">{props.title}</span>
        <button type="button" onClick={props.onClose} aria-label={"Close " + props.title} data-sat-tool-close disabled={props.disabled} className="sat-touch-target grid w-11 place-items-center rounded hover:bg-[var(--sat-surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-focus)] disabled:cursor-not-allowed disabled:opacity-50">
          <X className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">{props.children}</div>
      {props.resizable && !compact ? (
        // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- separator is the ARIA resize-handle role; keyboard support is provided via tabIndex + Arrow keys (Wave B R-09).
        <div
          role="separator"
          tabIndex={props.disabled ? -1 : 0}
          aria-label={"Resize " + props.title + ". Use arrow keys to resize."}
          data-sat-resize-handle="se"
          className="absolute bottom-0 right-0 grid h-11 w-11 cursor-nwse-resize touch-none select-none place-items-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-focus)]"
          onPointerDown={onResizePointerDown}
          onPointerMove={onResizePointerMove}
          onPointerUp={endResize}
          onPointerCancel={endResize}
          onKeyDown={(event: ReactKeyboardEvent<HTMLElement>) => {
            const step = event.shiftKey ? 24 : 8;
            if (event.key === "ArrowLeft") { event.preventDefault(); resizeByKeyboard(-step, 0); }
            else if (event.key === "ArrowRight") { event.preventDefault(); resizeByKeyboard(step, 0); }
            else if (event.key === "ArrowUp") { event.preventDefault(); resizeByKeyboard(0, -step); }
            else if (event.key === "ArrowDown") { event.preventDefault(); resizeByKeyboard(0, step); }
          }}
        >
          <span aria-hidden="true" className="block h-8 w-8 text-right text-[16px] leading-8 text-[var(--sat-text-secondary)]">&#9698;</span>
        </div>
      ) : null}
    </div>
  );
}

export { SAT_FLOATING_TOOL_CHROME };
