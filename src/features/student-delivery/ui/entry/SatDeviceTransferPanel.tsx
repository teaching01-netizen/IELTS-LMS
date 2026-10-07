import { useCallback, useEffect, useRef, useState } from "react";
import {
  cancelSatDeviceTransfer,
  checkSatAdmission,
  commitSatDeviceTransfer,
  forgetSatTransferOperation,
  getSatDeviceTransfer,
  recallSatTransferRequest,
  rememberSatTransferRequest,
  requestSatDeviceTransfer,
  satBrowserWriterSession,
  type SatDeviceTransfer,
  type SatPolicyStage,
} from "../../api/satDeviceTransferApi";
import { SAT_COPY } from "../../domain/satCopy";
import { SatLoadingSurface } from "../feedback/SatStateSurfaces";

const POLL_MS = 4_000;
const copy = SAT_COPY.deviceTransfer;

type View =
  | { kind: "checking" }
  | { kind: "check-failed" }
  | { kind: "blocked"; attemptId: string; leaseEpoch: number; stage: SatPolicyStage; busy: boolean; error: string | null }
  | { kind: "pending"; transfer: SatDeviceTransfer; busy: boolean; error: string | null }
  | { kind: "committing"; transfer: SatDeviceTransfer }
  | { kind: "ended"; transfer: SatDeviceTransfer | null; title: string };

export interface SatDeviceTransferPanelProps {
  scheduleId: string;
  candidateId: string;
  /** This browser now owns the attempt (or the attempt is closed): reload the route. */
  onAuthorized: () => void;
  onExit: () => void;
}

function endedTitle(state: SatDeviceTransfer["state"]): string {
  if (state === "denied") return copy.deniedTitle;
  if (state === "expired") return copy.expiredTitle;
  return copy.conflictedTitle;
}

/**
 * Blocked-entry surface for a browser that does not own the SAT attempt.
 * Shows no exam content and accepts no answers. The only actions are to
 * request, wait for, cancel, or redeem a device change; ownership moves only
 * when the server commits an approved request.
 */
