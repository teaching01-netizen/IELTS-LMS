import { describe, expect, it } from "vitest";
import { ApiError } from "../../../../shared/api-client/errors";
import {
  isControlEpochStaleRejection,
  isDurabilityReconcileRejection,
  isSectionClosingRejection,
  isStaleConflictRejection,
  isWriterSupersededRejection,
} from "../satSubmitConflicts";

function apiError(code: string, reason?: string, status = 409): ApiError {
  return new ApiError({
    code,
    message: code,
    status,
    details: reason ? { reason } : undefined,
  });
}

describe("SAT submit conflict policy (SAT-007)", () => {
  // The transition reasons the delivery layer emits for clock/state gates.
  it.each([
    "DEADLINE_EXPIRED",
    "RUNTIME_NOT_LIVE",
    "RUNTIME_PAUSED",
    "SECTION_NOT_ACTIVE",
    "SECTION_CLOCK_MISSING",
    "RUNTIME_STAGE_MISSING",
    "MODULE_NOT_ACTIVE",
    "MODULE_MISMATCH",
    "ATTEMPT_TERMINAL",
    "ATTEMPT_PROCTOR_BLOCKED",
  ])("reads %s as a section transition", (reason) => {
    expect(isSectionClosingRejection(apiError("ASSESSMENT_CONFLICT", reason))).toBe(true);
  });

  // Everything else the backend answers with 409 needs its own handling.
  it.each([
    "ACTIVE_SESSION_SUPERSEDED",
    "RESPONSE_REVISION_MISMATCH",
    "VERSION_COLLISION",
    "STAGE_SECTION_MISMATCH",
    "TIMEOUT_RECOVERY_CLOSED",
  ])("does not read %s as a section transition", (reason) => {
    expect(isSectionClosingRejection(apiError("ASSESSMENT_CONFLICT", reason))).toBe(false);
  });

  it("accepts the code-only transition forms", () => {
    expect(isSectionClosingRejection(apiError("DEADLINE_EXPIRED", undefined, 422))).toBe(true);
    expect(isSectionClosingRejection(apiError("TERMINALIZATION_CONFLICT"))).toBe(true);
  });

  // Regression: a bare 409 must never be treated as a transition race — that
  // is the misclassification that told a superseded writer to wait forever.
  it("requires structured code or reason, not the status alone", () => {
    expect(isSectionClosingRejection(Object.assign(new Error("conflict"), { statusCode: 409 }))).toBe(
      false,
    );
    expect(isSectionClosingRejection(new ApiError({ code: "CONFLICT", message: "c", status: 409 }))).toBe(
      false,
    );
  });

  it("tolerates non-error input", () => {
    for (const value of [undefined, null, 409, "409", {}, []]) {
      expect(isSectionClosingRejection(value)).toBe(false);
      expect(isWriterSupersededRejection(value)).toBe(false);
    }
  });

  it("classifies writer supersession by code or reason, never as a transition", () => {
    expect(isWriterSupersededRejection(apiError("ACTIVE_SESSION_SUPERSEDED"))).toBe(true);
    expect(isWriterSupersededRejection(apiError("ASSESSMENT_CONFLICT", "ACTIVE_SESSION_SUPERSEDED"))).toBe(
      true,
    );
    expect(isWriterSupersededRejection(apiError("LEASE_FENCED", undefined, 403))).toBe(true);
    expect(isWriterSupersededRejection(apiError("ASSESSMENT_CONFLICT", "SECTION_NOT_ACTIVE"))).toBe(false);
    expect(isWriterSupersededRejection(apiError("DEADLINE_EXPIRED", undefined, 422))).toBe(false);
  });

  it("sends a crossed pause/resume to the epoch-refresh path, not a transition", () => {
    expect(isControlEpochStaleRejection(apiError("CONTROL_EPOCH_STALE"))).toBe(true);
    expect(isControlEpochStaleRejection(apiError("ASSESSMENT_CONFLICT", "CONTROL_EPOCH_STALE"))).toBe(true);
    expect(isSectionClosingRejection(apiError("CONTROL_EPOCH_STALE"))).toBe(false);
    expect(isControlEpochStaleRejection(apiError("DEADLINE_EXPIRED"))).toBe(false);
  });

  it("sends durable-state disagreements to reconciliation, not a transition", () => {
    for (const code of [
      "VERSION_COLLISION",
      "RESPONSE_REVISION_MISMATCH",
      "WRITE_ID_CONFLICT",
      "RUNTIME_REVISION_STALE",
    ]) {
      expect(isDurabilityReconcileRejection(apiError(code))).toBe(true);
      expect(isDurabilityReconcileRejection(apiError("ASSESSMENT_CONFLICT", code))).toBe(true);
      expect(isSectionClosingRejection(apiError(code))).toBe(false);
      expect(isStaleConflictRejection(apiError(code))).toBe(true);
    }
    expect(isStaleConflictRejection(apiError("DEADLINE_EXPIRED"))).toBe(false);
    expect(isStaleConflictRejection(apiError("ACTIVE_SESSION_SUPERSEDED"))).toBe(false);
  });
});

