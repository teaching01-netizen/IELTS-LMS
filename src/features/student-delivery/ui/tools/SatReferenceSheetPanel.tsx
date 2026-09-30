import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { SatFloatingTool } from "./SatFloatingTool";
import {
  clampSatToolGeometry,
  loadSatToolGeometry,
  saveSatToolGeometry,
  satToolGeometryKey,
  type SatToolGeometry,
} from "../../infrastructure/satToolGeometryStore";
import {
  SAT_TOOL_VIEW_COLLAPSED_DEFAULT,
  SAT_TOOL_VIEW_MOVED_DEFAULT,
  SAT_TOOL_VIEW_RESIZED_DEFAULT,
  SAT_TOOL_VIEW_SCALE_MODE_DEFAULT,
  loadSatToolViewState,
  saveSatToolViewState,
  satToolViewKey,
  type SatReferenceScaleMode,
} from "../../infrastructure/satToolStateStore";
import {
  resolveSatReferenceDefaultGeometry,
  resolveSatToolMaxSize,
  resolveSatToolMinSize,
  SAT_REFERENCE_HEADER_HEIGHT,
  SAT_REFERENCE_TOUCH_HEADER_HEIGHT,
  SAT_REFERENCE_TOOLBAR_HEIGHT,
} from "../../domain/satToolSizePolicy";
import { placeSatTool } from "../../domain/satToolPlacement";
import {
  readSatToolSafeArea,
  readSatToolViewport,
} from "./satToolPlacementRuntime";
import { useSatExamZoom } from "../zoom/SatExamZoomContext";
import { useSatMediaQuery } from "../useSatMediaQuery";
import {
  SAT_REFERENCE_VIEWPORT_FALLBACK_WIDTH,
  useSatReferenceStageSize,
} from "./useSatReferenceViewportWidth";
import {
  isSatRefAtFit,
  satRefFitScale,
  SAT_REF_CANVAS_W,
  SAT_REF_CANVAS_H,
  SAT_REF_READABLE_SCALE_MIN,
  SatReferenceSheet,
} from "./reference/SatReferenceSheet";

export interface SatReferenceSheetPanelProps {
  open: boolean;
  disabled?: boolean;
  scheduleId?: string | undefined;
  attemptId?: string | undefined;
  moduleAttemptId?: string | undefined;
  onClose: () => void;
}

export const SAT_REFERENCE_ZOOM_MIN = 1;
export const SAT_REFERENCE_ZOOM_MAX = 2;
export const SAT_REFERENCE_ZOOM_STEP = 0.25;

/**
 * Legacy per-tool view-key helper (Phase 04 local adapter). Kept exported so
 * the persisted key family and existing tests keep passing; new code prefers
 * the shared satToolViewKey from the Phase-02 state store.
 */
export function satReferenceViewKey(
  scheduleId: string,
  attemptId: string,
  moduleAttemptId: string,
): string {
  return `${satToolViewKey(scheduleId, attemptId, moduleAttemptId)}:reference`;
}

/**
 * R-04 Step 6.2 — extended view-state adapter shape. zoom stays as the
 * legacy fallback for Reference restore (Reference readers prefer scaleMode
 * and fall back to clamped zoom only when scaleMode is absent); scrollTop is
 * the canonical scroll anchor (CSS px, >= 0); collapsed is a view-state bit
 * (never a geometry mutation — the stored h always means restored height);
 * scaleMode is the canonical Reference scale (only mode shipped: fit-width);
 * hasBeenMoved/hasBeenResized are the manual-wins gates (drag sets moved,
 * resize sets resized; system clamps never set them). Unknown fields
 * default via the store normalizers; hint-family fields (lastFocusedTool /
 * toolHintSeen) live on the same :reference-suffixed record and are
 * preserved by read-modify-write — Reference fields are never written into
 * the unsuffixed shared key (viewStateKey prop split preserved).
 */
interface SatReferenceViewState {
  zoom: number;
  scrollTop: number;
  collapsed: boolean;
  scaleMode: SatReferenceScaleMode;
  hasBeenMoved: boolean;
  hasBeenResized: boolean;
}

