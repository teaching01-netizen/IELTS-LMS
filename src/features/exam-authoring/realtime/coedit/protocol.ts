import { parseAnyDocumentName } from "./documentIdentity";

/**
 * Counters cross the JSON boundary as decimal strings. Keeping them as
 * strings prevents a browser from rounding a BIGINT before it can compare an
 * acknowledgement or cache epoch.
 */
export type CoeditDecimalString = string;

const MAX_UINT64 = 18_446_744_073_709_551_615n;
const DECIMAL_COUNTER = /^(0|[1-9][0-9]*)$/;

export function isCoeditDecimalString(value: unknown): value is CoeditDecimalString {
  if (typeof value !== "string" || value.length === 0 || value.length > 20) return false;
  if (!DECIMAL_COUNTER.test(value)) return false;
  try {
    return BigInt(value) <= MAX_UINT64;
  } catch {
    return false;
  }
}

/**
 * Orders two counters without ever passing through a JavaScript number.
 *
 * `Number("9007199254740993")` loses the last digit, which would make two
 * distinct commit sequences compare equal — and equal means "ignore this
 * acknowledgement" in the provider. Decimal strings are the wire form for
 * exactly this reason, so the comparison stays in BigInt. Returns null when
 * either side is not a counter, so a caller can distinguish "older" from
 * "not comparable" instead of guessing.
 */
export function compareCoeditDecimalStrings(
  left: unknown,
  right: unknown,
): number | null {
  if (!isCoeditDecimalString(left) || !isCoeditDecimalString(right)) return null;
  const a = BigInt(left);
  const b = BigInt(right);
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/** Reasons that are part of the Phase 1 protocol vocabulary. */
export const COEDIT_FREEZE_CONFLICT_REASON = "coedit_freeze_conflict" as const;
export const COEDIT_EPOCH_MISMATCH_REASON = "coedit_epoch_mismatch" as const;
export const COEDIT_SEED_CONFLICT_REASON = "coedit_seed_conflict" as const;
export const COEDIT_FINAL_STORE_REQUIRED_REASON = "coedit_final_store_required" as const;
export const COEDIT_STALE_CACHE_REASON = "coedit_stale_cache" as const;

export const COEDIT_PHASE1_REASONS = [
  COEDIT_FREEZE_CONFLICT_REASON,
  COEDIT_EPOCH_MISMATCH_REASON,
  COEDIT_SEED_CONFLICT_REASON,
  COEDIT_FINAL_STORE_REQUIRED_REASON,
  COEDIT_STALE_CACHE_REASON,
] as const;

export type CoeditPhase1Reason = (typeof COEDIT_PHASE1_REASONS)[number];

export function isCoeditPhase1Reason(value: unknown): value is CoeditPhase1Reason {
  return typeof value === "string" && (COEDIT_PHASE1_REASONS as readonly string[]).includes(value);
}

/** Ownership and expiry metadata for a single lifecycle operation. */
export interface CoeditLifecycleOperation {
  freezeOperationId: string;
  /** Unix timestamp in seconds; unlike BIGINT counters this is safe in JS. */
  freezeExpiresAt: number;
}

/**
 * Durable state metadata used by both rebase responses and cache recovery.
 * `room` is the logical opaque room name, not a user-provided domain id.
 */
export interface CoeditDurabilityMetadata {
  room: string;
  stateEpoch: CoeditDecimalString;
  stateHash: string;
  commitSequence: CoeditDecimalString;
  safeToDiscardCache: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isLifecycleOperationId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 128 &&
    /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(value)
  );
}

export function isCoeditLifecycleOperation(value: unknown): value is CoeditLifecycleOperation {
  if (!isRecord(value)) return false;
  return isLifecycleOperationId(value["freezeOperationId"]) && isFreezeExpiry(value["freezeExpiresAt"]);
}

function isFreezeExpiry(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isStateHash(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

/** Parses durable metadata without coercing counters through Number. */
export function parseCoeditDurabilityMetadata(raw: unknown): CoeditDurabilityMetadata | null {
  if (!isRecord(raw)) return null;
  if (
    typeof raw["room"] !== "string" ||
    raw["room"] !== raw["room"].trim() ||
    parseAnyDocumentName(raw["room"]) === null ||
    !isCoeditDecimalString(raw["stateEpoch"]) ||
    !isStateHash(raw["stateHash"]) ||
    !isCoeditDecimalString(raw["commitSequence"]) ||
    typeof raw["safeToDiscardCache"] !== "boolean"
  ) {
    return null;
  }
  return {
    room: raw["room"],
    stateEpoch: raw["stateEpoch"],
    stateHash: raw["stateHash"],
    commitSequence: raw["commitSequence"],
    safeToDiscardCache: raw["safeToDiscardCache"],
  };
}
