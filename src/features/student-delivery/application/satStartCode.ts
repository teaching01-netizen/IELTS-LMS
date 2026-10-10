/**
 * SAT access-code start: pure input validation and refusal classification
 * for the candidate's "Enter code and begin exam" form.
 *
 * The submitted value is trimmed and must then be exactly six ASCII digits.
 * Letters, separators and non-ASCII digits are refused — never silently
 * stripped — and the value always travels as a string so leading zeros
 * survive. Pure functions: no React, no gateway, no clocks.
 */

export const SAT_START_CODE_LENGTH = 6;

export function normalizeStartCodeInput(raw: string): string | null {
  const code = raw.trim();
  return /^[0-9]{6}$/.test(code) ? code : null;
}

export type SatStartCodeRefusalKind =
  | "format"
  | "invalid"
  | "not_open"
  | "closed"
  | "paused"
  | "revoked"
  | "rotated"
  | "rate_limited"
  | "busy"
  | "writer"
  | "terminal"
  | "uncertain";

export interface SatStartCodeRefusal {
  kind: SatStartCodeRefusalKind;
  message: string;
  /** Present for cooldown refusals; the form waits instead of re-submitting. */
  retryAfterSeconds?: number;
  /**
   * The request may have committed (network loss, timeout, server error): the
   * caller must READ state before offering another submission.
   */
  readStateFirst: boolean;
}

interface BackendErrorShape {
  code?: unknown;
  backendCode?: unknown;
  statusCode?: unknown;
  status?: unknown;
  details?: unknown;
  backendDetails?: unknown;
}

function fieldsOf(error: unknown): { code: string | null; reason: string | null; status: number | null; retryAfter: number | null } {
  if (typeof error !== "object" || error === null) return { code: null, reason: null, status: null, retryAfter: null };
  const record = error as BackendErrorShape;
  const code = typeof record.code === "string" ? record.code : typeof record.backendCode === "string" ? record.backendCode : null;
  const details = (record.details ?? record.backendDetails) as { reason?: unknown; retryAfterSeconds?: unknown } | undefined;
  const reason = details && typeof details.reason === "string" ? details.reason : null;
  const retryAfter = details && typeof details.retryAfterSeconds === "number" ? details.retryAfterSeconds : null;
  const rawStatus = typeof record.statusCode === "number" ? record.statusCode : typeof record.status === "number" ? record.status : null;
  return { code, reason, status: rawStatus, retryAfter };
}

/**
 * Maps a start-with-code failure to the one thing the candidate should do
 * next. Anything that does not prove the start was refused is "uncertain":
 * the commit may have happened, so the caller reads authoritative state
 * before any retry (a blind replay could only resume, but the form must not
 * claim the code was wrong).
 */
export function classifyStartCodeError(error: unknown): SatStartCodeRefusal {
  const { code, reason, status, retryAfter } = fieldsOf(error);
  const key = reason ?? code;
  switch (key) {
    case "START_CODE_FORMAT_INVALID":
      return { kind: "format", message: "Enter the 6-digit exam start code.", readStateFirst: false };
    case "START_CODE_INVALID":
      return { kind: "invalid", message: "That exam start code is not correct. Check it with your proctor and try again.", readStateFirst: false };
    case "START_CODE_ROTATED":
      return { kind: "rotated", message: "The exam start code changed. Ask your proctor for the current code.", readStateFirst: false };
    case "START_WINDOW_NOT_OPEN":
      return { kind: "not_open", message: "This exam is not open yet. You can enter the code once it opens.", readStateFirst: false };
    case "START_WINDOW_CLOSED":
      return { kind: "closed", message: "The start window for this exam has closed.", readStateFirst: true };
    case "START_LINK_PAUSED":
    case "RUNTIME_PAUSED":
    case "ATTEMPT_PROCTOR_BLOCKED":
      return { kind: "paused", message: "Starting is paused right now. Wait for your proctor.", readStateFirst: false };
    case "START_LINK_REVOKED":
      return { kind: "revoked", message: "This exam is no longer available. Ask your proctor for help.", readStateFirst: false };
    case "START_CODE_BUSY":
      return {
        kind: "busy",
        message: "The exam is starting other candidates. Keep this page open, then try again when it is ready.",
        retryAfterSeconds: Math.max(1, retryAfter ?? 1),
        // Another request for this attempt may have committed while this one
        // waited, so recover authoritative state before the next submission.
        readStateFirst: true,
      };
    case "START_CODE_RATE_LIMITED":
    case "START_CODE_COOLDOWN":
      return {
        kind: "rate_limited",
        message: "Too many start code attempts. Wait a moment, then try again.",
        retryAfterSeconds: Math.max(1, retryAfter ?? 1),
        readStateFirst: false,
      };
    case "ATTEMPT_TERMINAL":
      return { kind: "terminal", message: "This exam attempt has already ended.", readStateFirst: true };
    case "START_CODE_RELEASE_CONFLICT":
    case "START_CODE_TIMING_CONFLICT":
    case "START_MODE_CONFLICT":
      return { kind: "terminal", message: "This exam session needs your proctor's help to start.", readStateFirst: true };
  }
  if (code === "ACTIVE_SESSION_SUPERSEDED" || code === "LEASE_FENCED" || code === "SESSION_ALREADY_ACTIVE") {
    return {
      kind: "writer",
      message: "This attempt is active on another device. Continue there, or ask your proctor to move it to this device.",
      readStateFirst: true,
    };
  }
  if (status === 429) {
    return { kind: "rate_limited", message: "Too many start code attempts. Wait a moment, then try again.", retryAfterSeconds: Math.max(1, retryAfter ?? 1), readStateFirst: false };
  }
  return { kind: "uncertain", message: "We could not confirm your start. Checking your exam status…", readStateFirst: true };
}
