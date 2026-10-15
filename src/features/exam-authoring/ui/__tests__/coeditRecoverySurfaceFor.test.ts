import { describe, expect, it } from "vitest";
import { coeditRoomCleanlyEnded } from "../../realtime/coedit";
import { coeditRecoverySurfaceFor } from "../useCoeditRecoveryAndPresence";

describe("coeditRoomCleanlyEnded", () => {
  it("is true only for a closed/replaced, unpublished room known to hold no unsaved work", () => {
    expect(coeditRoomCleanlyEnded({ issue: "replaced", hadUnsavedWork: false })).toBe(true);
    expect(coeditRoomCleanlyEnded({ issue: "closed", hadUnsavedWork: false })).toBe(true);
    expect(coeditRoomCleanlyEnded({ issue: "replaced", hadUnsavedWork: true })).toBe(false);
    expect(coeditRoomCleanlyEnded({ issue: "replaced" })).toBe(false);
    expect(coeditRoomCleanlyEnded({ issue: "replaced", published: true, hadUnsavedWork: false })).toBe(false);
    expect(coeditRoomCleanlyEnded({ issue: "rejected", hadUnsavedWork: false })).toBe(false);
  });
});

describe("coeditRecoverySurfaceFor", () => {
  const base = { issue: "replaced" as const, published: false, coeditUiActive: true };

  it("shows nothing when a clean tab's room was replaced", () => {
    expect(coeditRecoverySurfaceFor({ ...base, hadUnsavedWork: false })).toBeNull();
  });

  it("offers recovery when the tab held unsaved work, or when that is unknown", () => {
    expect(coeditRecoverySurfaceFor({ ...base, hadUnsavedWork: true })).not.toBeNull();
    expect(coeditRecoverySurfaceFor(base)).not.toBeNull();
  });
});
