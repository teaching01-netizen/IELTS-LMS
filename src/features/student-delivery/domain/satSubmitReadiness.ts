/**
 * Submit readiness (Phase 0 foundation).
 *
 * One pure derivation from the same persistence inputs the route already
 * holds, consumed by BOTH the review footer and the module shell so the
 * student never sees a bare dead Submit button.
 *
 * Contract:
 * - submitting  -> spinner state, button busy, no reason needed.
 * - blocked-offline / blocked-error -> hard stop with reason + recovery.
 * - saving (pendingCount > 0, no failure) -> soft stop: aria-disabled with
 *   an inline "Waiting for N answer(s) to save..." reason, never a bare
 *   `disabled` with no explanation.
 * - ready -> plain submit.
 *
 * Hard `disabled` is reserved for terminal/superseded-style failures where
 * submitting is meaningless; transient saving stays interruptible via
 * aria-disabled so assistive tech still reaches the reason.
 */

export type SatSubmitReadinessInput = {
  isSubmitting: boolean;
  failure: string | null;
  failureKind: "offline" | "retryable" | "terminal" | "superseded" | null;
  pendingCount: number;
};

export type SatSubmitReadiness =
  | { status: "ready" }
  | { status: "saving"; pendingCount: number }
  | { status: "blocked-offline" }
  | { status: "blocked-error"; failureKind: "retryable" | "terminal" | "superseded" }
  | { status: "submitting" };

export function deriveSatSubmitReadiness(input: SatSubmitReadinessInput): SatSubmitReadiness {
  if (input.isSubmitting) return { status: "submitting" };
  if (input.failureKind === "offline" || (input.failure !== null && input.failureKind === null)) {
    // failureKind is authoritative; a non-null failure without a kind is
    // treated as offline-style (answers safe locally) for submit purposes.
    if (input.failureKind === null) return { status: "blocked-offline" };
    return { status: "blocked-offline" };
  }
  if (input.failureKind === "retryable" || input.failureKind === "terminal" || input.failureKind === "superseded") {
    return { status: "blocked-error", failureKind: input.failureKind };
  }
  if (input.failure !== null) return { status: "blocked-error", failureKind: "retryable" };
  if (input.pendingCount > 0) return { status: "saving", pendingCount: input.pendingCount };
  return { status: "ready" };
}

/** True only when Submit must be a hard `disabled` (no point submitting). */
export function isSatSubmitHardBlocked(readiness: SatSubmitReadiness): boolean {
  return readiness.status === "blocked-offline" || readiness.status === "blocked-error";
}

/** True when the button should expose its reason via aria-describedby. */
export function satSubmitNeedsReason(readiness: SatSubmitReadiness): boolean {
  return readiness.status === "saving" || readiness.status === "blocked-offline" || readiness.status === "blocked-error";
}
