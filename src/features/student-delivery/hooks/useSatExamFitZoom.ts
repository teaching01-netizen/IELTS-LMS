import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from "react";
import {
  SAT_EXAM_FIT_CEILING,
  satExamFitNextZoom,
  satExamFitShouldRun,
  satExamFitVerdict,
  type SatExamFitGateInput,
} from "../domain/satExamFit";
import { createSatExamFitProbe, type SatExamFitProbe } from "../ui/reading/satExamFitProbe";

/**
 * Screen-zoom auto-fit: walk the zoom candidates, largest first, and stop at the
 * first one whose panes fit.
 *
 * The walk runs in layout effects, so every candidate it tries is applied and
 * measured before the browser paints: a student never sees the exam flicker
 * through 75% on its way to a decision.
 *
 * It runs once per ATTEMPT, not once per mount: a module boundary remounts the
 * exam inside the same attempt, so the gate takes an attempt-scoped
 * `zoomDecided` fact from whoever owns the attempt, and the local `attempted`
 * latch only covers the case that produces no decision at all (a walk that
 * found nothing to measure). A later question that does not fit scrolls, exactly
 * as it does today.
 *
 * What a decision writes is the same preference the Display control writes, so a
 * fitted zoom is visible in the panel, steppable, and persisted like any other
 * choice. An automatic run that lands on the resting 100% reports "decided, with
 * nothing to write" rather than storing 100%: nothing about the exam changed, and
 * a stored 100% would read as a preference the student chose (and would light up
 * the Display panel's Reset).
 */

export interface SatExamFitZoomInput extends Omit<SatExamFitGateInput, "attempted"> {
  /** The zoomed content box; the fit measures the panes inside it. */
  contentRef: RefObject<HTMLElement | null>;
  /**
   * Reports the decision: the zoom to persist, or null when the walk decided the
   * exam needs no different zoom. Called at most once per mount.
   */
  onDecide: (zoom: number | null) => void;
  /** Injected for tests; the DOM probe is the production default. */
  probe?: SatExamFitProbe | undefined;
}

export interface SatExamFitZoom {
  /** Zoom to render while the fit is deciding; null = leave the student's value. */
  zoom: number | null;
  /** True while a walk is in flight (a settle signal for e2e). */
  probing: boolean;
  /** Measures again on the student's explicit request (Display: Fit to screen). */
  fitNow: () => void;
}

const defaultProbe = createSatExamFitProbe();

export function useSatExamFitZoom(input: SatExamFitZoomInput): SatExamFitZoom {
  const { contentRef, onDecide, probe: injectedProbe, ...gate } = input;
  const probe = injectedProbe ?? defaultProbe;
  const [walk, setWalk] = useState<{ zoom: number; manual: boolean } | null>(null);
  const attemptedRef = useRef(false);

  const settle = useCallback(
    (zoom: number, manual: boolean) => {
      setWalk(null);
      // An automatic run that lands on the resting point has decided — and its
      // decision is that nothing changes, so it reports null instead of storing
      // a 100% the student never chose. An explicit request is a student asking
      // for a zoom, so it reports the value either way.
      onDecide(!manual && zoom >= SAT_EXAM_FIT_CEILING ? null : zoom);
    },
    [onDecide],
  );

  // Decide whether this mount gets to fit at all.
  useLayoutEffect(() => {
    if (walk !== null) return;
    const shouldRun = satExamFitShouldRun({
      enabled: gate.enabled,
      zoomDecided: gate.zoomDecided,
      storedZoom: gate.storedZoom,
      compact: gate.compact,
      blocked: gate.blocked,
      attempted: attemptedRef.current,
    });
    if (!shouldRun) return;
    attemptedRef.current = true;
    setWalk({ zoom: SAT_EXAM_FIT_CEILING, manual: false });
  }, [walk, gate.enabled, gate.zoomDecided, gate.storedZoom, gate.compact, gate.blocked]);

  // Measure the candidate that is rendered right now, then stop or step down.
  useLayoutEffect(() => {
    if (walk === null) return;
    const verdict = satExamFitVerdict(probe.readPanes(contentRef.current ?? null));
    if (verdict === "unmeasurable") {
      // Nothing here can answer the question — and a pane the fit cannot read is
      // not an overflow, so the walk ends without deciding: the student's zoom
      // is untouched, and the attempt stays free to fit the next time the exam
      // opens on a pane that exists.
      setWalk(null);
      return;
    }
    if (verdict === "overflows") {
      const next = satExamFitNextZoom(walk.zoom);
      if (next !== null) {
        // Render the next candidate: this effect re-runs on the state change and
        // measures THAT rendering, which is the only one that can answer for it.
        setWalk({ zoom: next, manual: walk.manual });
        return;
      }
    }
    settle(walk.zoom, walk.manual);
  }, [walk, probe, settle, contentRef]);

  const fitNow = useCallback(() => {
    setWalk({ zoom: SAT_EXAM_FIT_CEILING, manual: true });
  }, []);

  return { zoom: walk?.zoom ?? null, probing: walk !== null, fitNow };
}
