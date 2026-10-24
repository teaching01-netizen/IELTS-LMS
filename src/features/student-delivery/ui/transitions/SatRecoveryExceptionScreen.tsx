import { useEffect, useId, useRef, useState } from "react";
import type {
  SATRecoveryResolutionReceipt,
  SATRecoveryResolutionRequest,
} from "../../contracts/assessmentDelivery";
import { SatPresenceSurface } from "../motion/SatPresenceSurface";

export function SatRecoveryExceptionScreen({
  mode,
  kind,
  moduleTitle,
  moduleAttemptId,
  boundaryRevision,
  onRetry,
  onResolve,
}: {
  mode: "practice" | "classroom";
  kind: "work" | "entry";
  moduleTitle: string;
  moduleAttemptId: string;
  boundaryRevision: number;
  onRetry: () => Promise<unknown>;
  onResolve: (request: SATRecoveryResolutionRequest) => Promise<SATRecoveryResolutionReceipt>;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<SATRecoveryResolutionReceipt | null>(null);
  const mountedRef = useRef(false);
  const retryingRef = useRef(false);
  const actionRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const resolutionIdRef = useRef<string | null>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!confirming) return undefined;
    const frame = window.requestAnimationFrame(() =>
      cancelRef.current?.focus({ preventScroll: true })
    );
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const controls = [cancelRef.current, actionRef.current].filter(
        (control): control is HTMLButtonElement => control !== null
      );
      if (controls.length === 0) return;
      const first = controls[0]!;
      const last = controls[controls.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKeyDown);
      if (openerRef.current?.isConnected) openerRef.current.focus();
    };
  }, [confirming]);

  const retry = async () => {
    if (retryingRef.current) return;
    retryingRef.current = true;
    setRetrying(true);
    setError(null);
    try {
      await onRetry();
    } catch {
      setError("We could not check the exam connection. Try again when you are online.");
    } finally {
      retryingRef.current = false;
      if (mountedRef.current) setRetrying(false);
    }
  };

  const resolve = async () => {
    if (busy || receipt) return;
    setBusy(true);
    setError(null);
    resolutionIdRef.current ??= globalThis.crypto?.randomUUID?.() ?? `sat-recovery-${Date.now()}`;
    try {
      const result = await onResolve({
        resolutionId: resolutionIdRef.current,
        moduleAttemptId,
        expectedBoundaryRevision: boundaryRevision,
        action: kind === "entry" ? "activate_entry" : "continue_confirmed",
      });
      if (!mountedRef.current) return;
      setReceipt(result);
      setConfirming(false);
    } catch {
      try {
        await onRetry();
      } catch {
        // Keep the same resolution ID available for a safe retry if the status
        // probe also fails. The server may already have committed the action.
      }
      if (mountedRef.current) {
        setError(
          "We could not confirm whether your decision was recorded. If this screen remains, check your connection and try again."
        );
      }
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  };

  return (
    <SatPresenceSurface className="sat-ui grid min-h-[100dvh] place-items-center bg-[var(--sat-background)] px-6 py-8 text-[var(--sat-text)]">
      <main className="w-full max-w-lg rounded-[10px] border border-[var(--sat-divider)] bg-[var(--sat-surface)] p-7 shadow-lg sm:p-9">
        <p className="sat-type-control-secondary font-semibold text-[var(--sat-text-secondary)]">
          Digital SAT · {moduleTitle}
        </p>
        <h1
          data-sat-stage-heading="true"
          tabIndex={-1}
          className="mt-3 text-2xl font-semibold tracking-tight"
        >
          {kind === "entry" ? "Module entry recovery ended" : "Connection recovery ended"}
        </h1>
        <p
          className="mt-3 sat-type-control-primary leading-6 text-[var(--sat-text-secondary)]"
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          {kind === "entry"
            ? mode === "practice"
              ? "This module has not started. You can choose to start it now; the module timer begins after you confirm."
              : "This module has not started. Ask your proctor to review the entry exception."
            : mode === "practice"
              ? "Some answers are not confirmed by the exam. Unconfirmed answers may remain on the original device."
              : "The connection recovery period ended. Your proctor can help you continue with answers confirmed by the exam."}
        </p>
        {receipt ? (
          <p className="mt-4 rounded-lg bg-[var(--sat-surface-subtle)] p-3 text-sm" role="status">
            Decision recorded. Checking the exam state now.
          </p>
        ) : null}
        {error ? (
          <p className="mt-4 text-sm text-[var(--sat-danger)]" role="alert">
            {error}
          </p>
        ) : null}
        {mode === "practice" && !receipt ? (
          <button
            type="button"
            className="sat-touch-target sat-pressable mt-6 w-full rounded-full bg-[var(--sat-text)] px-6 font-semibold text-[var(--sat-surface)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-focus)] focus-visible:ring-offset-2"
            onClick={(event) => {
              openerRef.current = event.currentTarget;
              setError(null);
              setConfirming(true);
            }}
          >
            {kind === "entry" ? "Start this module" : "Continue with server-confirmed answers"}
          </button>
        ) : null}
        {mode === "classroom" && !receipt ? (
          <p className="mt-5 rounded-lg bg-[var(--sat-surface-subtle)] p-3 text-sm text-[var(--sat-text-secondary)]">
            Ask your proctor to review this recovery exception.
          </p>
        ) : null}
        <button
          type="button"
          className="sat-touch-target sat-pressable mt-3 w-full rounded-full border border-[var(--sat-divider)] px-6 font-semibold text-[var(--sat-text)] hover:bg-[var(--sat-surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-focus)] focus-visible:ring-offset-2 aria-disabled:cursor-wait aria-disabled:opacity-60"
          onClick={() => void retry()}
          aria-disabled={retrying}
          aria-busy={retrying}
        >
          {retrying ? "Checking connection…" : "Try reconnecting"}
        </button>
      </main>
      {confirming ? (
        <div className="sat-ui sat-dialog-backdrop fixed inset-0 z-[100] flex items-center justify-center bg-black/55 px-4">
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={descriptionId}
            className="w-full max-w-md rounded-[10px] border border-[var(--sat-divider)] bg-[var(--sat-surface)] p-7 shadow-[var(--sat-shadow-modal)]"
          >
            <h2 id={titleId} className="text-xl font-semibold tracking-tight">
              {kind === "entry" ? "Start this module now?" : "Continue with confirmed answers?"}
            </h2>
            <p
              id={descriptionId}
              className="mt-3 text-sm leading-6 text-[var(--sat-text-secondary)]"
            >
              {kind === "entry"
                ? "Your module timer begins when you confirm. This decision is recorded and cannot be undone."
                : "Unconfirmed answers will not be included in your score or route. This decision is recorded and cannot be undone."}
            </p>
            <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <button
                ref={cancelRef}
                type="button"
                className="sat-touch-target sat-pressable rounded-full border border-[var(--sat-divider)] px-5 font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-focus)]"
                onClick={() => setConfirming(false)}
                disabled={busy}
              >
                Go back
              </button>
              <button
                ref={actionRef}
                type="button"
                className="sat-touch-target sat-pressable rounded-full bg-[var(--sat-text)] px-5 font-semibold text-[var(--sat-surface)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-focus)] disabled:opacity-60"
                onClick={() => void resolve()}
                disabled={busy}
              >
                {busy
                  ? "Recording decision…"
                  : kind === "entry"
                    ? "Start this module"
                    : "Continue with server-confirmed answers"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </SatPresenceSurface>
  );
}
