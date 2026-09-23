/**
 * SAT delivery-command conflict policy.
 *
 * The delivery backend answers HTTP 409 for several unrelated situations —
 * writer supersession (ACTIVE_SESSION_SUPERSEDED), version collisions,
 * malformed commands, and authoritative clock/state transitions — so recovery
 * copy must be chosen from the structured `code` / `details.reason`, never from
 * the status alone. Choosing "the exam is finalizing this module" for a
 * superseded writer sends the student to wait for a transition that will never
 * arrive on this client (audit SAT-007).
 *
 * Pure functions over an unknown error: no React, no gateway, no state.
 */

function backendErrorCode(error: unknown): string | null {
  if (typeof error !== "object" || error === null) return null;
  const record = error as { code?: unknown; backendCode?: unknown };
  if (typeof record.code === "string") return record.code;
  if (typeof record.backendCode === "string") return record.backendCode;
  return null;
}

function backendErrorReason(error: unknown): string | null {
  if (typeof error !== "object" || error === null) return null;
  const record = error as { details?: unknown; backendDetails?: unknown };
  const details = (record.details ?? record.backendDetails) as
    | { reason?: unknown }
    | undefined;
  return details && typeof details.reason === "string" ? details.reason : null;
}

/**
 * The ASSESSMENT_CONFLICT `details.reason` vocabulary the delivery layer
 * actually emits for clock/state gates (backend `assessmentConflict` helper).
 * Every other 409 code — CONFLICT, VERSION_COLLISION, WRITE_ID_CONFLICT,
 * RESPONSE_REVISION_MISMATCH, RUNTIME_REVISION_STALE, CONTROL_EPOCH_STALE,
 * SUBMISSION_ID_MISUSE, ACTIVE_SESSION_SUPERSEDED — stays out.
 */
const SECTION_CLOSING_REASONS: ReadonlySet<string> = new Set([
  "DEADLINE_EXPIRED",
  "RUNTIME_NOT_LIVE",
  "RUNTIME_PAUSED",
  "SECTION_NOT_ACTIVE",
  "SECTION_CLOCK_MISSING",
  "RUNTIME_STAGE_MISSING",
  "MODULE_NOT_ACTIVE",
  // MODULE_MISMATCH: the module the client addressed is not the server's
  // active one — the authoritative state advanced while this request was in
  // flight, i.e. the same race as MODULE_NOT_ACTIVE for entry/submit.
  "MODULE_MISMATCH",
  "ATTEMPT_TERMINAL",
  "ATTEMPT_PROCTOR_BLOCKED",
]);
const SECTION_CLOSING_CODES: ReadonlySet<string> = new Set([
  "DEADLINE_EXPIRED",
  "TERMINALIZATION_CONFLICT",
]);

/**
 * The control plane moved (a pause/resume or runtime bump crossed this
 * command), so our control epoch is stale rather than the request being
 * illegal. Recovery is to refetch the runtime and send one more attempt — a
 * command that crossed a pause boundary is not a closed section.
 */
const CONTROL_EPOCH_CODES: ReadonlySet<string> = new Set(["CONTROL_EPOCH_STALE"]);

/**
 * Durable-state disagreements: the server holds a different version, revision,
 * or write id than this client believes. These are recoverable by reconciling
 * against the authoritative projection and retrying — they are not clock or
 * ownership transitions.
 */
const DURABILITY_RECONCILE_CODES: ReadonlySet<string> = new Set([
  "VERSION_COLLISION",
  "RESPONSE_REVISION_MISMATCH",
  "WRITE_ID_CONFLICT",
  "RUNTIME_REVISION_STALE",
]);

function codeOrReasonIn(error: unknown, codes: ReadonlySet<string>): boolean {
  const code = backendErrorCode(error);
  if (code !== null && codes.has(code)) return true;
  const reason = backendErrorReason(error);
  return reason !== null && codes.has(reason);
}

/**
 * A conflict from the module gate means the server's view of the authoritative
 * clock has moved past ours (deadline expired, runtime not live, section/stage
 * not active, module already finalized by the reconciler). The module is closed
 * server-side and the recovery poll routes the student onwards, so this must
 * never read as "your submission failed".
 */
export function isSectionClosingRejection(error: unknown): boolean {
  const reason = backendErrorReason(error);
  if (reason !== null && SECTION_CLOSING_REASONS.has(reason)) return true;
  const code = backendErrorCode(error);
  return code !== null && SECTION_CLOSING_CODES.has(code);
}

/**
 * Another window/device holds the live writer slot (or the durability lease).
 * This needs takeover/recovery instructions — never the "exam is finalizing
 * this module / keep this screen open" copy.
 */
export function isWriterSupersededRejection(error: unknown): boolean {
  const code = backendErrorCode(error);
  if (code === "ACTIVE_SESSION_SUPERSEDED" || code === "LEASE_FENCED") return true;
  return backendErrorReason(error) === "ACTIVE_SESSION_SUPERSEDED";
}

/**
 * A pause/resume (or runtime bump) crossed this command in flight. The correct
 * recovery is to refetch the runtime/control epoch and send one more attempt,
 * never to tell the student the section is finalizing and wait for a
 * transition that this failure does not imply.
 */
export function isControlEpochStaleRejection(error: unknown): boolean {
  return codeOrReasonIn(error, CONTROL_EPOCH_CODES);
}

/**
 * The server's durable projection disagrees with this client's revision or
 * write id. Recovery is a durability reconciliation against the authoritative
 * snapshot followed by a retry, not a transition wait and not a terminal
 * failure.
 */
export function isDurabilityReconcileRejection(error: unknown): boolean {
  return codeOrReasonIn(error, DURABILITY_RECONCILE_CODES);
}

/**
 * Conflicts where our local view is stale-but-recoverable: refetch the
 * authoritative epoch/revision, then send exactly one more attempt before
 * reporting anything. Deliberately excludes section closures (the module is
 * genuinely gone) and writer supersession (another window owns the attempt).
 */
export function isStaleConflictRejection(error: unknown): boolean {
  return isControlEpochStaleRejection(error) || isDurabilityReconcileRejection(error);
}
