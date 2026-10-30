import type { StudentAttempt } from '../../../types/studentAttempt';
import type { IeltsOfflineContinuity } from '../hooks/useIeltsOfflineContinuity';
import { useBrowserOnline } from '../hooks/useBrowserOnline';

/**
 * Device-only continuity status for IELTS shared-timetable rooms. A local
 * marker never claims submission (FR-7): only a server receipt does.
 *
 * A failed offline-download is a background cache miss, not an exam event
 * (`2026-10-31-ielts-offline-download-silent-failure.md`). This component
 * therefore has no failure text, no retry control and no failure announcement;
 * it only reports real offline/save state.
 */
export function IeltsOfflineStatusNotice({
  continuity,
  attemptSnapshot,
}: {
  continuity: IeltsOfflineContinuity;
  attemptSnapshot: StudentAttempt | null;
}) {
  const online = useBrowserOnline();
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
    </div>
  );
}