export const SAT_REFERENCE_VIEW_DEFAULTS: SatReferenceViewState = {
  zoom: 1,
  scrollTop: 0,
  collapsed: SAT_TOOL_VIEW_COLLAPSED_DEFAULT,
  scaleMode: SAT_TOOL_VIEW_SCALE_MODE_DEFAULT,
  hasBeenMoved: SAT_TOOL_VIEW_MOVED_DEFAULT,
  hasBeenResized: SAT_TOOL_VIEW_RESIZED_DEFAULT,
};

export function clampSatReferenceZoom(value: unknown): number {
  const numeric = typeof value === "number" && Number.isFinite(value) ? value : 1;
  // Storage uses a fit multiplier; even the readable minimum can reach 200% actual size.
  return Math.min(SAT_REFERENCE_ZOOM_MAX / SAT_REF_READABLE_SCALE_MIN, Math.max(SAT_REFERENCE_ZOOM_MIN, numeric));
}

/**
 * View-state adapter over the Phase-02 store. Keeps the exact key family
 * (sat-tool-view:v1:...:reference) and the exact { zoom, scrollTop } shape
 * the panel and its tests pin, while delegating persistence to
 * loadSatToolViewState/saveSatToolViewState. Local fallback: when the store
 * is unreachable (no key or storage throws), return in-memory defaults and
 * swallow writes so the exam never blocks.
 */
function readSatReferenceViewState(key: string | null): SatReferenceViewState {
  if (!key) return { ...SAT_REFERENCE_VIEW_DEFAULTS };
  try {
    const stored = loadSatToolViewState(key);
    return {
      // Values below 100% are legacy state. In fit-sheet mode they render
      // identically to 100%, so normalizing prevents a dishonest percentage.
      zoom: Math.max(1, clampSatReferenceZoom(stored.zoom)),
      scrollTop:
        typeof stored.scrollTop === "number" && Number.isFinite(stored.scrollTop)
          ? Math.max(0, stored.scrollTop)
          : 0,
      collapsed: stored.collapsed,
      scaleMode: stored.scaleMode,
      hasBeenMoved: stored.hasBeenMoved,
      hasBeenResized: stored.hasBeenResized,
    };
  } catch {
    return { ...SAT_REFERENCE_VIEW_DEFAULTS };
  }
}

function writeSatReferenceViewState(
  key: string | null,
  state: Partial<SatReferenceViewState>,
): void {
  if (!key) return;
  try {
    const current = loadSatToolViewState(key);
    saveSatToolViewState(key, {
      ...current,
      zoom:
        state.zoom === undefined ? current.zoom : clampSatReferenceZoom(state.zoom),
      scrollTop:
        state.scrollTop === undefined
          ? current.scrollTop
          : typeof state.scrollTop === "number" && Number.isFinite(state.scrollTop)
            ? Math.max(0, state.scrollTop)
            : 0,
      collapsed: state.collapsed === undefined ? current.collapsed : state.collapsed === true,
      scaleMode:
        state.scaleMode === undefined
          ? current.scaleMode
          : state.scaleMode === "fit-width"
            ? state.scaleMode
            : SAT_TOOL_VIEW_SCALE_MODE_DEFAULT,
      hasBeenMoved: state.hasBeenMoved === undefined ? current.hasBeenMoved : state.hasBeenMoved === true,
      hasBeenResized:
        state.hasBeenResized === undefined ? current.hasBeenResized : state.hasBeenResized === true,
    });
  } catch {
    /* never block the exam */
  }
}

/**
 * R-04 Step 3 + Step 6.3 — default composition for first-open Reference:
 * top/right below the toolbar via the placement brain (ties break
 * right-first by candidate order, so the empty exam lands right; real
 * obstruction diverts per existing weights — never forced right), clamped
 * to the safe area. Manual-wins gate lives at the caller: when stored
 * geometry exists this resolver does NOT run (modulo the Step-5e pre-R-04
 * axis migration).
 */
