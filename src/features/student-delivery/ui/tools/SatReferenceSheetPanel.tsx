/* eslint-disable jsx-a11y/no-noninteractive-element-interactions -- The reference region supports keyboard zoom and native pan gestures. */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { Maximize2, Minimize2, X } from "lucide-react";
import {
  loadSatToolViewState,
  saveSatToolViewState,
  satToolViewKey,
} from "../../infrastructure/satToolStateStore";
import { useSatExamZoom } from "../zoom/SatExamZoomContext";
import { useSatReferenceStageSize } from "./useSatReferenceViewportWidth";
import {
  satRefFitScale,
  SAT_REF_READABLE_SCALE_MIN,
  SatReferenceSheet,
} from "./reference/SatReferenceSheet";

export interface SatReferenceSheetPanelProps {
  open: boolean;
  disabled?: boolean;
  scheduleId?: string;
  attemptId?: string;
  moduleAttemptId?: string;
  expanded?: boolean;
  onToggleExpanded?: () => void;
  onClose: () => void;
}

export const SAT_REFERENCE_ZOOM_MIN = 1;
export const SAT_REFERENCE_ZOOM_MAX = 2;
export const SAT_REFERENCE_ZOOM_STEP = 0.25;
export function satReferenceViewKey(
  scheduleId: string,
  attemptId: string,
  moduleAttemptId: string
): string {
  return `${satToolViewKey(scheduleId, attemptId, moduleAttemptId)}:reference`;
}
export function clampSatReferenceZoom(value: unknown): number {
  const numeric = typeof value === "number" && Number.isFinite(value) ? value : 1;
  return Math.min(SAT_REFERENCE_ZOOM_MAX / SAT_REF_READABLE_SCALE_MIN, Math.max(1, numeric));
}

