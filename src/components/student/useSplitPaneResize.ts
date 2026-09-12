import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import {
  STUDENT_MIN_ANSWER_PANE_WIDTH_PX,
  STUDENT_MIN_MATERIAL_PANE_WIDTH_PX,
  STUDENT_SPLIT_RAIL_WIDTH_PX,
  scalePaneMinimumsForFontScale,
} from './layout/studentLayoutMode';
import {
  STUDENT_TABLET_SPLIT_DIVIDER_WIDTH_PX,
  STUDENT_TABLET_SPLIT_HIT_TARGET_WIDTH_PX,
} from './splitPaneDimensions';

/**
 * P2.4 — splitter geometry and gesture path.
 *
 * The split preference is a ratio of the usable pane width EXCLUDING the
 * rail. W = container width, R = rail width, U = W - R:
 *
 *   lower = max(0.32, minMaterialWidth / U)
 *   upper = min(0.68, 1 - minAnswerWidth / U)
 *   renderedRatio = clamp(preferredRatio, lower, upper)
 *   leftPixels = renderedRatio * U
 *   rightPixels = U - leftPixels
 *
 * `preferredRatio` stays distinct from `renderedRatio`: temporary narrow-
 * window clamping never destroys the preferred wide-window split. If U <= 0
 * or lower > upper, the hook reports an unsplittable workspace instead of
 * swapping impossible bounds.
 *
 * Gesture: one pointer path with pointer capture — pointerdown captures the
 * active pointer, pointermove schedules the current ratio, pointerup commits
 * it. pointercancel/lostpointercapture end the gesture safely with the last
 * valid layout. No document listeners are left behind on any exit path.
 * The persisted value is written at drag/keyboard completion, never on
 * every move.
 */

const PREFERRED_TRAVEL_MIN = 0.32;
const PREFERRED_TRAVEL_MAX = 0.68;
const DEFAULT_PREFERRED_RATIO = 0.5;

/**
 * Rendered split percentages snap to this grid (of the workspace). Pointer
 * drags derive ratios from pixel deltas, which rarely land on tidy values;
 * quantizing the RENDERED percentage keeps CSS/ARIA deterministic and stable
 * without disturbing the persisted preference (which stays exact so repeated
 * gestures do not accumulate drift).
 */
const RENDER_QUANTUM_PERCENT = 0.5;

function quantizePercent(percent: number, lowerPercent: number, upperPercent: number): number {
  if (!Number.isFinite(percent)) {
    return percent;
  }
  const snapped = Math.round(percent / RENDER_QUANTUM_PERCENT) * RENDER_QUANTUM_PERCENT;
  return Math.min(upperPercent, Math.max(lowerPercent, snapped));
}

export interface SplitRatioBounds {
  /** Lower rendered bound in [0,1]; null when the workspace cannot split. */
  lower: number | null;
  /** Upper rendered bound in [0,1]; null when the workspace cannot split. */
  upper: number | null;
  /** Usable width excluding the rail (px). */
  usableWidth: number;
}

export function computeSplitBounds(
  containerWidth: number,
  railWidth: number,
  minMaterialWidth: number,
  minAnswerWidth: number,
): SplitRatioBounds {
  const usableWidth = containerWidth - railWidth;
  if (!Number.isFinite(containerWidth) || usableWidth <= 0) {
    return { lower: null, upper: null, usableWidth: Math.max(0, usableWidth) };
  }
  const lower = Math.max(PREFERRED_TRAVEL_MIN, minMaterialWidth / usableWidth);
  const upper = Math.min(PREFERRED_TRAVEL_MAX, 1 - minAnswerWidth / usableWidth);
  if (lower > upper) {
    return { lower: null, upper: null, usableWidth };
  }
  return { lower, upper, usableWidth };
}

export function renderSplitRatio(preferredRatio: number, bounds: SplitRatioBounds): number | null {
  if (bounds.lower === null || bounds.upper === null) {
    return null;
  }
  const safePreferred = Number.isFinite(preferredRatio) ? preferredRatio : DEFAULT_PREFERRED_RATIO;
  return Math.min(bounds.upper, Math.max(bounds.lower, safePreferred));
}

