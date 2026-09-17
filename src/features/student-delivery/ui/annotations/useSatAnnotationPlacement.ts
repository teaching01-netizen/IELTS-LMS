import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { SatTextAnchor } from '../../domain/satResponses';
import {
  hiddenSatAnnotationPlacement,
  placeSatAnnotationDock,
  placeSatAnnotationSurface,
  satAnnotationAnchorGeometryFor,
  SAT_ANNOTATION_BUDGET_DEFAULTS,
  type AnnotationPlacement,
  type SatAnnotationBudgets,
  type SatRectLike,
} from './satSelectionGeometry';

/** Fallback sizes used before the element has been measured (and in jsdom). */
const DOCK_SIZE: SatRectLike = { left: 0, top: 0, width: 320, height: 168 };

/**
 * Where a surface goes when the DOM cannot be measured (jsdom, a headless
 * renderer, an element that has not laid out yet). Held at the container's
 * top-left inset: a guess, but a reachable one, and it keeps the controls
 * operable instead of leaving a student with a hidden toolbar.
 */
const UNMEASURABLE_INSET = 8;

/** Mirror of `--sat-annotation-settle`, used when the token is unreadable. */
const SETTLE_FALLBACK_SECONDS = 0.08;

function readCssNumber(style: CSSStyleDeclaration | null, variable: string, fallback: number): number {
  if (!style) return fallback;
  const parsed = Number.parseFloat(style.getPropertyValue(variable));
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return parsed;
}

function rootStyle(): CSSStyleDeclaration | null {
  try {
    if (typeof document === 'undefined' || typeof getComputedStyle !== 'function') return null;
    return getComputedStyle(document.documentElement);
  } catch {
    return null;
  }
}

/**
 * The placement budget for this environment: the token sheet first, the
 * compiled-in defaults only as a fallback. Reading one `CSSStyleDeclaration`
 * and pulling every value from it keeps this to a single style resolution per
 * placement, never one per number.
 */
export function readSatAnnotationBudgets(): SatAnnotationBudgets {
  const style = rootStyle();
  const defaults = SAT_ANNOTATION_BUDGET_DEFAULTS;
  return {
    edge: readCssNumber(style, '--sat-annotation-edge', defaults.edge),
    nativeUiZone: readCssNumber(style, '--sat-annotation-native-ui-zone', defaults.nativeUiZone),
    gap: readCssNumber(style, '--sat-annotation-gap', defaults.gap),
    comfort: readCssNumber(style, '--sat-annotation-comfort', defaults.comfort),
    comfortFine: readCssNumber(style, '--sat-annotation-comfort-fine', defaults.comfortFine),
    surfaceMin: readCssNumber(style, '--sat-annotation-surface-min', defaults.surfaceMin),
    selectionRatio: readCssNumber(style, '--sat-annotation-selection-ratio', defaults.selectionRatio),
    caretInset: readCssNumber(style, '--sat-annotation-caret-inset', defaults.caretInset),
    switchMargin: readCssNumber(style, '--sat-annotation-switch-margin', defaults.switchMargin),
    stableDelta: readCssNumber(style, '--sat-annotation-stable-delta', defaults.stableDelta),
  };
}

