import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { SatTextAnchor } from '../../domain/satResponses';
import { readSatAnnotationBudgets, readSatAnnotationSeconds } from './satAnnotationBudgets';
import { measureSatAnnotation } from './satAnnotationPlacementRuntime';
import {
  hiddenSelectionMenu,
  placeSelectionMenu,
  type SelectionMenuPlacement,
} from '@shared/ui/selection-v2/engine/selectionPlacement';

/** Mirror of `--sat-annotation-settle`, used when the token is unreadable. */
const SETTLE_FALLBACK_SECONDS = 0.08;

/**
 * How many settle windows of CONTINUOUS movement may pass before the surface
 * shows itself anyway. A student mid-drag is not owed a toolbar, but a student
 * reading while a pane animates under them is not owed an empty screen either.
 */
const SETTLE_WAIT_LIMIT = 4;

/**
 * Where a surface goes when the DOM cannot be measured (jsdom, a headless
 * renderer, an element that has not laid out yet). Held at the container's
 * top-left inset: a guess, but a reachable one, and it keeps the controls
 * operable instead of leaving a student with a hidden toolbar.
 */
const UNMEASURABLE_INSET = 8;

/** Everything that has to be remembered across measurements. One owner. */
interface SatAnnotationPlacementSession {
  /** The last decision, fed back to the engine for hysteresis. */
  previous: SelectionMenuPlacement | null;
  /** The selection this session belongs to; a different one starts over. */
  anchor: SatTextAnchor | null;
  /** Has this selection's surface been shown? Until it has, it waits to settle. */
  revealed: boolean;
  /**
   * When the measured geometry last changed, or -1 for "nothing measured yet".
   * -1 rather than 0 on purpose: a clock that starts at zero would otherwise be
   * indistinguishable from "settled", and the surface would skip its wait.
   */
  changedAt: number;
  /** When the current wait began, so movement cannot hide the surface forever. -1 while not waiting. */
  waitingSince: number;
  /** Fingerprint of the last measurement. */
  key: string;
}

function newSession(): SatAnnotationPlacementSession {
  return { previous: null, anchor: null, revealed: false, changedAt: -1, waitingSince: -1, key: '' };
}

export interface SatAnnotationPlacementOptions {
  /**
   * Coarse pointer. It never chooses the presentation — there is only one — it
   * reserves the lane the native selection menu will claim and asks for a
   * roomier budget, because a finger needs more than a cursor does.
   */
  touch?: boolean | undefined;
  /** Logical-to-viewport scale of the exam plane containing this surface. */
  visualScale?: number | undefined;
}

/**
 * Position the contextual annotation surface against the live selection, and
 * keep it there while the student scrolls, resizes, drags a selection handle,
 * rotates the device, or the on-screen keyboard moves the visual viewport.
 *
 * This hook owns TIMING and nothing else — the measurement lives in
 * `satAnnotationPlacementRuntime`, and the decision in the shared rule
 * (`placeSelectionMenu`), the same one every other product's menu uses.
 * Three behaviours are its whole job:
 *
 * - COALESCING. Scroll, resize and visual-viewport events arrive in bursts; each
 *   one schedules at most one animation frame, so a drag or a Safari auto-scroll
 *   never issues a state write per event.
 * - SETTLING (§10). A selection's surface does not appear the instant geometry
 *   exists: it waits for the geometry to hold still for `--sat-annotation-settle`
 *   before fading in, and keeps waiting while it moves — because a toolbar that
 *   appears under a handle the student is still dragging is a toolbar they did
 *   not ask for yet. The wait is capped, and every path that can end it is
 *   independent: the timer, any later scroll/resize, and the cap itself.
 * - HYSTERESIS. The last decision is fed back into the engine, so a side is
 *   chosen once and kept until it genuinely stops fitting. A new selection (a new
 *   `anchor` identity) forgets it, because that is a new decision.
 *
 * Degrades instead of disappearing: when the anchor cannot be measured it falls
 * back to the container's top-left inset so the controls stay reachable — the
 * annotation action must never become unreachable because geometry failed.
 */