export function defaultSatReferenceGeometry(
  viewport: { w: number; h: number },
  safeArea: { top: number; right: number; bottom: number; left: number },
  headerHeight = SAT_REFERENCE_HEADER_HEIGHT,
  examScale = 1,
): SatToolGeometry {
  const size = resolveSatReferenceDefaultGeometry(viewport, safeArea, headerHeight, examScale);
  const input = {
    tool: size,
    viewport,
    safeArea,
    question: null,
    existing: [] as readonly { x: number; y: number; w: number; h: number }[],
    trigger: null,
    lastPosition: null,
  };
  const chosen = placeSatTool(input);
  return clampSatToolGeometry({ ...chosen, w: size.w, h: size.h }, viewport, safeArea, resolveSatToolMinSize('reference', examScale));
}

/** R-04 Step 6.3 — static fallback for the defaultGeometry first-useState initializer (tests only: window may be unavailable before effects). { x: 48, y: 110 } + policy size. */
function fallbackSatReferenceGeometry(): SatToolGeometry {
  const min = resolveSatToolMinSize("reference");
  // R-06: fit-all composition at the 768px worked example is 666x458
  // (32 + 53 + ceil(560*666/1000) = 458), floored at the D3 minimum.
  return { x: 48, y: 110, w: Math.max(666, min.w), h: Math.max(458, min.h) };
}

/**
 * R-04 Step 2.4 — D3 minimum passed explicitly (the primitive otherwise
 * falls back to its title branch). Single-sourced from policy: { 480, 320 }.
 */
export const SAT_REFERENCE_MIN_SIZE = resolveSatToolMinSize("reference");

export function isPreR04LeftEdge(x: number, viewportW: number, safeLeft: number): boolean {
  if (!Number.isFinite(x) || !Number.isFinite(viewportW)) return false;
  void safeLeft;
  // Pre-R-04 defaultGeometry x was 48 at every viewport; treat near-48 as
  // the untouched left-edge composition (1px tolerance for rounding).
  return Math.abs(x - 48) <= 1;
}

