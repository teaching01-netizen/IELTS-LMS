import { beforeEach, describe, expect, it } from "vitest";
import {
  SAT_EXAM_ZOOM_MAX,
  SAT_EXAM_ZOOM_MIN,
  clampSatExamZoom,
  createSatReadingPreferences,
  normalizeSatReadingPreferences,
} from "../../domain/satReadingPreferences";
import {
  clearSatReadingPreferences,
  loadSatReadingPreferences,
  satReadingPreferencesKey,
  saveSatReadingPreferences,
} from "../../infrastructure/satReadingPreferencesStore";

describe("SAT reading preferences", () => {
  beforeEach(() => window.localStorage.clear());

  it("repairs corrupt or out-of-range state to safe tested values", () => {
    expect(normalizeSatReadingPreferences(null)).toEqual(createSatReadingPreferences());
    expect(
      normalizeSatReadingPreferences({
        version: 99,
        textScale: 2,
        lineSpacing: "relaxed",
        splitRatio: 0.62,
      })
    ).toEqual(createSatReadingPreferences());
    expect(
      normalizeSatReadingPreferences({
        version: 1,
        textScale: 1.27,
        lineSpacing: "wide",
        splitRatio: 0.9,
      })
    ).toEqual({
      version: 1,
      textScale: 1,
      lineSpacing: "standard",
      splitRatio: 0.62,
    });
  });

  it("keeps screen zoom on the 50%-200% grid, resting at 100% for bad input", () => {
    expect(SAT_EXAM_ZOOM_MIN).toBe(0.5);
    expect(clampSatExamZoom(1)).toBe(1);
    expect(clampSatExamZoom(0.75)).toBe(0.75);
    expect(clampSatExamZoom(0.5)).toBe(0.5);
    // Off-grid input snaps to the nearest step, then clamps to the floor.
    expect(clampSatExamZoom(0.6)).toBe(0.5);
    expect(clampSatExamZoom(1.37)).toBe(1.25);
    expect(clampSatExamZoom(0.1)).toBe(SAT_EXAM_ZOOM_MIN);
    expect(clampSatExamZoom(99)).toBe(SAT_EXAM_ZOOM_MAX);
    expect(clampSatExamZoom(Number.NaN)).toBe(1);
    expect(clampSatExamZoom(Number.POSITIVE_INFINITY)).toBe(1);
  });

  it("repairs a stored zoom below the floor instead of silently restoring 100%", () => {
    const stored = (examZoom: number): number | undefined =>
      normalizeSatReadingPreferences({ ...createSatReadingPreferences(), examZoom }).examZoom;
    // Below the floor clamps to the floor — the student keeps a smaller exam.
    expect(stored(0.4)).toBe(SAT_EXAM_ZOOM_MIN);
    expect(stored(0.75)).toBe(0.75);
    expect(stored(0.5)).toBe(0.5);
    expect(stored(3)).toBe(SAT_EXAM_ZOOM_MAX);
  });

  it("persists independently per schedule and attempt", () => {
    const preferred = {
      version: 1 as const,
      textScale: 1.5 as const,
      lineSpacing: "relaxed" as const,
      splitRatio: 0.55,
      lineReaderEnabled: true,
      lineReaderPosition: 0.65,
      examZoom: 1.5,
      contrastMode: 'high-contrast' as const,
    };
    expect(saveSatReadingPreferences("schedule-1", "attempt-1", preferred)).toBe(true);
    expect(loadSatReadingPreferences("schedule-1", "attempt-1")).toEqual(preferred);
    expect(loadSatReadingPreferences("schedule-1", "attempt-2")).toEqual(
      createSatReadingPreferences()
    );
    expect(loadSatReadingPreferences("schedule-2", "attempt-1")).toEqual(
      createSatReadingPreferences()
    );
  });

  it("clears only the completed attempt and recovers malformed JSON", () => {
    saveSatReadingPreferences("schedule-1", "attempt-1", {
      ...createSatReadingPreferences(),
      textScale: 2,
    });
    saveSatReadingPreferences("schedule-1", "attempt-2", {
      ...createSatReadingPreferences(),
      lineSpacing: "relaxed",
    });
    clearSatReadingPreferences("schedule-1", "attempt-1");
    expect(
      window.localStorage.getItem(satReadingPreferencesKey("schedule-1", "attempt-1"))
    ).toBeNull();
    expect(loadSatReadingPreferences("schedule-1", "attempt-2").lineSpacing).toBe("relaxed");

    window.localStorage.setItem(satReadingPreferencesKey("schedule-1", "broken"), "{not json");
    expect(loadSatReadingPreferences("schedule-1", "broken")).toEqual(
      createSatReadingPreferences()
    );
    expect(
      window.localStorage.getItem(satReadingPreferencesKey("schedule-1", "broken"))
    ).toBeNull();
  });
});
