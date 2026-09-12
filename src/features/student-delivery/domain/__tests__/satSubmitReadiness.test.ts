import { describe, expect, it } from "vitest";
import {
  deriveSatSubmitReadiness,
  isSatSubmitHardBlocked,
  satSubmitNeedsReason,
} from "../satSubmitReadiness";

describe("deriveSatSubmitReadiness", () => {
  it("is ready when nothing is pending, failing, or submitting", () => {
    expect(
      deriveSatSubmitReadiness({ isSubmitting: false, failure: null, failureKind: null, pendingCount: 0 }),
    ).toEqual({ status: "ready" });
  });

  it("reports saving with the pending count instead of a bare disabled", () => {
    expect(
      deriveSatSubmitReadiness({ isSubmitting: false, failure: null, failureKind: null, pendingCount: 2 }),
    ).toEqual({ status: "saving", pendingCount: 2 });
  });

  it("blocks offline with a reason, never a silent disabled", () => {
    const readiness = deriveSatSubmitReadiness({
      isSubmitting: false,
      failure: "Offline",
      failureKind: "offline",
      pendingCount: 3,
    });
    expect(readiness).toEqual({ status: "blocked-offline" });
    expect(isSatSubmitHardBlocked(readiness)).toBe(true);
    expect(satSubmitNeedsReason(readiness)).toBe(true);
  });

  it("blocks retryable/terminal/superseded errors with their kind preserved", () => {
    for (const failureKind of ["retryable", "terminal", "superseded"] as const) {
      const readiness = deriveSatSubmitReadiness({
        isSubmitting: false,
        failure: "boom",
        failureKind,
        pendingCount: 0,
      });
      expect(readiness).toEqual({ status: "blocked-error", failureKind });
      expect(isSatSubmitHardBlocked(readiness)).toBe(true);
    }
  });

  it("treats submitting as its own state regardless of queue depth", () => {
    expect(
      deriveSatSubmitReadiness({ isSubmitting: true, failure: null, failureKind: null, pendingCount: 5 }),
    ).toEqual({ status: "submitting" });
  });

  it("keeps saving soft (aria-disabled) and blocked hard (disabled)", () => {
    expect(isSatSubmitHardBlocked({ status: "saving", pendingCount: 1 })).toBe(false);
    expect(satSubmitNeedsReason({ status: "saving", pendingCount: 1 })).toBe(true);
    expect(satSubmitNeedsReason({ status: "ready" })).toBe(false);
    expect(satSubmitNeedsReason({ status: "submitting" })).toBe(false);
  });
});
