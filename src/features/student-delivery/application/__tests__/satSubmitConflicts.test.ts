import { describe, expect, it } from "vitest";
import { ApiError } from "../../../../shared/api-client/errors";
import {
  isSectionClosingRejection,
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
});