function readCssSeconds(variable: string, fallback: number): number {
  const raw = rootStyle()?.getPropertyValue(variable) ?? '';
  const parsed = Number.parseFloat(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return parsed / 1000;
}

/**
 * The region the surface must stay inside: the VISUAL viewport, not the layout
 * viewport. Pinch zoom, a software keyboard, and Safari's own chrome all shrink
 * what the student can actually see, and a toolbar placed against the layout
 * viewport can end up under the keyboard or off the zoomed-in view entirely.
 */
function visualViewportRect(): SatRectLike {
  if (typeof window === 'undefined') return { left: 0, top: 0, width: 1024, height: 768 };
  const viewport = window.visualViewport;
  if (!viewport) return { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
  return { left: viewport.offsetLeft, top: viewport.offsetTop, width: viewport.width, height: viewport.height };
}

/**
 * The surface's positioning container, measured. Falls back to the visual
 * viewport when the body has not laid out, so the budget is still evaluated
 * against something real.
 */
function boundsRectFor(container: HTMLElement | null): SatRectLike {
  const element = container?.closest<HTMLElement>('[data-sat-annotation-bounds]') ?? null;
  const rect = element?.getBoundingClientRect();
  if (rect && rect.width > 0 && rect.height > 0) {
    return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
  }
  return visualViewportRect();
}

export interface SatAnnotationPlacementOptions {
  /**
   * Force the dock. Only for layouts that are docked by contract (tests,
   * embedded chrome); the exam shell asks for `floating` and lets the space
   * budget decide, which is the whole point of the engine.
   */
  dock?: boolean | undefined;
  /**
   * Coarse pointer. It never chooses the presentation — it widens the budget,
   * because the native selection menu needs a zone of its own on touch and
   * nothing needs one under a mouse.
   */
  touch?: boolean | undefined;
}

/**
 * Position the contextual annotation surface against the live selection, and
 * keep it there while the student scrolls, resizes, drags a selection handle,
 * rotates the device, or the on-screen keyboard moves the visual viewport.
 *
 * Three behaviours this hook is responsible for, and nowhere else:
 *
 * - COALESCING. Scroll, resize and visual-viewport events arrive in bursts;
 *   each one schedules at most one animation frame, so a drag or a Safari
 *   auto-scroll never issues a state write per event.
 * - HYSTERESIS. The last decision is fed back into the engine, so a side is
 *   chosen once and kept until it genuinely stops fitting. A new selection (a
 *   new `anchor` identity) forgets it, because that is a new decision.
 * - SETTLING. An orientation change hides the surface, waits out
 *   `--sat-annotation-settle`, then places it again from scratch — the surface
 *   never travels from its old coordinates to its new ones.
 *
 * Degrades instead of disappearing: when the anchor cannot be measured it falls
 * back to the container's top-left inset so the controls stay reachable — the
 * annotation action must never become unreachable because geometry failed.
 */
export function useSatAnnotationPlacement(
  anchor: SatTextAnchor | null,
  options: SatAnnotationPlacementOptions = {},
): {
  placement: AnnotationPlacement | null;
  containerRef: React.RefObject<HTMLDivElement | null>;
  measure: () => void;
} {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [placement, setPlacement] = useState<AnnotationPlacement | null>(null);
  const previousRef = useRef<AnnotationPlacement | null>(null);
  const anchorRef = useRef<SatTextAnchor | null>(anchor);
  const frameRef = useRef<number | null>(null);
  const settleRef = useRef<number | null>(null);
  /** True while the viewport is known to be lying (mid-rotation). */
  const heldRef = useRef(false);
  const dock = options.dock === true;
  const touch = options.touch === true;

  const measure = useCallback(() => {
    if (heldRef.current) {
      // The viewport is moving and its reported geometry is transitional.
      // Placing from it would park the surface somewhere the student is about
      // to stop looking at. Stay hidden until the hold lifts.
      setPlacement(hiddenSatAnnotationPlacement());
      return;
    }
    const container = containerRef.current;
    const measured =
      container && container.offsetWidth > 0 && container.offsetHeight > 0
        ? { width: container.offsetWidth, height: container.offsetHeight }
        : null;
    const bounds = boundsRectFor(container);

    if (dock) {
      const next = placeSatAnnotationDock(
        bounds,
        measured ?? { width: DOCK_SIZE.width, height: DOCK_SIZE.height },
        readSatAnnotationBudgets().edge,
      );
      previousRef.current = next;
      setPlacement(next);
      return;
    }

    if (!anchor) {
      previousRef.current = null;
      setPlacement(null);
      return;
    }

    const geometry = satAnnotationAnchorGeometryFor(anchor);
    if (!geometry || !measured) {
      // Unmeasurable: stay visible in the preferred mode rather than vanish or
      // guess a position from nothing. Deliberately NOT recorded as the previous
      // placement — it is not a decision, and it must not steer hysteresis.
      setPlacement({ mode: 'floating', left: UNMEASURABLE_INSET, top: UNMEASURABLE_INSET, side: null, arrowX: 0, flipped: false, animated: false });
      return;
    }

    const next = placeSatAnnotationSurface({
      anchor: geometry,
      bounds,
      viewport: visualViewportRect(),
      size: measured,
      previous: previousRef.current,
      touch,
      budgets: readSatAnnotationBudgets(),
    });
    previousRef.current = next;
    setPlacement(next);
  }, [anchor, dock, touch]);

  // The settle timer outlives any single subscription: a rotation hold must not
  // be cancelled by a re-render, and when it lifts it has to place the selection
  // that is live NOW. So it calls through the latest measurement rather than a
  // closure captured when it was armed.
  const measureRef = useRef(measure);
  measureRef.current = measure;

  // Layout effect, not an animation frame: the surface is placed in the same
  // commit that mounts it, so it is never briefly unplaced (and never briefly
  // invisible to a student who just selected text).
  useLayoutEffect(() => {
    if (anchorRef.current !== anchor) {
      anchorRef.current = anchor;
      // A different selection gets a different decision; the last one's side is
      // history, not a preference.
      previousRef.current = null;
    }
    if (!anchor) {
      previousRef.current = null;
      setPlacement(null);
      return;
    }
    measure();
  }, [anchor, measure]);

  useEffect(() => {
    if (!anchor) return;
    const schedule = () => {
      if (typeof window === 'undefined') return;
      if (typeof window.requestAnimationFrame !== 'function') {
        measure();
        return;
      }
      if (frameRef.current !== null) return;
      frameRef.current = window.requestAnimationFrame(() => {
        frameRef.current = null;
        measure();
      });
    };
    const onOrientationChange = () => {
      // Rotation swaps both axes and the browser reports the new ones for a few
      // frames. Hide immediately and HOLD, because those frames arrive as
      // `visualViewport` resizes: without the hold, the first of them would
      // place the surface from geometry that is about to stop being true, and
      // the student would watch it flick from side to side while the device
      // turns. When the hold lifts, the placement is fresh and unanimated.
      heldRef.current = true;
      previousRef.current = null;
      setPlacement(hiddenSatAnnotationPlacement());
      if (typeof window === 'undefined' || typeof window.setTimeout !== 'function') return;
      if (settleRef.current !== null) window.clearTimeout(settleRef.current);
      settleRef.current = window.setTimeout(() => {
        settleRef.current = null;
        heldRef.current = false;
        measureRef.current();
      }, readCssSeconds('--sat-annotation-settle', SETTLE_FALLBACK_SECONDS) * 1000);
    };

    const viewport = window.visualViewport;
    window.addEventListener('resize', schedule);
    window.addEventListener('orientationchange', onOrientationChange);
    viewport?.addEventListener('resize', schedule);
    viewport?.addEventListener('scroll', schedule);
    document.addEventListener('scroll', schedule, true);
    return () => {
      window.removeEventListener('resize', schedule);
      window.removeEventListener('orientationchange', onOrientationChange);
      viewport?.removeEventListener('resize', schedule);
      viewport?.removeEventListener('scroll', schedule);
      document.removeEventListener('scroll', schedule, true);
      if (frameRef.current !== null && typeof window.cancelAnimationFrame === 'function') {
        window.cancelAnimationFrame(frameRef.current);
      }
      frameRef.current = null;
    };
  }, [anchor, measure]);

  // Unmount is the one place a pending settle is abandoned instead of served:
  // nothing is left to place, and a hold has no owner to release it.
  useEffect(() => () => {
    if (frameRef.current !== null && typeof window.cancelAnimationFrame === 'function') {
      window.cancelAnimationFrame(frameRef.current);
    }
    if (settleRef.current !== null) window.clearTimeout(settleRef.current);
    frameRef.current = null;
    settleRef.current = null;
    heldRef.current = false;
  }, []);

  return { placement, containerRef, measure };
}

/**
 * Focus the first actionable control of annotation chrome, exactly once per
 * anchor, and only after placement has landed.
 *
 * Order matters and is the whole reason this is shared: the chrome mounts with
 * `visibility: hidden` for one commit while it is measured, and `focus()` on a
 * hidden element is silently ignored — so focusing on mount does nothing at all
 * and the toolbar's keyboard affordance quietly disappears (the anchor never
 * changes, so a mount-keyed effect never gets a second chance). A placement that
 * is deliberately hidden (the anchor scrolled away, the viewport is rotating)
 * waits for the same reason.
 *
 * `skip` is for chrome that holds a field the student just asked for: the caret
 * belongs in that field, and a later placement commit must not pull it back onto
 * the first button.
 */
export function useSatAnnotationAutofocus(
  placement: AnnotationPlacement | null,
  anchorKey: string,
  containerRef: React.RefObject<HTMLElement | null>,
  options: { skip?: boolean } = {},
): void {
  const focusedRef = useRef<string | null>(null);
  const skip = options.skip === true;
  useEffect(() => {
    if (skip || !placement || placement.mode === 'hidden' || focusedRef.current === anchorKey) return;
    focusedRef.current = anchorKey;
    // Dismissals are skipped: the way out is not a way in, and landing the caret
    // on "close" would make the first keystroke after selecting text undo the
    // tools instead of using them.
    containerRef.current
      ?.querySelector<HTMLButtonElement>('button:not([disabled]):not([data-sat-annotation-dismiss])')
      ?.focus({ preventScroll: true });
  }, [anchorKey, containerRef, placement, skip]);
}
