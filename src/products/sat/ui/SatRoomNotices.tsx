import { useEffect, useState } from 'react';
import { SatBannerDismissButton } from './SatBannerDismissButton';
import { SatButton } from './SatPage';

export interface SatRoomNoticeMessage {
  kind: 'success' | 'error';
  text: string;
}

/**
 * The room's transient strips: creation confirmation, stale-data warning, and
 * the last action's success/failure. Each informational strip can be closed.
 *
 * Dismissal is keyed to the message that was read: a new controller error,
 * action result, or a fresh room-created confirmation re-opens the strip.
 * Staleness itself is not silenced — the header still says "Reconnecting" and
 * room actions stay disabled while the data is out of date.
 */
export function SatRoomNotices({
  createdRoom,
  isStale,
  staleKey,
  message,
  onRetry,
  onDismissCreation,
}: {
  createdRoom: boolean;
  isStale: boolean;
  /** Identity of the current staleness (the controller error); a new one re-opens the banner. */
  staleKey?: string | null;
  message: SatRoomNoticeMessage | null;
  onRetry: () => void;
  onDismissCreation: () => void;
}) {
  const [dismissedStale, setDismissedStale] = useState<string | null>(null);
  const [dismissedMessage, setDismissedMessage] = useState<string | null>(null);
  const currentStaleKey = staleKey ?? 'stale';

  useEffect(() => {
    if (!isStale) setDismissedStale(null);
  }, [isStale]);
  useEffect(() => {
    if (!message) setDismissedMessage(null);
  }, [message]);

  const showStale = isStale && dismissedStale !== currentStaleKey;
  const showMessage = message && dismissedMessage !== message.text ? message : null;
  if (!createdRoom && !showStale && !showMessage) return null;

  return (
    <div className="sat-room__notices grid min-w-0 gap-2" data-testid="sat-room-notices">
      {createdRoom ? (
        <div role="status" className="flex min-w-0 items-center justify-between gap-3 rounded-[var(--sat-staff-radius-card,14px)] border border-[var(--sat-staff-border-hairline)] bg-[var(--sat-staff-surface)] px-4 py-2 text-[14px]">
          <p className="min-w-0 flex-1"><span className="font-semibold">Room created.</span> Your room is ready to manage.</p>
          <SatBannerDismissButton
            onClick={onDismissCreation}
            label="Dismiss room creation confirmation"
          />
        </div>
      ) : null}
      {showStale ? (
        <div role="alert" className="sat-banner-enter flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-[var(--sat-staff-radius-card,14px)] bg-[var(--sat-staff-warning-tint,rgba(217,119,6,0.1))] px-4 py-2 text-[14px] leading-5 text-[var(--sat-staff-warning-text,#92400e)]">
          <p className="min-w-0 flex-1 basis-60"><span className="font-semibold">Data may be out of date.</span> Risky room actions are paused until reconnection.</p>
          <div className="flex shrink-0 items-center gap-2">
            <SatButton variant="secondary" onClick={onRetry}>Retry</SatButton>
            <SatBannerDismissButton onClick={() => setDismissedStale(currentStaleKey)} />
          </div>
        </div>
      ) : null}
      {showMessage ? (
        <div
          role={showMessage.kind === 'error' ? 'alert' : 'status'}
          className={`sat-banner-enter flex items-center justify-between gap-3 rounded-[var(--sat-staff-radius-card,14px)] px-4 py-2.5 text-[14px] font-medium leading-5 ${showMessage.kind === 'error'
            ? 'bg-[var(--sat-staff-danger-tint,rgba(217,45,32,0.08))] text-[var(--sat-staff-danger,#b42318)]'
            : 'border border-[var(--sat-staff-border-hairline,rgba(0,0,0,0.06))] bg-[var(--sat-staff-surface,#fff)] text-[var(--sat-staff-text-secondary,#515154)]'}`}
        >
          <p className="min-w-0 flex-1">{showMessage.text}</p>
          <SatBannerDismissButton onClick={() => setDismissedMessage(showMessage.text)} />
        </div>
      ) : null}
    </div>
  );
}