export function SatDeviceTransferPanel({ scheduleId, candidateId, onAuthorized, onExit }: SatDeviceTransferPanelProps) {
  const [view, setView] = useState<View>({ kind: "checking" });
  const headingRef = useRef<HTMLHeadingElement>(null);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const forgetRequest = useCallback(
    (transfer: SatDeviceTransfer | null) => {
      rememberSatTransferRequest(scheduleId, candidateId, null);
      if (transfer) {
        forgetSatTransferOperation(scheduleId, transfer.attemptId, satBrowserWriterSession(scheduleId, candidateId));
      }
    },
    [candidateId, scheduleId],
  );

  const commit = useCallback(
    async (transfer: SatDeviceTransfer) => {
      setView({ kind: "committing", transfer });
      try {
        await commitSatDeviceTransfer(scheduleId, candidateId, transfer.requestId);
        if (!mountedRef.current) return;
        forgetRequest(transfer);
        onAuthorized();
      } catch (error) {
        if (!mountedRef.current) return;
        const code = (error as { code?: unknown } | null)?.code;
        if (code === "TRANSFER_APPROVAL_REQUIRED") {
          setView({ kind: "pending", transfer, busy: false, error: null });
        } else if (code === "TRANSFER_EXPIRED" || code === "TRANSFER_CONFLICT") {
          forgetRequest(transfer);
          setView({ kind: "ended", transfer, title: code === "TRANSFER_EXPIRED" ? copy.expiredTitle : copy.conflictedTitle });
        } else {
          // Transient: the commit is idempotent, the next poll retries it.
          setView({ kind: "pending", transfer, busy: false, error: copy.checkFailed });
        }
      }
    },
    [candidateId, forgetRequest, onAuthorized, scheduleId],
  );

  const applyTransfer = useCallback(
    (transfer: SatDeviceTransfer) => {
      if (transfer.state === "approved" || transfer.state === "committed") {
        void commit(transfer);
      } else if (transfer.state === "pending") {
        rememberSatTransferRequest(scheduleId, candidateId, transfer.requestId);
        setView({ kind: "pending", transfer, busy: false, error: null });
      } else {
        forgetRequest(transfer);
        setView({ kind: "ended", transfer, title: transfer.state === "cancelled" ? copy.blockedTitle : endedTitle(transfer.state) });
      }
    },
    [candidateId, commit, forgetRequest, scheduleId],
  );

  const check = useCallback(async () => {
    setView({ kind: "checking" });
    try {
      const { admission, attemptId } = await checkSatAdmission(scheduleId, candidateId);
      if (!mountedRef.current) return;
      if (!admission || admission.outcome !== "blocked" || !attemptId) {
        onAuthorized();
        return;
      }
      const remembered = recallSatTransferRequest(scheduleId, candidateId);
      if (remembered) {
        try {
          const transfer = await getSatDeviceTransfer(scheduleId, candidateId, remembered);
          if (!mountedRef.current) return;
          if (transfer.state === "pending" || transfer.state === "approved" || transfer.state === "committed") {
            applyTransfer(transfer);
            return;
          }
          forgetRequest(transfer);
        } catch {
          rememberSatTransferRequest(scheduleId, candidateId, null);
        }
      }
      setView({
        kind: "blocked",
        attemptId,
        leaseEpoch: admission.leaseEpoch,
        stage: admission.policyStage ?? "post_start",
        busy: false,
        error: null,
      });
    } catch {
      if (mountedRef.current) setView({ kind: "check-failed" });
    }
  }, [applyTransfer, candidateId, forgetRequest, onAuthorized, scheduleId]);

  useEffect(() => {
    void check();
  }, [check]);

  // Poll an open request; reads never extend its expiry.
  const pendingRequestId = view.kind === "pending" ? view.transfer.requestId : null;
  useEffect(() => {
    if (!pendingRequestId) return;
    const timer = window.setInterval(() => {
      void getSatDeviceTransfer(scheduleId, candidateId, pendingRequestId)
        .then((transfer) => {
          if (mountedRef.current && transfer.state !== "pending") applyTransfer(transfer);
        })
        .catch(() => undefined);
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [applyTransfer, candidateId, pendingRequestId, scheduleId]);

  // Move focus to the new state's heading so keyboard and screen-reader users
  // land on what changed.
  useEffect(() => {
    headingRef.current?.focus();
  }, [view.kind]);

  const request = async () => {
    if (view.kind !== "blocked") return;
    setView({ ...view, busy: true, error: null });
    try {
      const transfer = await requestSatDeviceTransfer({
        scheduleId,
        candidateId,
        attemptId: view.attemptId,
        expectedLeaseEpoch: view.leaseEpoch,
      });
      if (mountedRef.current) applyTransfer(transfer);
    } catch (error) {
      if (!mountedRef.current) return;
      const message = error instanceof Error && error.message ? error.message : copy.checkFailed;
      setView({ ...view, busy: false, error: message });
    }
  };

  const cancel = async () => {
    if (view.kind !== "pending") return;
    setView({ ...view, busy: true, error: null });
    try {
      const transfer = await cancelSatDeviceTransfer(scheduleId, candidateId, view.transfer.requestId);
      if (!mountedRef.current) return;
      forgetRequest(transfer);
      void check();
    } catch {
      if (mountedRef.current) setView({ ...view, busy: false, error: copy.checkFailed });
    }
  };

  if (view.kind === "checking") return <SatLoadingSurface kind="initial" />;
  if (view.kind === "committing") return <SatLoadingSurface kind="initial" label={copy.approvedTitle} />;

  const stage: SatPolicyStage =
    view.kind === "blocked" ? view.stage : view.kind === "pending" ? view.transfer.policyStage : "post_start";
  const title =
    view.kind === "check-failed"
      ? copy.blockedTitle
      : view.kind === "pending"
        ? copy.pendingTitle
        : view.kind === "ended"
          ? view.title
          : copy.blockedTitle;
  const body =
    view.kind === "check-failed"
      ? copy.checkFailed
      : view.kind === "pending"
        ? stage === "pre_start"
          ? copy.pendingBodyPreStart
          : copy.pendingBodyPostStart
        : view.kind === "ended"
          ? copy.endedBody
          : stage === "pre_start"
            ? copy.blockedBodyPreStart
            : copy.blockedBodyPostStart;
  const error = view.kind === "blocked" || view.kind === "pending" ? view.error : null;
  const busy = (view.kind === "blocked" || view.kind === "pending") && view.busy;
  const buttonClass =
    "sat-touch-target sat-pressable inline-flex items-center justify-center rounded-full border px-5 text-[14px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-focus)] focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-60";

  return (
    <main
      className="sat-ui grid min-h-[100dvh] place-items-center bg-[var(--sat-background)] px-6 py-8 text-[var(--sat-text)]"
      data-testid="sat-device-transfer"
      data-sat-transfer-view={view.kind}
    >
      <div className="w-full max-w-md text-center">
        <h1 ref={headingRef} tabIndex={-1} className="text-[20px] font-semibold tracking-tight focus:outline-none">
          {title}
        </h1>
        <div role="status" aria-live="polite" aria-atomic="true">
          <p className="mt-2 text-[15px] leading-6 text-[var(--sat-text-secondary)]">{body}</p>
          {view.kind === "blocked" || view.kind === "pending" ? (
            <p className="mt-3 text-[13px] leading-5 text-[var(--sat-text-secondary)]">
              {copy.clockNotice} {stage === "post_start" ? copy.unconfirmedWarning : null}
            </p>
          ) : null}
        </div>
        {error ? (
          <p role="alert" className="mt-3 break-words text-[13px] leading-5 text-[var(--sat-danger)]">
            {error}
          </p>
        ) : null}
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          {view.kind === "blocked" ? (
            <button
              type="button"
              onClick={() => void request()}
              disabled={busy}
              className={`${buttonClass} border-[var(--sat-text)] bg-[var(--sat-text)] text-[var(--sat-surface)]`}
            >
              {busy ? copy.requesting : copy.request}
            </button>
          ) : null}
          {view.kind === "pending" ? (
            <button
              type="button"
              onClick={() => void cancel()}
              disabled={busy}
              className={`${buttonClass} border-[var(--sat-divider)] bg-[var(--sat-surface)] text-[var(--sat-text)]`}
            >
              {copy.cancel}
            </button>
          ) : null}
          {view.kind === "ended" || view.kind === "check-failed" ? (
            <button
              type="button"
              onClick={() => void check()}
              className={`${buttonClass} border-[var(--sat-text)] bg-[var(--sat-text)] text-[var(--sat-surface)]`}
            >
              {view.kind === "ended" ? copy.requestAgain : copy.retry}
            </button>
          ) : null}
          <button
            type="button"
            onClick={onExit}
            className={`${buttonClass} border-[var(--sat-divider)] bg-[var(--sat-surface)] text-[var(--sat-text)]`}
          >
            {copy.backToCheckIn}
          </button>
        </div>
      </div>
    </main>
  );
}