/**
 * Every code in backend `platform/apperrors/errors.go`. A new backend code must
 * be added here WITH a decision, so it cannot silently inherit transition copy
 * — the exact failure mode this policy exists to prevent.
 */
const BACKEND_CODE_BUCKETS: ReadonlyArray<
  [string, "section-closing" | "writer-superseded" | "control-epoch" | "durability" | "none"]
> = [
  ["BAD_REQUEST", "none"],
  ["VALIDATION_ERROR", "none"],
  ["UNAUTHORIZED", "none"],
  ["FORBIDDEN", "none"],
  ["NOT_FOUND", "none"],
  ["METHOD_NOT_ALLOWED", "none"],
  ["CONFLICT", "none"],
  ["RATE_LIMITED", "none"],
  ["RATE_LIMIT_EXCEEDED", "none"],
  ["PAYLOAD_TOO_LARGE", "none"],
  ["SERVICE_UNAVAILABLE", "none"],
  ["INTERNAL", "none"],
  ["CSRF_FAILED", "none"],
  ["SESSION_EXPIRED", "none"],
  ["ATTEMPT_TOKEN_INVALID", "none"],
  ["ATTEMPT_TOKEN_EXPIRED", "none"],
  ["LEASE_FENCED", "writer-superseded"],
  ["CONTROL_EPOCH_STALE", "control-epoch"],
  ["VERSION_COLLISION", "durability"],
  ["WRITE_ID_CONFLICT", "durability"],
  ["DEADLINE_EXPIRED", "section-closing"],
  ["ATTEMPT_NOT_WRITABLE", "none"],
  ["ATTEMPT_PROCTOR_BLOCKED", "none"],
  ["TERMINALIZATION_CONFLICT", "section-closing"],
  ["TERMINAL_INVARIANT_VIOLATION", "none"],
  ["SUBMISSION_ID_MISUSE", "none"],
  ["RESPONSE_REVISION_MISMATCH", "durability"],
  ["RUNTIME_REVISION_STALE", "durability"],
  ["LEASE_ACQUIRE_FAILED", "none"],
  ["SERVICE_RECOVERY_FAILED", "none"],
  ["ASSESSMENT_CONFLICT", "none"],
  ["ACTIVE_SESSION_SUPERSEDED", "writer-superseded"],
  ["UNSUPPORTED_PROVIDER", "none"],
  ["INVALID_ASSESSMENT", "none"],
  ["ASSESSMENT_RELEASE_INVARIANT", "none"],
  ["STUDENT_WS_RETIRED", "none"],
  ["EXAM_NOT_FOUND", "none"],
  ["DRAFT_INTEGRITY_VIOLATION", "none"],
];

describe("SAT conflict policy covers every backend code", () => {
  it("has a unique, complete table", () => {
    const codes = BACKEND_CODE_BUCKETS.map(([code]) => code);
    expect(new Set(codes).size).toBe(codes.length);
    // 38 codes in platform/apperrors/errors.go. If this count changes, the
    // backend added a code: classify it rather than inheriting a default.
    expect(codes.length).toBe(38);
  });

  it.each(BACKEND_CODE_BUCKETS)("classifies %s as %s", (code, bucket) => {
    const error = apiError(code);
    expect(isSectionClosingRejection(error)).toBe(bucket === "section-closing");
    expect(isWriterSupersededRejection(error)).toBe(bucket === "writer-superseded");
    expect(isControlEpochStaleRejection(error)).toBe(bucket === "control-epoch");
    expect(isDurabilityReconcileRejection(error)).toBe(bucket === "durability");
    expect(isStaleConflictRejection(error)).toBe(bucket === "control-epoch" || bucket === "durability");
  });

  it("treats an unrecognized 409 code as a real failure, never a transition", () => {
    for (const unknown of ["BRAND_NEW_CONFLICT", "MOVED_TO_ANOTHER_SECTION"]) {
      const error = apiError(unknown);
      expect(isSectionClosingRejection(error)).toBe(false);
      expect(isWriterSupersededRejection(error)).toBe(false);
      expect(isStaleConflictRejection(error)).toBe(false);
    }
  });
});
