import { describe, expect, it } from "vitest";
import { SAT_OVERLAY_Z, satOverlayZClass, satSingleModalHolds } from "./satOverlayZ";

describe("satOverlayZ contract", () => {
  it("orders blocking above submission above alerts above tools above save dock", () => {
    expect(SAT_OVERLAY_Z.blockingVeil).toBeGreaterThan(SAT_OVERLAY_Z.submissionVeil);
    expect(SAT_OVERLAY_Z.submissionVeil).toBeGreaterThan(SAT_OVERLAY_Z.leaseNotice);
    expect(SAT_OVERLAY_Z.leaseNotice).toBeGreaterThan(SAT_OVERLAY_Z.routeAlert);
    expect(SAT_OVERLAY_Z.routeAlert).toBeGreaterThan(SAT_OVERLAY_Z.toolSheet);
    expect(SAT_OVERLAY_Z.toolSheet).toBeGreaterThan(SAT_OVERLAY_Z.saveStatusDock);
    expect(SAT_OVERLAY_Z.saveStatusDock).toBeGreaterThan(SAT_OVERLAY_Z.savingHint);
  });

  it("keeps the save alert above tools so failures stay visible", () => {
    expect(SAT_OVERLAY_Z.saveAlert).toBeGreaterThan(SAT_OVERLAY_Z.toolSheet);
  });

  it("orders Bluebook parity layers: blocking > timer warning > submission > lease > viewer > help > break > alerts > more > tools", () => {
    expect(SAT_OVERLAY_Z.blockingVeil).toBeGreaterThan(SAT_OVERLAY_Z.timerWarning);
    expect(SAT_OVERLAY_Z.timerWarning).toBeGreaterThan(SAT_OVERLAY_Z.submissionVeil);
    expect(SAT_OVERLAY_Z.submissionVeil).toBeGreaterThan(SAT_OVERLAY_Z.breakVeil);
    expect(SAT_OVERLAY_Z.breakVeil).toBeGreaterThan(SAT_OVERLAY_Z.leaseNotice);
    expect(SAT_OVERLAY_Z.leaseNotice).toBeGreaterThan(SAT_OVERLAY_Z.imageViewer);
    expect(SAT_OVERLAY_Z.imageViewer).toBeGreaterThan(SAT_OVERLAY_Z.helpModal);
    expect(SAT_OVERLAY_Z.helpModal).toBeGreaterThan(SAT_OVERLAY_Z.breakConfirm);
    expect(SAT_OVERLAY_Z.breakConfirm).toBeGreaterThan(SAT_OVERLAY_Z.routeAlert);
    expect(SAT_OVERLAY_Z.routeAlert).toBeGreaterThan(SAT_OVERLAY_Z.moreMenu);
    expect(SAT_OVERLAY_Z.moreMenu).toBeGreaterThan(SAT_OVERLAY_Z.toolSheet);
    // Help and Shortcuts are mutually exclusive via the single-modal rule,
    // so they share one layer by design.
    expect(SAT_OVERLAY_Z.helpModal).toBe(SAT_OVERLAY_Z.shortcutsModal);
    expect(satOverlayZClass("moreMenu")).toBe("z-[84]");
    expect(satOverlayZClass("helpModal")).toBe("z-[88]");
    expect(satOverlayZClass("breakVeil")).toBe("z-[94]");
    expect(satOverlayZClass("timerWarning")).toBe("z-[96]");
  });

  it("emits tailwind z classes and enforces the single-modal rule", () => {
    expect(satOverlayZClass("blockingVeil")).toBe("z-[100]");
    expect(satSingleModalHolds([])).toBe(true);
    expect(satSingleModalHolds(["toolSheet"])).toBe(true);
    expect(satSingleModalHolds(["toolSheet", "notesBackdrop"])).toBe(false);
  });
});