export function SatReferenceSheetPanel({
  open,
  disabled = false,
  scheduleId = "debug-schedule",
  attemptId = "debug-attempt",
  moduleAttemptId = "debug-module",
  expanded: controlledExpanded,
  onToggleExpanded,
  onClose,
}: SatReferenceSheetPanelProps) {
  const { scale: examScale } = useSatExamZoom();
  const viewKey = satReferenceViewKey(scheduleId, attemptId, moduleAttemptId);
  const [internalExpanded, setInternalExpanded] = useState(false);
  const expanded = controlledExpanded ?? internalExpanded;
  const [zoom, setZoom] = useState(() => clampSatReferenceZoom(loadSatToolViewState(viewKey).zoom));
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [scrollNode, setScrollNode] = useState<HTMLDivElement | null>(null);
  const attachStage = useCallback((node: HTMLDivElement | null) => {
    scrollRef.current = node;
    setScrollNode(node);
  }, []);
  const stage = useSatReferenceStageSize(scrollNode, { w: 360 / examScale, h: 600 / examScale });
  const landscape = expanded && stage.w * examScale >= 900;
  const viewportWidth = stage.w;
  const baseScale = landscape
    ? satRefFitScale(viewportWidth, 1, undefined, examScale) * examScale
    : 1;
  const physicalScale = landscape
    ? satRefFitScale(viewportWidth, zoom, undefined, examScale) * examScale
    : Math.min(2, zoom);
  const maximumFitZoom = 2 / baseScale;
  const atFit = zoom <= 1;
  const [zoomAnnouncement, setZoomAnnouncement] = useState("");
  const restoring = useRef(false);

  const writeView = useCallback(
    (patch: { zoom?: number; scrollTop?: number }) => {
      saveSatToolViewState(viewKey, { ...loadSatToolViewState(viewKey), ...patch });
    },
    [viewKey]
  );

  useEffect(() => {
    setZoom(clampSatReferenceZoom(loadSatToolViewState(viewKey).zoom));
  }, [viewKey, open]);
  useEffect(() => {
    if (!open) setInternalExpanded(false);
  }, [open]);
  useLayoutEffect(() => {
    if (!open || !scrollNode) return;
    restoring.current = true;
    const scrollTop = expanded ? 0 : loadSatToolViewState(viewKey).scrollTop;
    const apply = () => {
      scrollNode.scrollTop = scrollTop;
      scrollNode.scrollLeft = 0;
    };
    apply();
    const frame = requestAnimationFrame(() => {
      apply();
      restoring.current = false;
    });
    return () => {
      cancelAnimationFrame(frame);
      restoring.current = false;
    };
  }, [open, expanded, scrollNode, viewKey]);
  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return () => {
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, [open]);

  const applyZoom = useCallback(
    (next: number, options?: { announce?: boolean }) => {
      const value = Math.min(maximumFitZoom, clampSatReferenceZoom(next));
      setZoom(value);
      writeView({ zoom: value });
      if (options?.announce)
        setZoomAnnouncement(
          value === 1 ? "Fit sheet" : `Zoom ${Math.round(value * baseScale * 100)} percent`
        );
    },
    [maximumFitZoom, baseScale, writeView]
  );
  const zoomIn = () => applyZoom(zoom + 0.25, { announce: true });
  const zoomOut = () => applyZoom(zoom - 0.25, { announce: true });
  const zoomToMax = useCallback(
    () => applyZoom(maximumFitZoom, { announce: true }),
    [applyZoom, maximumFitZoom]
  );
  const fitSheet = useCallback(() => {
    applyZoom(1, { announce: true });
    if (scrollRef.current) {
      scrollRef.current.scrollTop = 0;
      scrollRef.current.scrollLeft = 0;
    }
    if (!expanded) writeView({ scrollTop: 0 });
  }, [applyZoom, expanded, writeView]);
  const zoomRef = useRef(zoom);
  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);
  const zoomActions = useRef({ applyZoom, fitSheet, maximumFitZoom, zoomToMax });
  useEffect(() => {
    zoomActions.current = { applyZoom, fitSheet, maximumFitZoom, zoomToMax };
  }, [applyZoom, fitSheet, maximumFitZoom, zoomToMax]);
  const touchGesture = useRef<{
    pinch: { distance: number; zoom: number } | null;
    tap: { x: number; y: number; at: number } | null;
    lastTap: { x: number; y: number; at: number } | null;
  }>({ pinch: null, tap: null, lastTap: null });
  useEffect(() => {
    if (!scrollNode || !open || disabled) return;
    const gesture = touchGesture.current;
    const distance = (touches: TouchList) => {
      const first = touches.item(0);
      const second = touches.item(1);
      return first && second
        ? Math.hypot(first.clientX - second.clientX, first.clientY - second.clientY)
        : 0;
    };
    const start = (event: TouchEvent) => {
      if (event.touches.length === 2) {
        const d = distance(event.touches);
        gesture.pinch =
          d > 0
            ? { distance: d, zoom: Math.min(zoomRef.current, zoomActions.current.maximumFitZoom) }
            : null;
        gesture.tap = gesture.lastTap = null;
        event.preventDefault();
      } else if (event.touches.length === 1) {
        const first = event.touches.item(0);
        if (first) gesture.tap = { x: first.clientX, y: first.clientY, at: Date.now() };
      }
    };
    const move = (event: TouchEvent) => {
      if (event.touches.length === 2 && gesture.pinch) {
        event.preventDefault();
        zoomActions.current.applyZoom(
          (gesture.pinch.zoom * distance(event.touches)) / gesture.pinch.distance
        );
      } else {
        gesture.tap = null;
      }
    };
    const end = (event: TouchEvent) => {
      if (gesture.pinch) {
        gesture.pinch = null;
        gesture.tap = gesture.lastTap = null;
        return;
      }
      const tap = gesture.tap;
      gesture.tap = null;
      if (!tap || event.touches.length || Date.now() - tap.at > 300) return;
      const last = gesture.lastTap;
      if (last && tap.at - last.at < 300 && Math.hypot(tap.x - last.x, tap.y - last.y) < 24) {
        event.preventDefault();
        gesture.lastTap = null;
        if (zoomRef.current <= 1) zoomActions.current.zoomToMax();
        else zoomActions.current.fitSheet();
      } else gesture.lastTap = tap;
    };
    const cancel = () => {
      gesture.pinch = gesture.tap = gesture.lastTap = null;
    };
    scrollNode.addEventListener("touchstart", start, { passive: false });
    scrollNode.addEventListener("touchmove", move, { passive: false });
    scrollNode.addEventListener("touchend", end, { passive: false });
    scrollNode.addEventListener("touchcancel", cancel);
    return () => {
      scrollNode.removeEventListener("touchstart", start);
      scrollNode.removeEventListener("touchmove", move);
      scrollNode.removeEventListener("touchend", end);
      scrollNode.removeEventListener("touchcancel", cancel);
      cancel();
    };
  }, [scrollNode, open, disabled]);

  if (!open) return null;
  return (
    <section
      role="dialog"
      aria-label="Reference Sheet"
      data-sat-tool-window="Reference Sheet"
      data-sat-tool-presentation={expanded ? "expanded" : "sidebar"}
      data-sat-reference-shell
      inert={disabled}
      className="sat-ui sat-reference-panel flex h-full min-h-0 min-w-0 flex-col overflow-hidden border-l border-[var(--sat-divider)] bg-white text-[var(--sat-text)]"
      style={
        {
          "--sat-ref-unit": `${1 / examScale}px`,
          "--sat-control-target": `${44 / examScale}px`,
        } as CSSProperties
      }
      onKeyDown={(event) => {
        if (disabled) return;
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }
        if (
          !(event.ctrlKey || event.metaKey) ||
          (event.target as HTMLElement).closest("input,textarea,[contenteditable=true]")
        )
          return;
        if (event.key === "+" || event.key === "=") {
          event.preventDefault();
          zoomIn();
        }
        if (event.key === "-") {
          event.preventDefault();
          zoomOut();
        }
        if (event.key === "0") {
          event.preventDefault();
          fitSheet();
        }
      }}
    >
      <header
        data-sat-tool-header
        className="sat-reference-header flex shrink-0 items-center gap-1 bg-[var(--sat-ref-header-bg)] text-white"
      >
        <span data-sat-tool-title className="min-w-0 flex-1 font-semibold">
          Reference
        </span>
        <button
          type="button"
          className="sat-touch-target grid shrink-0 place-items-center focus-visible:ring-2 focus-visible:ring-[var(--sat-focus)]"
          aria-label={expanded ? "Restore Reference Sheet" : "Expand Reference Sheet"}
          aria-expanded={expanded}
          disabled={disabled}
          onClick={() => {
            if (!expanded) writeView({ scrollTop: scrollRef.current?.scrollTop ?? 0 });
            if (onToggleExpanded) onToggleExpanded();
            else setInternalExpanded((value) => !value);
          }}
        >
          {expanded ? <Minimize2 aria-hidden="true" /> : <Maximize2 aria-hidden="true" />}
        </button>
        <button
          type="button"
          className="sat-touch-target grid shrink-0 place-items-center focus-visible:ring-2 focus-visible:ring-[var(--sat-focus)]"
          aria-label="Close Reference Sheet"
          disabled={disabled}
          onClick={onClose}
        >
          <X aria-hidden="true" />
        </button>
      </header>
      <div
        data-sat-ref-toolbar
        className="sat-reference-toolbar flex shrink-0 items-center justify-between border-b border-[var(--sat-divider-soft)]"
      >
        <button
          type="button"
          className="sat-touch-target px-2 focus-visible:ring-2 focus-visible:ring-[var(--sat-focus)]"
          aria-label="Fit sheet"
          aria-pressed={atFit}
          disabled={disabled}
          onClick={fitSheet}
        >
          Fit sheet
        </button>
        <div className="flex items-center">
          <button
            type="button"
            className="sat-touch-target focus-visible:ring-2 focus-visible:ring-[var(--sat-focus)]"
            aria-label="Zoom out"
            disabled={disabled || atFit}
            onClick={zoomOut}
          >
            −
          </button>
          <span
            className="tabular-nums"
            aria-hidden="true"
          >{`${Math.round(physicalScale * 100)}%`}</span>
          <button
            type="button"
            className="sat-touch-target focus-visible:ring-2 focus-visible:ring-[var(--sat-focus)]"
            aria-label="Zoom in"
            disabled={disabled || physicalScale >= 2}
            onClick={zoomIn}
          >
            +
          </button>
        </div>
      </div>
      <span className="sr-only" role="status">
        {zoomAnnouncement}
      </span>
      <div
        data-sat-tool-scroll
        ref={attachStage}
        role="region"
        aria-label="Reference sheet content"
        tabIndex={disabled ? -1 : 0}
        className="min-h-0 flex-1 overflow-auto"
        style={{ touchAction: "pan-x pan-y" }}
        onScroll={() => {
          if (!restoring.current && !expanded)
            writeView({ scrollTop: scrollRef.current?.scrollTop ?? 0 });
        }}
        onDoubleClick={() => {
          if (!disabled) {
            if (atFit) zoomToMax();
            else fitSheet();
          }
        }}
      >
        <SatReferenceSheet
          viewportWidth={viewportWidth}
          stageWidth={viewportWidth}
          zoom={zoom}
          examScale={examScale}
          layout={landscape ? "landscape" : "portrait"}
        />
      </div>
    </section>
  );
}
