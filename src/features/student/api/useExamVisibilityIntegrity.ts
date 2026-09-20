import { useEffect, useRef } from 'react';
import type { StudentPlatformMonitor } from '../contracts/exam-session/StudentPlatformMonitor';
import { sharedBrowserVisibilityMonitor } from '../infrastructure/exam-session/platform/BrowserVisibilityMonitor';
import {
  createExamVisibilityIntegrityState,
  reduceExamVisibilityIntegrity,
  type ExamVisibilityExcursion,
  type ExamVisibilityIntegrityState,
} from '../application/exam-session/examVisibilityIntegrity';

export interface UseExamVisibilityIntegrityOptions {
  /**
   * True only while the student may actually answer (the IELTS/ACT `exam`
   * phase, the SAT `module`/`review` phase). Leaves before the exam starts and
   * after it ends are not violations.
   */
  active: boolean;
  /**
   * False when the exam policy is `none`. Detection is skipped entirely — no
   * violation, no warning — while `active` is true but the rule is disabled.
   */
  enabled?: boolean | undefined;
  onViolation: (excursion: ExamVisibilityExcursion) => void;
  /** Test seam; defaults to the app-wide shared Page Visibility subscription. */
  monitor?: StudentPlatformMonitor | undefined;
  /** Test seam for the clock used when a platform event carries no timestamp. */
  now?: (() => number) | undefined;
}

function currentDocumentVisibility(): 'visible' | 'hidden' {
  if (typeof document === 'undefined') return 'visible';
  return document.visibilityState === 'hidden' ? 'hidden' : 'visible';
}

function timestampToEpochMs(timestamp: string, fallback: () => number): number {
  const parsed = Date.parse(timestamp);
  return Number.isFinite(parsed) ? parsed : fallback();
}

/**
 * The single implementation of tab/app-switch semantics.
 *
 * Wires the shared browser monitor through the provider-neutral excursion rule
 * and reports at most one violation per `visible -> hidden -> visible`
 * sequence. Consumers own only what happens next: IELTS/ACT route the excursion
 * into `handleViolation` (persist + audit + warning), SAT turns it into a
 * delivery audit plus a SAT-native warning. Neither re-reads `visibilitychange`
 * itself, so both branches cannot drift.
 */
export function useExamVisibilityIntegrity({
  active,
  enabled = true,
  onViolation,
  monitor,
  now,
}: UseExamVisibilityIntegrityOptions): void {
  const resolvedMonitor = monitor ?? sharedBrowserVisibilityMonitor();
  const onViolationRef = useRef(onViolation);
  const nowRef = useRef(now);
  const activeRef = useRef(active);
  const enabledRef = useRef(enabled);
  const stateRef = useRef<ExamVisibilityIntegrityState>(
    createExamVisibilityIntegrityState(currentDocumentVisibility()),
  );

  useEffect(() => {
    onViolationRef.current = onViolation;
    nowRef.current = now;
    activeRef.current = active;
    enabledRef.current = enabled;
  }, [active, enabled, now, onViolation]);

  useEffect(() => {
    return resolvedMonitor.subscribe((event) => {
      if (event.type !== 'VISIBILITY_HIDDEN' && event.type !== 'VISIBILITY_VISIBLE') {
        return;
      }

      const visible = event.type === 'VISIBILITY_VISIBLE';

      if (!visible && !(activeRef.current && enabledRef.current)) {
        // The page went hidden while this exam was not counting it (waiting
        // room, directions, break, after completion, or rule disabled). Keep
        // the baseline visible so the return is not charged as an excursion —
        // that is what makes "leaves before/after the exam don't count" hold
        // even when the student is still away when the exam starts.
        stateRef.current = createExamVisibilityIntegrityState('visible');
        return;
      }

      const atEpochMs = timestampToEpochMs(event.timestamp, nowRef.current ?? Date.now);
      const { state, excursion } = reduceExamVisibilityIntegrity(stateRef.current, {
        visible,
        atEpochMs,
      });
      stateRef.current = state;

      if (excursion) {
        onViolationRef.current(excursion);
      }
    });
  }, [resolvedMonitor]);
}
