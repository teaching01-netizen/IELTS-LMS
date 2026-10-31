import { describe, expect, it } from "vitest";
import { SAT_COPY } from "../satCopy";
import { satUnsyncedDismissKey, satUnsyncedSeverity } from "../satUnsyncedNotice";

describe("SAT unsynced notice decision", () => {
  it("escalates from silent to slow to offline at the configured ages", () => {
    expect(satUnsyncedSeverity(0, 10_000, 30_000)).toBeNull();
    expect(satUnsyncedSeverity(9_999, 10_000, 30_000)).toBeNull();
    expect(satUnsyncedSeverity(10_000, 10_000, 30_000)).toBe("slow");
    expect(satUnsyncedSeverity(29_999, 10_000, 30_000)).toBe("slow");
    expect(satUnsyncedSeverity(30_000, 10_000, 30_000)).toBe("offline");
    expect(satUnsyncedSeverity(Number.NaN, 10_000, 30_000)).toBeNull();
  });

  it("keys dismissal to the window and severity", () => {
    expect(satUnsyncedDismissKey(null, null)).toBeNull();
    expect(satUnsyncedDismissKey(1_000, null)).toBeNull();
    expect(satUnsyncedDismissKey(1_000, "slow")).toBe("1000:slow");
    // Escalation is a new key: a dismissed slow banner must reopen.
    expect(satUnsyncedDismissKey(1_000, "offline")).toBe("1000:offline");
    // A new window is a new key even at the same severity.
    expect(satUnsyncedDismissKey(2_000, "slow")).toBe("2000:slow");
  });

  it("keeps non-alarming copy for the slow stage and an actionable offline stage", () => {
    expect(SAT_COPY.notice.unsyncedSlow).toContain("Still saving");
    expect(SAT_COPY.notice.unsyncedSlow).not.toContain("failed");
    expect(SAT_COPY.notice.unsyncedOffline).toContain("only on this device");
    expect(SAT_COPY.notice.dismiss).toBe("Dismiss message");
  });
});
