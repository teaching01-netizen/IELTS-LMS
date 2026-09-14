import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  SAT_REFERENCE_TOOLBAR_HEIGHT,
} from "../../domain/satToolSizePolicy";
import { placeSatTool } from "../../domain/satToolPlacement";
import {
  readSatToolSafeArea,
  readSatToolViewport,
} from "./satToolPlacementRuntime";
import {
  SAT_REFERENCE_VIEWPORT_FALLBACK_HEIGHT,
  SAT_REFERENCE_VIEWPORT_FALLBACK_WIDTH,
  useSatReferenceStageSize,
} from "./useSatReferenceViewportWidth";
import {
  isSatRefAtFit,
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

export const SAT_REFERENCE_ZOOM_MIN = 0.75;
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
  return Math.min(SAT_REFERENCE_ZOOM_MAX, Math.max(SAT_REFERENCE_ZOOM_MIN, numeric));
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
): SatToolGeometry {
  const size = resolveSatReferenceDefaultGeometry(viewport, safeArea);
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
  return clampSatToolGeometry({ ...chosen, w: size.w, h: size.h }, viewport, safeArea);
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
  const geometryKey = satToolGeometryKey(scheduleId, attemptId, moduleAttemptId, "reference");
  const viewKey = satReferenceViewKey(scheduleId, attemptId, moduleAttemptId);
  const scrollRef = useRef<HTMLDivElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  // R-04 Step 6.4 — collapsed/scaleMode state init from the adapter;
  // moved/resized are refs (they gate logic, not render) except where the
  // R-03 controlled prop contract needs a re-render (collapsed threads
  // through <SatFloatingTool collapsed onToggleCollapse>).
  const [zoom, setZoom] = useState<number>(() => readSatReferenceViewState(viewKey).zoom);
  const [collapsed, setCollapsed] = useState<boolean>(
    () => readSatReferenceViewState(viewKey).collapsed,
  );
  const [scaleMode, setScaleMode] = useState<SatReferenceScaleMode>(
    () => readSatReferenceViewState(viewKey).scaleMode,
  );
  const movedRef = useRef<boolean>(readSatReferenceViewState(viewKey).hasBeenMoved);
  const resizedRef = useRef<boolean>(readSatReferenceViewState(viewKey).hasBeenResized);
  // Resolve first-open geometry before measuring the stage so the initial
  // render has a safe, proportional fit seed instead of the 1000x560
  // canonical canvas size. useLayoutEffect replaces the seed with the real
  // content box before paint; ResizeObserver keeps it current thereafter.
  const defaultGeometry = useMemo<SatToolGeometry>(() => {
    if (typeof window === "undefined") return fallbackSatReferenceGeometry();
    try {
      return defaultSatReferenceGeometry(readSatToolViewport(), readSatToolSafeArea());
    } catch {
      return fallbackSatReferenceGeometry();
    }
  }, []);
  const initialStageSize = useMemo(
    () => ({
      w: defaultGeometry.w,
      h: Math.max(
        1,
        defaultGeometry.h - SAT_REFERENCE_HEADER_HEIGHT - SAT_REFERENCE_TOOLBAR_HEIGHT,
      ),
    }),
    [defaultGeometry],
  );
  // The scroll node is the stage. A proportional seed prevents first-frame
  // crop when the ref does not exist during the state initializer.
  const stage = useSatReferenceStageSize(scrollRef, initialStageSize);
  const viewportWidth = stage.w;
  const stageH = collapsed ? SAT_REFERENCE_VIEWPORT_FALLBACK_HEIGHT : stage.h;
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
    // First mount seeds the refs from storage; later open flips preserve
    // flags already committed this session (system clamps never clear them).
    movedRef.current = movedRef.current || restored.hasBeenMoved;
    resizedRef.current = resizedRef.current || restored.hasBeenResized;
    setZoom((current) => (current === restored.zoom ? current : restored.zoom));
    setScaleMode((current) => (current === restored.scaleMode ? current : restored.scaleMode));
    // Collapse->expand restores exactly (position/width/scroll/zoom
    // retained; height returns to the pre-collapse value because collapse
    // never persists geometry.h — Step 5 contract with R-03).
    setCollapsed((current) => (current === restored.collapsed ? current : restored.collapsed));
    if (open && typeof window !== "undefined") {
      try {
        const viewport = readSatToolViewport();
        const safeArea = readSatToolSafeArea();
        const savedGeom = loadSatToolGeometry(geometryKey);
        if (savedGeom) {
          let geom = clampSatToolGeometry(savedGeom, viewport, safeArea);
          // Step-5e one-time pre-R-04 migration (only when the flags
          // disagree — covers pre-R-04 rects predating D3 sizes/left-edge
          // x = 48; documented approximation, legacy records carry no flags).
          if (!restored.hasBeenResized && (savedGeom.w < 480 || savedGeom.h < 320)) {
            const fresh = resolveSatReferenceDefaultGeometry(viewport, safeArea);
            geom = clampSatToolGeometry({ ...geom, w: fresh.w, h: fresh.h }, viewport, safeArea);
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
            geom = clampSatToolGeometry({ ...geom, ...fresh }, viewport, safeArea);
          }
          saveSatToolGeometry(geometryKey, geom);
        }
      } catch {
        /* never block the exam */
      }
      // R-07 Step 4 — persisted scrollTop ignored at fit: the open-restore
      // writes 0 when the fitted sheet has nothing to scroll (zoomed sheets
      // restore the anchor as today). The sanitized stage state feeds the
      // pure fn (never raw node dims: jsdom/degen nodes read 0, which the
      // fn guards to 1 and would misreport zoomed sheets as at-fit). Store
      // keeps the persisted value; render enforces the fit floor.
      const atFitRestore = isSatRefAtFit(stage.w, restored.zoom, stageH);
      const applyScroll = () => {
        if (scrollRef.current) scrollRef.current.scrollTop = atFitRestore ? 0 : restored.scrollTop;
      };
      if (typeof window.requestAnimationFrame === "function") {
        window.requestAnimationFrame(applyScroll);
      } else {
        applyScroll();
      }
    }
  }, [viewKey, open, geometryKey, stage.w, stageH]);

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
        setZoomAnnouncement(`Zoom ${Math.round(clamped * 100)} percent`);
      }
    },
    [persistZoom],
  );

  const zoomIn = useCallback(() => applyZoom(zoom + SAT_REFERENCE_ZOOM_STEP, { announce: true }), [applyZoom, zoom]);
  const zoomOut = useCallback(() => applyZoom(zoom - SAT_REFERENCE_ZOOM_STEP, { announce: true }), [applyZoom, zoom]);
  // R-07 Step 4 — "Fit width" becomes "Fit sheet": zoom back to fit (the
  // floor) and clear the zoomed-pan scroll to 0. Handler keeps the applyZoom
  // persist path; the scroll node resets on the next frame after zoom state
  // commits (setZoom is async, so reset here would race the re-render).
  const fitSheet = useCallback(() => {
    applyZoom(1, { announce: true });
    if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
      window.requestAnimationFrame(() => {
        if (scrollRef.current) scrollRef.current.scrollTop = 0;
      });
    } else if (scrollRef.current) {
      scrollRef.current.scrollTop = 0;
    }
  }, [applyZoom]);

  const handleScroll = useCallback(() => {
    const node = scrollRef.current;
    if (!node) return;
    // R-04 Step 6.6 — scroll persist extended with the merged write
    // (read-modify-write preserves collapsed/scaleMode/flags + the
    // hint-family fields on the :reference-suffixed record).
    writeSatReferenceViewState(viewKey, { zoom, scrollTop: node.scrollTop });
  }, [viewKey, zoom]);

  const markManualMove = useCallback(() => {
    movedRef.current = true;
    writeSatReferenceViewState(viewKey, { hasBeenMoved: true });
  }, [viewKey]);

  const markManualResize = useCallback(() => {
    resizedRef.current = true;
    writeSatReferenceViewState(viewKey, { hasBeenResized: true });
  }, [viewKey]);

  // R-04 Step 4 — viewport-change clamp path (clamp only, never reset;
  // collapsed path re-applies collapse at render via collapsedEffective).
  // A rAF-batched resize listener re-clamps the authoritative rect (stored
  // geometry while open) through the 3-arg safe-area clamp and re-persists
  // through the primitive pipeline — system-caused, so hasBeenMoved /
  // hasBeenResized stay untouched; collapsed re-clamps the restored
  // (pre-collapse) rect, never the collapsed height. The shell observer
  // below mirrors USER drag/resize commits into the merged flag pipeline.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!open) return;
    let frame: number | null = null;
    const onResize = () => {
      if (frame !== null) return;
      const schedule =
        typeof window.requestAnimationFrame === "function"
          ? window.requestAnimationFrame.bind(window)
          : (callback: FrameRequestCallback): number => {
              callback(0);
              return 0;
            };
      frame = schedule(() => {
        frame = null;
        try {
          const viewport = readSatToolViewport();
          const safeArea = readSatToolSafeArea();
          const current = loadSatToolGeometry(geometryKey);
          if (!current) return;
          const next = clampSatToolGeometry(current, viewport, safeArea);
          if (next.x !== current.x || next.y !== current.y || next.w !== current.w || next.h !== current.h) {
            saveSatToolGeometry(geometryKey, next);
          }
          // Scroll anchor re-asserted post-settle (value already in store).
          const anchor = readSatReferenceViewState(viewKey).scrollTop;
          if (scrollRef.current && scrollRef.current.scrollTop !== anchor) {
            scrollRef.current.scrollTop = anchor;
          }
        } catch {
          /* never block the exam */
        }
      });
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [open, viewKey, geometryKey]);

  // The primitive's own geometry state is the commit surface (its dialog
  // node carries left/top/width/height in style); this observer mirrors its
  // committed rect into the merged view-store flag pipeline: a size change
  // commits hasBeenResized, a position change commits hasBeenMoved
  // (R-03 markHintSeen sites double as the set-points — extended, never
  // duplicated). System clamps never invent flags on their own — flags
  // flip only when the observed committed rect actually differs along that
  // axis family. Collapsed renders at header height while the stored h
  // always means restored height, so h-deltas observed while collapsed are
  // R-03 render artifacts and never set hasBeenResized.
  // NOTE: the clamp-on-viewport-change path (Step 4 effect above) re-saves
  // the folded rect through saveSatToolGeometry, which does NOT touch the
  // dialog style observed here — so system clamps never trip this
  // user-gesture flag pipeline. Only primitive-committed style changes
  // (drag/resize/arrow-key commits via persist) reach this observer.
  useEffect(() => {
    if (typeof window === "undefined" || typeof MutationObserver === "undefined") return;
    if (!open) return;
    const shell = shellRef.current;
    if (!shell) return;
    // The wrapper uses display:contents (never a style-mutation source);
    // observe the primitive dialog node, which commits geometry to style.
    const target =
      shell.querySelector<HTMLElement>(`[data-sat-tool-window="Reference Sheet"]`) ?? shell;
    const snapshot = (style: CSSStyleDeclaration): SatToolGeometry | null => {
      const x = Number.parseFloat(style.left || "");
      const y = Number.parseFloat(style.top || "");
      const w = Number.parseFloat(style.width || "");
      const h = Number.parseFloat(style.height || "");
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(w) || !Number.isFinite(h)) {
        return null;
      }
      return { x, y, w, h };
    };
    // Baseline AFTER the primitive settles: the deferred load effect
    // (saved-wins clamp) commits post-mount, so snapshot the CURRENT
    // committed rect after mount settles (rAF) — otherwise the initial
    // saved-load clamp trips the user-gesture pipeline (system clamp
    // misread as a drag). The rAF callback runs after the primitive load
    // effect, so the folded rect is the baseline; mutations after that
    // are user commits.
    let last: SatToolGeometry | null = null;
    let settled = false;
    const settleBaseline = () => {
      if (settled) return;
      settled = true;
      last = snapshot(target.style);
    };
    if (typeof window.requestAnimationFrame === "function") {
      window.requestAnimationFrame(settleBaseline);
    } else {
      settleBaseline();
    }
    const commitFlags = (next: SatToolGeometry, prev: SatToolGeometry): void => {
      const moved = next.x !== prev.x || next.y !== prev.y;
      // While collapsed the shell renders at header height: ignore h
      // (collapse chrome), but still honor w (retargeted resizes persist).
      const resized = collapsedRef.current
        ? next.w !== prev.w
        : next.w !== prev.w || next.h !== prev.h;
      if (!moved && !resized) return;
      if (moved) movedRef.current = true;
      if (resized) resizedRef.current = true;
      writeSatReferenceViewState(viewKey, {
        ...(moved ? { hasBeenMoved: true as const } : null),
        ...(resized ? { hasBeenResized: true as const } : null),
      });
    };
    const observer = new MutationObserver(() => {
      // A system settle racing ahead of the rAF baseline must not trip
      // the user pipeline: first mutation only establishes the baseline.
      if (!settled) {
        settled = true;
        last = snapshot(target.style);
        return;
      }
      const next = snapshot(target.style);
      if (!next) return;
      const prev = last;
      last = next;
      if (!prev) return;
      commitFlags(next, prev);
    });
    observer.observe(target, { attributes: true, attributeFilter: ["style"] });
    return () => observer.disconnect();
  }, [open, viewKey]);

  // Bluebook floating tool: resizable + draggable through the shared shell
  // (C11 parity with Calculator). Geometry persists per module-attempt via
  // the geometry key; zoom + scrollTop persist via the Phase-02 view-state
  // store through the adapter above (same key family and shape).
  // R-06 Step 1 (B1) — Reference maxSize (D1 Reference-only): without it the
  // primitive falls back to 620/48vw and the first resize snaps narrower.
  // Single-sourced from the Reference policy row; window-guarded like above.
  const referenceMaxSize = useMemo<{ w: number; h: number }>(() => {
    if (typeof window === "undefined") return resolveSatToolMaxSize("reference", { w: 1248, h: 602 });
    try {
      const viewport = readSatToolViewport();
      const safeArea = readSatToolSafeArea();
      return resolveSatToolMaxSize("reference", {
        w: viewport.w - safeArea.left - safeArea.right,
        h: viewport.h - safeArea.top - safeArea.bottom,
      });
    } catch {
      return resolveSatToolMaxSize("reference", { w: 1248, h: 602 });
    }
  }, []);
  // R-07 Step 4 — overflow-hidden-at-fit switch via the exported pure
  // fn (no scale duplication): fit = satRefFitScale(w, 1, h),
  // render = satRefFitScale(w, zoom, h). At fit (render <= fit + epsilon)
  // the stage hides overflow (no scrollbar flash, no jitter); zoomed past
  // fit it pans both axes. Zoom toolbar otherwise UNCHANGED. Compact
  // branch: bottom sheet, no drag/resize — collapse is desktop-only (R-03
  // masks it); R-04 adds no compact logic.
  // R-07 Step 4 — overflow-hidden-at-fit switch via the exported pure
  // fn (no scale duplication): fit = satRefFitScale(w, 1, h),
  // render = satRefFitScale(w, zoom, h). At fit (render <= fit + epsilon)
  // the stage hides overflow (no scrollbar flash, no jitter); zoomed past
  // fit it pans both axes. Zoom toolbar otherwise UNCHANGED.
  const atFit = isSatRefAtFit(viewportWidth, zoom, stageH);
  const zoomOutDisabled = disabled || zoom <= 1;
  return (
    <div ref={shellRef} data-sat-reference-shell style={{ display: "contents" }}>
    <SatFloatingTool
      title="Reference Sheet"
      open={open}
      geometryKey={geometryKey}
      viewStateKey={satToolViewKey(scheduleId, attemptId, moduleAttemptId)}
      defaultGeometry={defaultGeometry}
      minSize={SAT_REFERENCE_MIN_SIZE}
      maxSize={referenceMaxSize}
      resizable
      disabled={disabled}
      onManualMove={markManualMove}
      onManualResize={markManualResize}
      collapsed={collapsed}
      onToggleCollapse={handleToggleCollapse}
      onClose={onClose}
    >
      <div className="flex h-full min-h-0 flex-col bg-[var(--sat-surface)]">
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-[var(--sat-divider-soft)] px-3 py-1">
          <button
            type="button"
            onClick={fitSheet}
            aria-label="Fit sheet"
            disabled={disabled}
            className="sat-touch-target sat-tool-pressable rounded px-2 sat-type-control-secondary font-semibold text-[var(--sat-text-secondary)] hover:text-[var(--sat-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-focus)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            Fit sheet
          </button>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={zoomOut}
              aria-label="Zoom out"
              disabled={zoomOutDisabled}
              title={zoomOutDisabled && !disabled ? "The sheet already fits the window" : undefined}
              className="sat-touch-target sat-tool-pressable grid place-items-center rounded sat-type-control-primary font-semibold text-[var(--sat-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-focus)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span aria-hidden="true">−</span>
            </button>
            <span className="sat-type-metadata min-w-11 text-center tabular-nums text-[var(--sat-text)]" aria-hidden="true">
              {Math.round(zoom * 100)}%
            </span>
            <button
              type="button"
              onClick={zoomIn}
              aria-label="Zoom in"
              disabled={disabled || zoom >= SAT_REFERENCE_ZOOM_MAX}
              className="sat-touch-target sat-tool-pressable grid place-items-center rounded sat-type-control-primary font-semibold text-[var(--sat-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-focus)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span aria-hidden="true">+</span>
            </button>
          </div>
        </div>
        <div className="sr-only" role="status">
          {zoomAnnouncement}
        </div>
        <div
          data-sat-tool-scroll
          ref={scrollRef}
          onScroll={handleScroll}
          className="min-h-0 flex-1"
          style={atFit ? { overflow: "hidden" } : { overflow: "auto" }}
        >
          <SatReferenceSheet
            viewportWidth={viewportWidth ?? SAT_REFERENCE_VIEWPORT_FALLBACK_WIDTH}
            stageWidth={viewportWidth ?? SAT_REFERENCE_VIEWPORT_FALLBACK_WIDTH}
            stageHeight={stageH}
            zoom={zoom}
          />
        </div>
      </div>
    </SatFloatingTool>
    </div>
  );
}
