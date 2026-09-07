import { beforeEach, describe, expect, it } from "vitest";
import {
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