export function SatReferenceSheetPanel({
  open,
  disabled = false,
  scheduleId = "debug-schedule",
  attemptId = "debug-attempt",
  moduleAttemptId = "debug-module",
  onClose,
}: SatReferenceSheetPanelProps) {
  const { viewportToLogicalLength, scale: examScale } = useSatExamZoom();
  const coarsePointer = useSatMediaQuery("(pointer: coarse)");
  // Round upward to browser layout units so fractional Display zoom cannot
  // shave a fraction of a physical pixel off the 44px touch minimum.
  const touchTarget = Math.ceil(viewportToLogicalLength(SAT_REFERENCE_TOUCH_HEADER_HEIGHT) * 64) / 64;
  const headerHeight = coarsePointer ? touchTarget : viewportToLogicalLength(SAT_REFERENCE_HEADER_HEIGHT);
  const toolbarHeight = viewportToLogicalLength(SAT_REFERENCE_TOOLBAR_HEIGHT);
  const minimumSize = useMemo(() => resolveSatToolMinSize('reference', examScale), [examScale]);
  const viewport = readSatToolViewport(viewportToLogicalLength);
  const geometryKey = satToolGeometryKey(scheduleId, attemptId, moduleAttemptId, "reference");
  const viewKey = satReferenceViewKey(scheduleId, attemptId, moduleAttemptId);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollNode, setScrollNode] = useState<HTMLDivElement | null>(null);
  const attachStage = useCallback((node: HTMLDivElement | null) => {
    scrollRef.current = node;
    setScrollNode(node);
  }, []);
  const [zoom, setZoom] = useState<number>(() => readSatReferenceViewState(viewKey).zoom);
  const [collapsed, setCollapsed] = useState<boolean>(
    () => readSatReferenceViewState(viewKey).collapsed,
  );
  const [scaleMode, setScaleMode] = useState<SatReferenceScaleMode>(
    () => readSatReferenceViewState(viewKey).scaleMode,
  );
  // Resolve first-open geometry before measuring the stage so the initial
  // render has a safe, proportional fit seed instead of the 1000x560
  // canonical canvas size. useLayoutEffect replaces the seed with the real
  // content box before paint; ResizeObserver keeps it current thereafter.
  const defaultGeometry = useMemo<SatToolGeometry>(() => {
    if (typeof window === "undefined") return fallbackSatReferenceGeometry();
    try {
      return defaultSatReferenceGeometry({ w: viewport.w, h: viewport.h }, readSatToolSafeArea(viewportToLogicalLength), headerHeight, examScale);
    } catch {
      return fallbackSatReferenceGeometry();
    }
  }, [viewportToLogicalLength, headerHeight, examScale, viewport.w, viewport.h]);
  const initialStageSize = useMemo(
    () => ({
      w: defaultGeometry.w,
      h: Math.max(
        1,
        defaultGeometry.h - headerHeight - toolbarHeight,
      ),
    }),
    [defaultGeometry, headerHeight, toolbarHeight],
  );
  // The scroll node is the stage. A proportional seed prevents first-frame
  // crop when the ref does not exist during the state initializer.
  const stage = useSatReferenceStageSize(scrollNode, initialStageSize);
  const viewportWidth = stage.w;
  const stageH = stage.h;
  const renderScale = satRefFitScale(viewportWidth, zoom, stageH, examScale);
  const physicalScale = renderScale * examScale;
  const atFit = isSatRefAtFit(viewportWidth, zoom, stageH, examScale);
  const needsScroll = SAT_REF_CANVAS_W * renderScale > stage.w || SAT_REF_CANVAS_H * renderScale > stage.h;
  const maximumFitZoom = SAT_REFERENCE_ZOOM_MAX / (satRefFitScale(viewportWidth, 1, stageH, examScale) * examScale);
  const [zoomAnnouncement, setZoomAnnouncement] = useState("");
  const collapsedRef = useRef(collapsed);
  useEffect(() => {
    collapsedRef.current = collapsed;
  }, [collapsed]);

  // R-04 Step 6.5 — open-effect restore (Step-5 close->reopen sequence:
  // geometry seed + collapsed + scale + rAF scroll). Returning path clamps
  // the saved rect (manual-wins: the placement resolver does NOT run) with
  // the one-time pre-R-04 axis migration for untouched families; first-run
  // (no stored geometry) flows through defaultGeometry computed once below.
  // Geometry seeding commits through the same persist pipeline the
  // primitive uses (geometry store + its saved-wins load stay coherent).
  useEffect(() => {
    const restored = readSatReferenceViewState(viewKey);
    setZoom((current) => (current === restored.zoom ? current : restored.zoom));
    setScaleMode((current) => (current === restored.scaleMode ? current : restored.scaleMode));
    // Collapse->expand restores exactly (position/width/scroll/zoom
    // retained; height returns to the pre-collapse value because collapse
    // never persists geometry.h — Step 5 contract with R-03).
    setCollapsed((current) => (current === restored.collapsed ? current : restored.collapsed));
    if (open && typeof window !== "undefined") {
      try {
        const viewport = readSatToolViewport(viewportToLogicalLength);
        const safeArea = readSatToolSafeArea(viewportToLogicalLength);
        const savedGeom = loadSatToolGeometry(geometryKey);
        if (savedGeom) {
          let geom = clampSatToolGeometry(savedGeom, viewport, safeArea, minimumSize);
          // Step-5e one-time pre-R-04 migration (only when the flags
          // disagree — covers pre-R-04 rects predating D3 sizes/left-edge
          // x = 48; documented approximation, legacy records carry no flags).
          if (!restored.hasBeenResized && (savedGeom.w < 480 || savedGeom.h < 320)) {
            const fresh = resolveSatReferenceDefaultGeometry(viewport, safeArea, headerHeight, examScale);
            geom = clampSatToolGeometry({ ...geom, w: fresh.w, h: fresh.h }, viewport, safeArea, minimumSize);
          }
          if (!restored.hasBeenMoved && isPreR04LeftEdge(savedGeom.x, viewport.w, safeArea.left)) {
            const fresh = placeSatTool({
              tool: { w: geom.w, h: geom.h },
              viewport,
              safeArea,
              question: null,
              existing: [],
              trigger: null,
              lastPosition: null,
            });
            geom = clampSatToolGeometry({ ...geom, ...fresh }, viewport, safeArea, minimumSize);
          }
          saveSatToolGeometry(geometryKey, geom);
        }
      } catch {
        /* never block the exam */
      }
      // Restore only on open or identity changes. A readable fit can still
      // need scrolling, so reset the anchor only when the real sheet fits.
      const applyScroll = () => {
        const node = scrollRef.current;
        if (!node) return;
        const fits = restored.zoom <= 1 && node.scrollHeight <= node.clientHeight;
        node.scrollTop = fits ? 0 : restored.scrollTop;
      };
      if (typeof window.requestAnimationFrame === "function") {
        window.requestAnimationFrame(applyScroll);
      } else {
        applyScroll();
      }
    }
  }, [viewKey, open, geometryKey, viewportToLogicalLength, minimumSize, headerHeight, examScale]);

  // R-04 Step 6.5 — collapse toggle: the panel is the controller (replaces
  // the R-03 local useState path — the primitive's externallyControlled
  // branch consumes these props). Collapse-enter snapshots scroll + scale
  // alongside collapsed: true (geometry store keeps the restored rect —
  // never the collapsed height); expand-exit persists collapsed: false and
  // re-asserts the scroll anchor post-layout via rAF.
  const handleToggleCollapse = useCallback(() => {
    const next = !collapsedRef.current;
    collapsedRef.current = next;
    setCollapsed(next);
    if (next) {
      writeSatReferenceViewState(viewKey, {
        collapsed: true,
        scrollTop: scrollRef.current?.scrollTop ?? 0,
        scaleMode,
      });
    } else {
      writeSatReferenceViewState(viewKey, { collapsed: false });
      if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
        const anchor = readSatReferenceViewState(viewKey).scrollTop;
        window.requestAnimationFrame(() => {
          if (scrollRef.current) scrollRef.current.scrollTop = anchor;
        });
      }
    }
  }, [viewKey, scaleMode]);

  const persistZoom = useCallback(
    (next: number) => {
      const current = scrollRef.current?.scrollTop ?? 0;
      writeSatReferenceViewState(viewKey, { zoom: next, scrollTop: current });
    },
    [viewKey],
  );

  const applyZoom = useCallback(
    (next: number, options?: { announce?: boolean }) => {
      const clamped = clampSatReferenceZoom(next);
      // Persist + set outside the updater (updaters must stay pure).
      // Repeat presses at the clamp edge re-announce the same value.
      setZoom((current) => (current === clamped ? current : clamped));
      persistZoom(clamped);
      if (options?.announce === true) {
        setZoomAnnouncement(clamped === 1 ? "Fit sheet" : `Zoom ${Math.round(satRefFitScale(viewportWidth, clamped, stageH, examScale) * examScale * 100)} percent`);
      }
    },
    [persistZoom, viewportWidth, stageH, examScale],
  );

  const zoomIn = useCallback(() => applyZoom(zoom + SAT_REFERENCE_ZOOM_STEP, { announce: true }), [applyZoom, zoom]);
  const zoomOut = useCallback(() => applyZoom(Math.min(zoom, maximumFitZoom) - SAT_REFERENCE_ZOOM_STEP, { announce: true }), [applyZoom, zoom, maximumFitZoom]);
  const zoomToMax = useCallback(() => applyZoom(SAT_REFERENCE_ZOOM_MAX / SAT_REF_READABLE_SCALE_MIN, { announce: true }), [applyZoom]);
  // R-07 Step 4 — "Fit width" becomes "Fit sheet": zoom back to fit (the
  // floor) and clear the zoomed-pan scroll to 0. Handler keeps the applyZoom
  // persist path; the scroll node resets on the next frame after zoom state
  // commits (setZoom is async, so reset here would race the re-render).
  const fitSheet = useCallback(() => {
    applyZoom(1, { announce: true });
    if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
      window.requestAnimationFrame(() => {
        if (scrollRef.current) {
          scrollRef.current.scrollTop = 0;
          scrollRef.current.scrollLeft = 0;
        }
      });
    } else if (scrollRef.current) {
      scrollRef.current.scrollTop = 0;
      scrollRef.current.scrollLeft = 0;
    }
  }, [applyZoom]);

  const zoomRef = useRef(zoom);
  useEffect(() => { zoomRef.current = zoom; }, [zoom]);
  const zoomActions = useRef({ applyZoom, fitSheet, maximumFitZoom, zoomToMax });
  useEffect(() => { zoomActions.current = { applyZoom, fitSheet, maximumFitZoom, zoomToMax }; }, [applyZoom, fitSheet, maximumFitZoom, zoomToMax]);
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
      return first && second ? Math.hypot(first.clientX - second.clientX, first.clientY - second.clientY) : 0;
    };
    const start = (event: TouchEvent) => {
      if (event.touches.length === 2) {
        const d = distance(event.touches);
        gesture.pinch = d > 0 ? { distance: d, zoom: Math.min(zoomRef.current, zoomActions.current.maximumFitZoom) } : null;
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
        zoomActions.current.applyZoom(gesture.pinch.zoom * distance(event.touches) / gesture.pinch.distance);
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
        if (zoomRef.current <= 1) zoomActions.current.zoomToMax(); else zoomActions.current.fitSheet();
      } else gesture.lastTap = tap;
    };
    const cancel = () => { gesture.pinch = gesture.tap = gesture.lastTap = null; };
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

  const handleScroll = useCallback(() => {
    const node = scrollRef.current;
    if (!node) return;
    // R-04 Step 6.6 — scroll persist extended with the merged write
    // (read-modify-write preserves collapsed/scaleMode/flags + the
    // hint-family fields on the :reference-suffixed record).
    writeSatReferenceViewState(viewKey, { zoom, scrollTop: node.scrollTop });
  }, [viewKey, zoom]);

  const markManualMove = useCallback(() => {
    writeSatReferenceViewState(viewKey, { hasBeenMoved: true });
  }, [viewKey]);

  const markManualResize = useCallback(() => {
    writeSatReferenceViewState(viewKey, { hasBeenResized: true });
  }, [viewKey]);

  // Bluebook floating tool: resizable + draggable through the shared shell
  // (C11 parity with Calculator). Geometry persists per module-attempt via
  // the geometry key; zoom + scrollTop persist via the Phase-02 view-state
  // store through the adapter above (same key family and shape).
  // R-06 Step 1 (B1) — Reference maxSize (D1 Reference-only): without it the
  // primitive falls back to 620/48vw and the first resize snaps narrower.
  // Single-sourced from the Reference policy row; window-guarded like above.
  const safeArea = readSatToolSafeArea(viewportToLogicalLength);
  const referenceMaxSize = resolveSatToolMaxSize("reference", {
    w: viewport.w - safeArea.left - safeArea.right,
    h: viewport.h - safeArea.top - safeArea.bottom,
  }, examScale);
  return (
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions -- Scoped shortcuts bubble from the panel's focusable controls.
    <div data-sat-reference-shell style={{ display: "contents" }}
    onKeyDown={(event) => {
      if (disabled || !open || !(event.ctrlKey || event.metaKey)) return;
      if ((event.target as HTMLElement).closest("input, textarea, [contenteditable=true]")) return;
      if (event.key === "+" || event.key === "=") { event.preventDefault(); zoomIn(); }
      if (event.key === "-") { event.preventDefault(); zoomOut(); }
      if (event.key === "0") { event.preventDefault(); fitSheet(); }
    }}>
    <SatFloatingTool
      title="Reference Sheet"
      open={open}
      geometryKey={geometryKey}
      viewStateKey={satToolViewKey(scheduleId, attemptId, moduleAttemptId)}
      defaultGeometry={defaultGeometry}
      minSize={minimumSize}
      maxSize={referenceMaxSize}
      resizable
      disabled={disabled}
      style={{
        "--sat-ref-header-height": `${headerHeight}px`,
        "--sat-ref-control-hit": `${headerHeight}px`,
        "--sat-ref-toolbar-height": `${toolbarHeight}px`,
        "--sat-control-target": `${touchTarget}px`,
        "--sat-ref-title-size": `${viewportToLogicalLength(12)}px`,
        "--sat-ref-control-visual": `${viewportToLogicalLength(24)}px`,
        "--sat-ref-icon-size": `${viewportToLogicalLength(16)}px`,
        "--sat-ref-compact-title-size": `${viewportToLogicalLength(15)}px`,
        "--sat-ref-compact-header-height": `${viewportToLogicalLength(48)}px`,
        "--sat-ref-compact-width": `${viewportToLogicalLength(520)}px`,
      } as CSSProperties}
      onManualMove={markManualMove}
      onManualResize={markManualResize}
      collapsed={collapsed}
      onToggleCollapse={handleToggleCollapse}
      onClose={onClose}
    >
      <div className="flex h-full min-h-0 flex-col bg-[var(--sat-surface)]">
        <div data-sat-ref-toolbar className="flex shrink-0 items-center justify-between gap-2 border-b border-[var(--sat-divider-soft)] px-3 py-1" style={{
          height: "var(--sat-ref-toolbar-height)",
          gap: viewportToLogicalLength(8),
          paddingInline: viewportToLogicalLength(12),
          paddingBlock: viewportToLogicalLength(4),
          borderBottomWidth: viewportToLogicalLength(1),
          "--sat-type-control-primary": `${viewportToLogicalLength(15)}px`,
          "--sat-type-control-secondary": `${viewportToLogicalLength(14)}px`,
          "--sat-type-metadata": `${viewportToLogicalLength(13)}px`,
        } as CSSProperties}>
          <button
            type="button"
            onClick={fitSheet}
            aria-label="Fit sheet"
            aria-pressed={atFit}
            style={{ paddingInline: viewportToLogicalLength(8) }}
            disabled={disabled}
            className="sat-touch-target sat-tool-pressable rounded px-2 sat-type-control-secondary font-semibold text-[var(--sat-text-secondary)] hover:text-[var(--sat-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-focus)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            Fit sheet
          </button>
          <div className="flex items-center gap-1" style={{ gap: viewportToLogicalLength(4) }}>
            {zoom > SAT_REFERENCE_ZOOM_MIN ? <button
              type="button"
              onClick={zoomOut}
              aria-label="Zoom out"
              disabled={disabled}
              className="sat-touch-target sat-tool-pressable grid place-items-center rounded sat-type-control-primary font-semibold text-[var(--sat-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-focus)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span aria-hidden="true">−</span>
            </button> : null}
            <span className="sat-type-metadata min-w-11 text-center tabular-nums text-[var(--sat-text)]" aria-hidden="true" style={{ minWidth: viewportToLogicalLength(44) }}>
              {atFit && !needsScroll ? "Fit" : `${Math.round(physicalScale * 100)}%`}
            </span>
            {physicalScale < SAT_REFERENCE_ZOOM_MAX ? <button
              type="button"
              onClick={zoomIn}
              aria-label="Zoom in"
              disabled={disabled}
              className="sat-touch-target sat-tool-pressable grid place-items-center rounded sat-type-control-primary font-semibold text-[var(--sat-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-focus)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span aria-hidden="true">+</span>
            </button> : <span className="sat-type-metadata text-[var(--sat-text-secondary)]">Maximum zoom</span>}
          </div>
        </div>
        <div className="sr-only" role="status">
          {zoomAnnouncement}
        </div>
        {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- Scroll region has zoom buttons and Ctrl/Cmd keyboard equivalents for double-click. */}
        <div
          data-sat-tool-scroll
          ref={attachStage}
          onScroll={handleScroll}
          onDoubleClick={() => { if (!disabled) { if (atFit) zoomToMax(); else fitSheet(); } }}
          tabIndex={disabled ? -1 : 0}
          role="region"
          aria-label="Reference sheet content"
          className="min-h-0 flex-1"
          style={{ overflow: "auto", touchAction: "pan-x pan-y pinch-zoom" }}
        >
          <SatReferenceSheet
            viewportWidth={viewportWidth ?? SAT_REFERENCE_VIEWPORT_FALLBACK_WIDTH}
            stageWidth={viewportWidth ?? SAT_REFERENCE_VIEWPORT_FALLBACK_WIDTH}
            stageHeight={stageH}
            zoom={zoom}
            examScale={examScale}
          />
        </div>
      </div>
    </SatFloatingTool>
    </div>
  );
}