export function useSatAnnotationPlacement(
  anchor: SatTextAnchor | null,
  options: SatAnnotationPlacementOptions = {},
): {
  placement: SelectionMenuPlacement | null;
  containerRef: React.RefObject<HTMLDivElement | null>;
  measure: () => void;
} {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [placement, setPlacement] = useState<SelectionMenuPlacement | null>(null);
  const session = useRef<SatAnnotationPlacementSession>(newSession());
  const frameRef = useRef<number | null>(null);
  const settleRef = useRef<number | null>(null);
  const touch = options.touch === true;
  const visualScale = options.visualScale ?? 1;

  /** Take a decision as final: it is what the student sees from now on. */
  const reveal = useCallback((next: SelectionMenuPlacement) => {
    session.current.revealed = true;
    session.current.waitingSince = -1;
    session.current.previous = next;
    setPlacement(next);
  }, []);

  const settleCapMs = useCallback(
    () => readSatAnnotationSeconds('--sat-annotation-settle', SETTLE_FALLBACK_SECONDS) * 1000,
    [],
  );

  /** Re-measure once the given delay has passed. */
  const armRemeasure = useCallback((delayMs: number) => {
    if (typeof window === 'undefined' || typeof window.setTimeout !== 'function') return;
    if (settleRef.current !== null) window.clearTimeout(settleRef.current);
    settleRef.current = window.setTimeout(() => {
      settleRef.current = null;
      measureRef.current();
    }, Math.max(0, delayMs));
  }, []);

  const measure = useCallback(() => {
    const measurement = measureSatAnnotation(containerRef.current, anchor, visualScale);
    const budgets = readSatAnnotationBudgets();

    if (!anchor) {
      session.current.previous = null;
      setPlacement(null);
      return;
    }

    if (!measurement.size || !measurement.anchor) {
      // Unmeasurable: stay visible in the preferred mode rather than vanish or
      // guess a position from nothing. Deliberately NOT recorded as the previous
      // placement — it is not a decision, and it must not steer hysteresis.
      setPlacement({ mode: 'floating', left: UNMEASURABLE_INSET, top: UNMEASURABLE_INSET, width: 0, maxHeight: 0, side: null, arrowX: 0, animated: false, clamped: false });
      return;
    }

    const now = Date.now();
    if (measurement.key !== session.current.key) {
      session.current.key = measurement.key;
      session.current.changedAt = now;
    }

    if (!session.current.revealed) {
      const settleMs = settleCapMs();
      const settled = session.current.changedAt < 0 || now - session.current.changedAt >= settleMs;
      if (!settled) {
        if (session.current.waitingSince < 0) session.current.waitingSince = now;
        if (now - session.current.waitingSince < settleMs * SETTLE_WAIT_LIMIT) {
          setPlacement(hiddenSelectionMenu());
          armRemeasure(session.current.changedAt + settleMs - now);
          return;
        }
      }
    }

    reveal(placeSelectionMenu({
      anchor: measurement.anchor,
      bounds: measurement.bounds,
      viewport: measurement.viewport,
      size: measurement.size,
      previous: session.current.previous,
      touch,
      budgets,
    }));
  }, [anchor, armRemeasure, reveal, settleCapMs, touch, visualScale]);

  // The settle timer outlives any single subscription: a rotation wait must not
  // be cancelled by a re-render, and when it ends it has to place the selection
  // that is live NOW. So it calls through the latest measurement.
  const measureRef = useRef(measure);
  measureRef.current = measure;

  // Layout effect, not an animation frame: the surface is decided in the same
  // commit that mounts it, so it is never briefly unplaced.
  useLayoutEffect(() => {
    if (session.current.anchor !== anchor) {
      session.current = { ...newSession(), anchor, changedAt: Date.now() };
    }
    if (!anchor) {
      session.current.previous = null;
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
      // frames. Start a fresh wait rather than placing from transitional
      // geometry: the surface must not flick side to side while the device
      // turns, and it must not travel from its old coordinates to its new ones.
      session.current.revealed = false;
      session.current.previous = null;
      session.current.changedAt = Date.now();
      session.current.waitingSince = Date.now();
      setPlacement(hiddenSelectionMenu());
      armRemeasure(settleCapMs());
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
  }, [anchor, armRemeasure, measure, settleCapMs]);

  // Unmount is the one place a pending wait is abandoned instead of served:
  // nothing is left to place.
  useEffect(() => () => {
    if (frameRef.current !== null && typeof window.cancelAnimationFrame === 'function') {
      window.cancelAnimationFrame(frameRef.current);
    }
    if (settleRef.current !== null) window.clearTimeout(settleRef.current);
    frameRef.current = null;
    settleRef.current = null;
  }, []);

  return { placement, containerRef, measure };
}