// S1-C3: persist the split preference per attempt + module so a remount
// (tab switch, orientation change, re-render) restores the learner's layout
// instead of snapping back to the default. sessionStorage keeps it
// tab-scoped; values are clamped through the ratio bounds on load and
// malformed values fall back to the default.
function readPersistedSplitRatio(storageKey: string): number | null {
  try {
    const raw = sessionStorage.getItem(storageKey);
    if (raw == null) return null;
    const parsed = Number.parseFloat(raw);
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function persistSplitRatio(storageKey: string, value: number): void {
  try {
    sessionStorage.setItem(storageKey, String(value));
  } catch {
    // Storage may be unavailable (private mode, disabled cookies) — the
    // in-memory state still works; persistence is best-effort.
  }
}

interface UseSplitPaneResizeOptions {
  isTabletMode: boolean;
  materialPaneWidthProperty:
    | '--reading-pane-width'
    | '--listening-pane-width'
    | '--writing-prompt-pane-width'
    | '--science-pane-width';
  answerPaneWidthProperty?: '--question-pane-width' | '--writing-editor-pane-width';
  /** Initial preferred ratio in [0,1]; old persisted percentages are normalized once. */
  defaultLeftWidth?: number;
  dividerMode?: 'overlay' | 'consumes-space';
  /** P2.5: sessionStorage key scoped to attempt/version/module. Omit to disable. */
  persistenceKey?: string | undefined;
  /** Font scale (1 = normal) used to enlarge readable pane minimums. */
  fontScale?: number | undefined;
}

export function useSplitPaneResize({
  isTabletMode,
  materialPaneWidthProperty,
  answerPaneWidthProperty = '--question-pane-width',
  defaultLeftWidth = DEFAULT_PREFERRED_RATIO * 100,
  dividerMode = 'consumes-space',
  persistenceKey,
  fontScale = 1,
}: UseSplitPaneResizeOptions) {
  const workspaceRef = useRef<HTMLDivElement>(null);
  const dividerWidth = isTabletMode
    ? STUDENT_TABLET_SPLIT_DIVIDER_WIDTH_PX
    : STUDENT_SPLIT_RAIL_WIDTH_PX;
  const dividerConsumesSpace = dividerMode === 'consumes-space';

  const minMaterialWidth = scalePaneMinimumsForFontScale(STUDENT_MIN_MATERIAL_PANE_WIDTH_PX, fontScale);
  const minAnswerWidth = scalePaneMinimumsForFontScale(STUDENT_MIN_ANSWER_PANE_WIDTH_PX, fontScale);

  // Bounds come from the LIVE workspace rect on each render (one bounded
  // layout read, mirroring the historical clampWidth behavior). This keeps
  // CSS, ARIA, and pointer math on the same geometry and stays correct when
  // the container resizes without an observation round-trip. The window
  // width is the pre-mount fallback; a zero rect cannot produce bounds.
  const readContainerWidth = useCallback(() => {
    const width = workspaceRef.current?.getBoundingClientRect().width;
    if (width !== undefined && Number.isFinite(width) && width > 0) {
      return width;
    }
    return typeof window !== 'undefined' ? window.innerWidth : 0;
  }, []);

  // P2.5: read valid old preferences once, normalize units (percent → ratio),
  // and clamp. Old title-keyed percentages (0..100) are interpreted as ratios.
  const [preferredRatio, setPreferredRatio] = useState(() => {
    const fallback = defaultLeftWidth > 1 ? defaultLeftWidth / 100 : defaultLeftWidth;
    const persisted = persistenceKey ? readPersistedSplitRatio(persistenceKey) : null;
    if (persisted === null) {
      return Number.isFinite(fallback) ? Math.min(1, Math.max(0, fallback)) : DEFAULT_PREFERRED_RATIO;
    }
    const normalized = persisted > 1 ? persisted / 100 : persisted;
    return Number.isFinite(normalized) ? Math.min(1, Math.max(0, normalized)) : DEFAULT_PREFERRED_RATIO;
  });

  const bounds = useMemo(
    () =>
      computeSplitBounds(
        readContainerWidth(),
        dividerConsumesSpace ? dividerWidth : 0,
        minMaterialWidth,
        minAnswerWidth,
      ),
    // preferredRatio re-runs the read after drags/keyboard moves so ARIA and
    // the rendered split always describe the current container.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [preferredRatio, dividerConsumesSpace, dividerWidth, minMaterialWidth, minAnswerWidth, readContainerWidth],
  );

  const renderedRatio = renderSplitRatio(preferredRatio, bounds);
  const splittable = renderedRatio !== null;

  // P2.4: persist at drag/keyboard completion, not synchronously on every move.
  const commitPreferredRatio = useCallback(
    (nextRatio: number) => {
      setPreferredRatio(nextRatio);
      if (persistenceKey) {
        persistSplitRatio(persistenceKey, nextRatio);
      }
    },
    [persistenceKey],
  );

  // Gesture state lives in refs: no re-render per move, one write per frame.
  const dragStateRef = useRef<{
    pointerId: number | null;
    startClientX: number;
    startRatio: number;
    usableLeft: number;
    usableWidth: number;
    pendingRatio: number | null;
  } | null>(null);

  const endDrag = useCallback(() => {
    const drag = dragStateRef.current;
    if (!drag) return;
    if (drag.pendingRatio !== null) {
      commitPreferredRatio(drag.pendingRatio);
    }
    dragStateRef.current = null;
    if (typeof document !== 'undefined') {
      document.body.style.removeProperty('cursor');
      document.body.style.removeProperty('user-select');
    }
  }, [commitPreferredRatio]);

  useEffect(() => {
    // Cleanup on unmount covers any gesture still in flight.
    return () => {
      dragStateRef.current = null;
    };
  }, []);

  const handleDrag = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (dragStateRef.current) {
        return; // Ignore unrelated pointers while a gesture is active.
      }
      const workspaceRect = workspaceRef.current?.getBoundingClientRect();
      if (!workspaceRect || workspaceRect.width <= 0) {
        return;
      }
      const usableWidth = workspaceRect.width - (dividerConsumesSpace ? dividerWidth : 0);
      if (usableWidth <= 0) {
        return;
      }
      // Account for the grip offset so the divider does not jump on press:
      // the ratio is captured from the current rendered position, not the
      // pointer's raw position.
      const startRatio = renderedRatio ?? DEFAULT_PREFERRED_RATIO;
      dragStateRef.current = {
        pointerId: event.pointerId,
        startClientX: event.clientX,
        startRatio,
        usableLeft: workspaceRect.left,
        usableWidth,
        pendingRatio: null,
      };
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // Capture may fail on detached nodes; the move/up handlers on the
        // element still cover the common path and pointerup ends the drag.
      }
      // Temporary selection/cursor styles during the drag.
      if (typeof document !== 'undefined') {
        document.body.style.setProperty('cursor', 'col-resize');
        document.body.style.setProperty('user-select', 'none');
      }
    },
    [dividerConsumesSpace, dividerWidth, renderedRatio],
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragStateRef.current;
      if (!drag || drag.pointerId !== event.pointerId) {
        return;
      }
      const boundsNow = computeSplitBounds(
        drag.usableWidth + (dividerConsumesSpace ? dividerWidth : 0),
        dividerConsumesSpace ? dividerWidth : 0,
        minMaterialWidth,
        minAnswerWidth,
      );
      void boundsNow;
      const rendered = renderSplitRatio(drag.startRatio, boundsNow);
      if (rendered === null) {
        return;
      }
      const deltaRatio = (event.clientX - drag.startClientX) / drag.usableWidth;
      const nextRatio = Math.min(1, Math.max(0, rendered + deltaRatio));
      drag.pendingRatio = nextRatio;
      // Live layout update during the drag. Pointermove events already
      // arrive coalesced per frame in browsers, so a direct write is both
      // simpler and safe; the persisted preference is only written at drag
      // completion (endDrag).
      setPreferredRatio(nextRatio);
    },
    [dividerConsumesSpace, dividerWidth, minAnswerWidth, minMaterialWidth],
  );

  const handlePointerEnd = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragStateRef.current;
      if (!drag || drag.pointerId !== event.pointerId) {
        return;
      }
      endDrag();
    },
    [endDrag],
  );

  const handleKeyboardResize = useCallback(
    (event: React.KeyboardEvent) => {
      // Left/Right adjust 2%, Shift+arrow 5% (of the usable width).
      const baseStep = 0.02;
      const shiftStep = 0.05;
      const step = event.shiftKey ? shiftStep : baseStep;
      const keyDeltas: Record<string, number> = {
        ArrowLeft: -step,
        ArrowDown: -step,
        ArrowRight: step,
        ArrowUp: step,
      };
      const delta = keyDeltas[event.key];

      if (typeof delta === 'number') {
        event.preventDefault();
        commitPreferredRatio(Math.min(1, Math.max(0, (renderedRatio ?? DEFAULT_PREFERRED_RATIO) + delta)));
        return;
      }

      if (event.key === 'Home') {
        event.preventDefault();
        if (bounds.lower !== null) {
          commitPreferredRatio(bounds.lower);
        }
        return;
      }

      if (event.key === 'End') {
        event.preventDefault();
        if (bounds.upper !== null) {
          commitPreferredRatio(bounds.upper);
        }
      }
    },
    [bounds.lower, bounds.upper, commitPreferredRatio, renderedRatio],
  );

  // P2.4: keyboard-free resize alternatives for users who cannot drag
  // (visible-on-focus menu in the resizer). Same clamp/commit path as the
  // keyboard handler; menu actions move 5% per activation.
  const adjustSplitByStep = useCallback(
    (direction: -1 | 1, large: boolean) => {
      const step = large ? 0.05 : 0.02;
      commitPreferredRatio(
        Math.min(1, Math.max(0, (renderedRatio ?? DEFAULT_PREFERRED_RATIO) + direction * step)),
      );
    },
    [commitPreferredRatio, renderedRatio],
  );
  const resetSplit = useCallback(() => {
    commitPreferredRatio(DEFAULT_PREFERRED_RATIO);
  }, [commitPreferredRatio]);
  const resizeCommands = useMemo(
    () => ({
      narrower: () => adjustSplitByStep(-1, true),
      wider: () => adjustSplitByStep(1, true),
      reset: resetSplit,
    }),
    [adjustSplitByStep, resetSplit],
  );

  // Legacy %-style value for consumers (ARIA, compaction heuristics).
  // Quantized + re-clamped so CSS, ARIA, and the readout share one value.
  const leftWidth =
    renderedRatio === null
      ? defaultLeftWidth
      : quantizePercent(
          renderedRatio * 100,
          bounds.lower === null ? 0 : bounds.lower * 100,
          bounds.upper === null ? 100 : bounds.upper * 100,
        );

  // S1-C2: real pixel-clamp range expressed in % for the slider semantics.
  // Mirrors the bounds math so aria-valuemin/max/now always reflect the
  // actual draggable range for the current container width.
  const splitBounds = useMemo(
    () => ({
      min: bounds.lower === null ? 0 : Math.round(bounds.lower * 1000) / 10,
      max: bounds.upper === null ? 100 : Math.round(bounds.upper * 1000) / 10,
      unsplittable: !splittable,
    }),
    [bounds.lower, bounds.upper, splittable],
  );

  const splitPaneStyle = useMemo(() => {
    if (renderedRatio === null) {
      return {
        ['--split-divider-width' as string]: `${dividerWidth}px`,
      } as CSSProperties;
    }
    const leftPercent = leftWidth;
    const rightPercent = 100 - leftPercent;
    return {
      [materialPaneWidthProperty]: `${leftPercent}%`,
      [answerPaneWidthProperty]: dividerConsumesSpace
        ? `calc(${rightPercent}% - var(--split-divider-width))`
        : `calc(${rightPercent}%)`,
      ['--split-divider-width' as string]: `${dividerWidth}px`,
    } as CSSProperties;
  }, [
    answerPaneWidthProperty,
    dividerConsumesSpace,
    dividerWidth,
    leftWidth,
    materialPaneWidthProperty,
  ]);

  const answerWidth = 100 - leftWidth;
  const materialCompact = isTabletMode ? leftWidth < 46 : leftWidth < 38;
  const answerCompact = isTabletMode ? answerWidth < 50 : answerWidth < 40;

  return {
    answerCompact,
    handleDrag,
    handlePointerMove,
    handlePointerEnd,
    handleKeyboardResize,
    leftWidth,
    materialCompact,
    resizeCommands,
    splitBounds,
    splitPaneStyle,
    splittable,
    workspaceRef,
  };
}

/** Hit-target width exported for the resizer component (touch ≥44px). */
export { STUDENT_TABLET_SPLIT_HIT_TARGET_WIDTH_PX };
