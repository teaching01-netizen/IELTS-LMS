import React, { useEffect, useRef, useState } from 'react';
import { Button } from '../ui/Button';

interface StudentSubmissionPendingPanelProps {
  onRetryNow: () => void;
}

const CONNECTION_GUIDANCE_STEPS = [
  'Check that you are connected to the internet.',
  'Keep this page open — your answers are stored on this device.',
  'Submission retries automatically; do not close this tab.',
  'If this message persists, contact your proctor with your exam details.',
];

/**
 * FEX-051: the exam is over but the backend has not yet confirmed the
 * submission. This is NOT a confirmed "Exam submitted" state — the student
 * must keep the page open while the attempt layer retries with the same
 * submission identity and the original final snapshot.
 *
 * Accessibility (M5): announced as an alertdialog (assertive) with focus
 * moved to the primary action on mount and restored on unmount, mirroring the
 * WarningOverlay role/aria-modal pattern.
 */
export function StudentSubmissionPendingPanel({
  onRetryNow,
}: StudentSubmissionPendingPanelProps) {
  const [guidanceOpen, setGuidanceOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const previouslyFocusedRef = useRef<Element | null>(null);

  useEffect(() => {
    previouslyFocusedRef.current = document.activeElement;
    const retryButton = panelRef.current?.querySelector<HTMLButtonElement>('button');
    retryButton?.focus();
    return () => {
      const previouslyFocused = previouslyFocusedRef.current;
      if (previouslyFocused instanceof HTMLElement && previouslyFocused.isConnected) {
        previouslyFocused.focus();
      }
    };
  }, []);

  return (
    <div
      ref={panelRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/70 backdrop-blur-sm p-4"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="student-submission-pending-title"
      aria-describedby="student-submission-pending-message"
    >
      <div className="max-w-md w-full bg-white rounded-sm border border-gray-100 shadow-2xl p-6 md:p-8 text-center" aria-live="assertive">
        <p className="text-[length:var(--student-meta-font-size)] font-bold uppercase tracking-[0.3em] text-amber-700 mb-3">
          Submission pending
        </p>
        <h2 id="student-submission-pending-title" className="text-2xl font-black text-gray-900 mb-3">
          Submission pending
        </h2>
        <p id="student-submission-pending-message" className="text-sm text-gray-700 leading-6">
          Your answers are stored on this device. Keep this page open while we
          confirm your submission.
        </p>
        <div className="mt-6 flex flex-col items-center justify-center gap-3">
          <Button type="button" onClick={onRetryNow}>
            Retry now
          </Button>
          <button
            type="button"
            className="text-xs font-semibold text-blue-700 underline underline-offset-2 hover:text-blue-900"
            aria-expanded={guidanceOpen}
            onClick={() => setGuidanceOpen((open) => !open)}
          >
            View connection guidance
          </button>
        </div>
        {guidanceOpen ? (
          <ul className="mt-4 rounded-sm border border-gray-200 bg-gray-50 p-4 text-left text-xs text-gray-700 space-y-2">
            {CONNECTION_GUIDANCE_STEPS.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}
