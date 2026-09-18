/**
 * SAT submit-path conflict policy.
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
