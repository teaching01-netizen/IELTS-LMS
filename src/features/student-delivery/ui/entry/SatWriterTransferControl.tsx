import { useState } from "react";
import {
  confirmTransferAsWriter,
  getPendingTransferForWriter,
  type SatDeviceTransfer,
} from "../../api/satDeviceTransferApi";
import { SAT_COPY } from "../../domain/satCopy";

const copy = SAT_COPY.deviceTransfer;

type ControlState =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "none" }
  | { kind: "pending"; transfer: SatDeviceTransfer; busy: boolean }
  | { kind: "allowed" }
  | { kind: "proctor" }
  | { kind: "failed" };

/**
 * Pre-start self-service on the CURRENT writer: the student, now at their
 * other device, came back here to allow the move. On demand only (one read
 * when asked), so no lobby-wide polling. After any timed module starts the
 * server refuses this and only a proctor can approve.
 */
export function SatWriterTransferControl({ scheduleId, attemptId }: { scheduleId: string; attemptId: string }) {
  const [state, setState] = useState<ControlState>({ kind: "idle" });

  const check = async () => {
    setState({ kind: "checking" });
    try {
      const transfer = await getPendingTransferForWriter(scheduleId, attemptId);
      if (!transfer || transfer.state !== "pending") {
        setState(transfer?.state === "approved" ? { kind: "allowed" } : { kind: "none" });
      } else if (transfer.policyStage !== "pre_start") {
        setState({ kind: "proctor" });
      } else {
        setState({ kind: "pending", transfer, busy: false });
      }
    } catch {
      setState({ kind: "failed" });
    }
  };

  const allow = async () => {
    if (state.kind !== "pending") return;
    setState({ ...state, busy: true });
    try {
      await confirmTransferAsWriter(scheduleId, attemptId, state.transfer.requestId);
      setState({ kind: "allowed" });
    } catch (error) {
      const code = (error as { code?: unknown } | null)?.code;
      setState(code === "TRANSFER_APPROVAL_REQUIRED" ? { kind: "proctor" } : { kind: "failed" });
    }
  };

  const message =
    state.kind === "none"
      ? copy.writerNoRequest
      : state.kind === "allowed"
        ? copy.writerAllowed
        : state.kind === "proctor"
          ? copy.writerProctorRequired
          : state.kind === "failed"
            ? copy.checkFailed
            : null;
  const buttonClass =
    "sat-touch-target sat-pressable inline-flex items-center justify-center rounded-full border border-[var(--sat-divider)] bg-[var(--sat-surface)] px-4 text-[13px] font-semibold text-[var(--sat-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-focus)] disabled:cursor-wait disabled:opacity-60";

  return (
    <section
      className="sat-ui mx-auto mt-4 w-full max-w-md px-6 text-center text-[var(--sat-text)]"
      aria-label={copy.writerCheck}
      data-testid="sat-writer-transfer"
    >
      {state.kind === "pending" ? (
        <div className="rounded-[8px] border border-[var(--sat-divider)] bg-[var(--sat-surface)] px-4 py-3">
          <p className="text-[14px] font-semibold">{copy.writerPendingTitle}</p>
          <p className="mt-1 text-[13px] text-[var(--sat-text-secondary)]">{copy.writerPendingBody}</p>
          <button type="button" className={`${buttonClass} mt-3`} onClick={() => void allow()} disabled={state.busy}>
            {copy.writerAllow}
          </button>
        </div>
      ) : state.kind !== "allowed" ? (
        <button
          type="button"
          className={buttonClass}
          onClick={() => void check()}
          disabled={state.kind === "checking"}
        >
          {state.kind === "checking" ? copy.writerChecking : copy.writerCheck}
        </button>
      ) : null}
      <p role="status" aria-live="polite" className="mt-2 text-[13px] text-[var(--sat-text-secondary)]">
        {message}
      </p>
    </section>
  );
}
