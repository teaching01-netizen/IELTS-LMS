import { describe, expect, it } from "vitest";
import {
  SAT_POLL_LIVE_CADENCE_MS,
  SAT_POLL_OFFLINE_CADENCE_MS,
  satPollDelayMs,
} from "../satPollCadence";

describe("SAT recovery-poll cadence", () => {
  it("polls the steady cadence while the live socket is connected", () => {
    expect(satPollDelayMs({ liveSocketConnected: true, failures: 0, random: 0 })).toBe(
      SAT_POLL_LIVE_CADENCE_MS / 2,
    );
    expect(satPollDelayMs({ liveSocketConnected: true, failures: 0, random: 1 })).toBe(
      SAT_POLL_LIVE_CADENCE_MS,
    );
  });

  it("polls faster without the live socket — the poll is the only signal", () => {
    expect(satPollDelayMs({ liveSocketConnected: false, failures: 0, random: 0 })).toBe(
      SAT_POLL_OFFLINE_CADENCE_MS / 2,
    );
  });

  it("backs off exponentially, holding the window after three failures", () => {
    const delay = (failures: number) =>
      satPollDelayMs({ liveSocketConnected: false, failures, random: 1 });
    expect(delay(0)).toBe(2_000);
    expect(delay(1)).toBe(4_000);
    expect(delay(2)).toBe(8_000);
    expect(delay(3)).toBe(16_000);
    expect(delay(4)).toBe(16_000);
    expect(delay(50)).toBe(16_000);
    expect(delay(50)).toBeLessThanOrEqual(SAT_POLL_LIVE_CADENCE_MS);
  });

  // Full jitter: the cohort must not reconnect in lockstep, so the delay is
  // half fixed and half random across the current window.
  it("spreads the reconnect herd with full jitter inside the window", () => {
    for (const failures of [0, 1, 2, 3]) {
      const low = satPollDelayMs({ liveSocketConnected: false, failures, random: 0 });
      const high = satPollDelayMs({ liveSocketConnected: false, failures, random: 1 });
      expect(high).toBe(low * 2);
      const mid = satPollDelayMs({ liveSocketConnected: false, failures, random: 0.5 });
      expect(mid).toBeGreaterThan(low);
      expect(mid).toBeLessThan(high);
    }
  });

  it("never returns a negative or non-finite delay", () => {
    for (const failures of [-3, 0, 1, 7]) {
      for (const random of [0, 0.25, 1]) {
        const delay = satPollDelayMs({ liveSocketConnected: false, failures, random });
        expect(Number.isFinite(delay)).toBe(true);
        expect(delay).toBeGreaterThan(0);
      }
    }
  });
});
