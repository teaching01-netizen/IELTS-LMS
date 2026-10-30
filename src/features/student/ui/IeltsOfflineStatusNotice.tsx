import { useSyncExternalStore } from 'react';
import type { StudentAttempt } from '../../../types/studentAttempt';
import type { IeltsOfflineContinuity } from '../hooks/useIeltsOfflineContinuity';

function subscribeOnline(onChange: () => void): () => void {
  window.addEventListener('online', onChange);
  window.addEventListener('offline', onChange);
  return () => {
    window.removeEventListener('online', onChange);
    window.removeEventListener('offline', onChange);
  };
}

const isOnline = () => navigator.onLine;

/**
 * Device-only continuity status for IELTS shared-timetable rooms. A local
 * marker never claims submission (FR-7): only a server receipt does.
 */
export function IeltsOfflineStatusNotice({
  continuity,
  attemptSnapshot,
}: {
  continuity: IeltsOfflineContinuity;
  attemptSnapshot: StudentAttempt | null;
}) {
  const online = useSyncExternalStore(subscribeOnline, isOnline, () => true);
  const { packageStatus, projection, restoredOffline } = continuity;
  if (!projection && packageStatus.state === 'unavailable') return null;

  const serverConfirmed = Boolean(attemptSnapshot?.submittedAt);
  const messages: string[] = [];
  if (projection?.positionKind === 'complete' && !serverConfirmed) {
    messages.push("Saved on this device. Your answers will be sent when you reconnect — don't close or clear this browser.");
  } else if (!online || restoredOffline) {
    messages.push("You're offline. Your answers are saved on this device and will be sent when you reconnect.");
  }
  if (projection && projection.clockConfidence !== 'verified' && !serverConfirmed) {
    messages.push('The time shown is an estimate until this device reconnects.');
  }
  if (packageStatus.state === 'failed' && online) {
    messages.push(
      packageStatus.reason === 'audio_unavailable' || packageStatus.reason === 'media_failed'
        ? "Exam audio or images couldn't be saved on this device. Keep it connected and tell your invigilator."
        : "This device isn't ready to work offline. Keep it connected — your exam continues as normal.",
    );
  }
  if (messages.length === 0) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="student-offline-status border-b border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900"
      data-testid="ielts-offline-status"
    >
      {messages.map((message) => (
        <p key={message}>{message}</p>
      ))}
      {packageStatus.state === 'failed' && online && (
        <button type="button" className="mt-1 underline underline-offset-2" onClick={continuity.retryPreparation}>
          Try again
        </button>
      )}
    </div>
  );
}
