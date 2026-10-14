/* eslint-disable jsx-a11y/control-has-associated-label -- wrapping label + htmlFor double-associates the inputs; the rule misreads the nested-input pattern (same as SatStudentProducedAnswer). */
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Smartphone } from 'lucide-react';
import {
  decideDeviceTransfer,
  listDeviceTransfers,
  type ProctorDeviceTransfer,
} from '../../../features/proctor/api/deviceTransfers';

const POLL_MS = 10_000;

const timeFormat = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', second: '2-digit' });
const formatTime = (value: string | null) => (value ? timeFormat.format(new Date(value)) : 'No answers saved yet');

/**
 * Proctor review queue for SAT device changes. Approval binds the request to
 * the student's target browser and the current owner/lease; ownership moves
 * only when that browser redeems it. Approving requires acknowledging that
 * answers the old device never saved to the server will not move.
 */
export function SatDeviceTransferRequests({
  scheduleId,
  blocked,
  onPendingChange,
}: {
  scheduleId: string;
  blocked: boolean;
  /** Attempt ids with a device change awaiting a proctor decision (roster attention reasons). */
  onPendingChange?: (attemptIds: ReadonlySet<string>) => void;
}) {
  const [items, setItems] = useState<ProctorDeviceTransfer[]>([]);
  useEffect(() => {
    onPendingChange?.(new Set(items.filter((item) => item.state === 'pending').map((item) => item.attemptId)));
  }, [items, onPendingChange]);
  const [reviewing, setReviewing] = useState<string | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const headingId = useId();
  const ackId = useId();
  const reasonId = useId();

  const refresh = useCallback(async () => {
    try {
      const next = await listDeviceTransfers(scheduleId);
      if (mountedRef.current) setItems(next);
    } catch {
      // The room's own staleness banner covers connectivity; keep the last list.
    }
  }, [scheduleId]);

  useEffect(() => {
    mountedRef.current = true;
    void refresh();
    const timer = window.setInterval(() => void refresh(), POLL_MS);
    return () => {
      mountedRef.current = false;
      window.clearInterval(timer);
    };
  }, [refresh]);

  const decide = async (item: ProctorDeviceTransfer, approve: boolean) => {
    setBusy(true);
    setStatus(null);
    try {
      await decideDeviceTransfer(scheduleId, item.requestId, {
        approve,
        reason: reason.trim(),
        acknowledgeUnconfirmedRisk: approve && acknowledged,
      });
      if (!mountedRef.current) return;
      setStatus(
        approve
          ? `Device change approved for ${item.candidateName}. It completes when their new device continues.`
          : `Device change denied for ${item.candidateName}.`,
      );
      setReviewing(null);
      setAcknowledged(false);
      setReason('');
      await refresh();
    } catch (error) {
      if (mountedRef.current) setStatus(error instanceof Error ? error.message : 'The decision could not be saved.');
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  };

  if (items.length === 0 && !status) return null;

  return (
    <section aria-labelledby={headingId} className="mt-3 border-t border-[var(--sat-staff-border-hairline,rgba(0,0,0,0.06))] pt-3" data-testid="sat-device-transfer-requests">
      <div>
        <h3 id={headingId} className="flex items-center gap-1.5 text-[14px] font-semibold text-[var(--sat-staff-text-primary,#1d1d1f)]">
          <Smartphone size={16} aria-hidden="true" />
          Device change requests ({items.length})
        </h3>
        <p role="status" aria-live="polite" className="mt-1 text-[14px] text-[var(--sat-staff-text-secondary,#515154)]">
          {status}
        </p>
        <ul className="mt-2 space-y-2">
          {items.map((item) => {
            const open = reviewing === item.requestId;
            return (
              <li key={item.requestId} className="rounded-[var(--sat-staff-radius-control,10px)] border border-[var(--sat-staff-border-hairline,rgba(0,0,0,0.06))] px-3 py-2.5 text-[14px] leading-5 text-[var(--sat-staff-text-secondary,#515154)]">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0 flex-1 basis-48">
                    <p className="text-[14px] font-semibold text-[var(--sat-staff-text-primary,#1d1d1f)]">
                      {item.candidateName} · {item.candidateId}
                    </p>
                    <p>
                      {item.policyStage === 'pre_start' ? 'Before the exam started' : 'Exam in progress'} · requested {formatTime(item.requestedAt)} · last server save {formatTime(item.lastServerSaveAt)}
                    </p>
                    <p>
                      {item.state === 'approved'
                        ? `Approved — waiting for the new device (until ${formatTime(item.approvalExpiresAt)})`
                        : `Expires ${formatTime(item.expiresAt)}`}
                    </p>
                  </div>
                  {item.state === 'pending' ? (
                    <button
                      type="button"
                      className="sat-btn sat-btn--secondary sat-press px-3"
                      aria-expanded={open}
                      onClick={() => {
                        setReviewing(open ? null : item.requestId);
                        setAcknowledged(false);
                        setReason('');
                      }}
                    >
                      {open ? 'Close review' : 'Review'}
                    </button>
                  ) : null}
                </div>
                {open ? (
                  <div className="mt-2.5 space-y-2.5 border-t border-[var(--sat-staff-border-hairline,rgba(0,0,0,0.06))] pt-2.5">
                    <p>Confirm the student in person and that the new device is theirs. The exam clock keeps running.</p>
                    <label htmlFor={reasonId} className="block font-semibold text-[var(--sat-staff-text-primary,#1d1d1f)]">
                      Reason (optional)
                      <input
                        id={reasonId}
                        value={reason}
                        maxLength={255}
                        onChange={(event) => setReason(event.target.value)}
                        className="mt-1 min-h-11 w-full rounded-[var(--sat-staff-radius-control,10px)] border border-[var(--sat-staff-border-input,rgba(0,0,0,0.075))] bg-[var(--sat-staff-surface,#fff)] px-2.5 text-[16px] font-normal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-staff-accent-ring,rgba(0,113,227,0.4))]"
                      />
                    </label>
                    <label htmlFor={ackId} className="flex items-start gap-2">
                      <input
                        id={ackId}
                        type="checkbox"
                        checked={acknowledged}
                        onChange={(event) => setAcknowledged(event.target.checked)}
                        className="mt-0.5"
                      />
                      I understand that answers the old device had not saved to the server will not move to the new device.
                    </label>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={busy || blocked || !acknowledged}
                        onClick={() => void decide(item, true)}
                        className="sat-btn sat-btn--primary sat-press px-3"
                      >
                        Approve device change
                      </button>
                      <button
                        type="button"
                        disabled={busy || blocked}
                        onClick={() => void decide(item, false)}
                        className="sat-btn sat-btn--danger-secondary sat-press px-3"
                      >
                        Deny
                      </button>
                    </div>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
