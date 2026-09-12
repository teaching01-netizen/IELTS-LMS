import { describe, expect, it } from "vitest";
import {
  COARSE_CLOCK_MS,
  URGENT_THRESHOLD_SECONDS,
  resolveAuthoritativeRemainingSeconds,
} from "../useAuthoritativeDeadlineClock";

const NOW = Date.parse("2026-09-10T08:00:00.000Z");

function remaining(deadlineOffsetMs: number, extra: Partial<Parameters<typeof resolveAuthoritativeRemainingSeconds>[0]> = {}) {
  return resolveAuthoritativeRemainingSeconds({
    deadlineAt: new Date(NOW + deadlineOffsetMs).toISOString(),
    clockOffsetMs: 0,
    fallbackSeconds: 999,
    running: true,
    nowMs: NOW,
    ...extra,
  });
}

describe("resolveAuthoritativeRemainingSeconds", () => {
  it("counts down from the server-authoritative deadline", () => {
    expect(remaining(90_000)).toBe(90);
  });

  it("clamps at zero past the deadline instead of going negative", () => {
    expect(remaining(-5_000)).toBe(0);
  });

  it("returns the exact boundary second at the deadline instant", () => {
    expect(remaining(0)).toBe(0);
    expect(remaining(1_000)).toBe(1);
  });

  it("falls back when paused, missing a deadline, or given garbage", () => {
    expect(remaining(90_000, { running: false })).toBe(999);
    expect(remaining(90_000, { deadlineAt: null })).toBe(999);
    expect(remaining(90_000, { deadlineAt: "not-a-date" })).toBe(999);
    expect(remaining(90_000, { clockOffsetMs: Number.NaN })).toBe(999);
  });

  it("applies the server clock offset instead of trusting the device clock", () => {
    expect(remaining(90_000, { clockOffsetMs: 30_000 })).toBe(60);
  });

  it("keeps the coarse band honest: 15s tick only matters far from deadline", () => {
    // A 15s-stale coarse tick near the deadline could hide at most one
    // displayed minute step — acceptable for roster rows, which is why only
    // rows above the urgency threshold ride the coarse clock.
    expect(COARSE_CLOCK_MS).toBe(15_000);
    expect(URGENT_THRESHOLD_SECONDS).toBe(300);
    expect(remaining(URGENT_THRESHOLD_SECONDS * 1_000)).toBe(300);
  });
});
