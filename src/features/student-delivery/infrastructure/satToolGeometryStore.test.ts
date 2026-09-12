import { beforeEach, describe, expect, it } from "vitest";
import {
  clampSatToolGeometry,
  loadSatToolGeometry,
  normalizeSatToolGeometry,
  saveSatToolGeometry,
  satToolGeometryKey,
} from "./satToolGeometryStore";

describe("satToolGeometryStore", () => {
  beforeEach(() => localStorage.clear());

  it("round-trips geometry through a versioned key", () => {
    const key = satToolGeometryKey("s", "a", "m", "calculator");
    expect(key).toContain("v1");
    expect(saveSatToolGeometry(key, { x: 100, y: 110, w: 420, h: 520 })).toBe(true);
    expect(loadSatToolGeometry(key)).toEqual({ x: 100, y: 110, w: 420, h: 520 });
  });

  it("rejects corrupt entries and removes them", () => {
    const key = satToolGeometryKey("s", "a", "m", "reference");
    localStorage.setItem(key, "{not json");
    expect(loadSatToolGeometry(key)).toBeNull();
    expect(localStorage.getItem(key)).toBeNull();
  });

  it("clamps restored geometry inside the viewport", () => {
    const clamped = clampSatToolGeometry({ x: 5000, y: 3000, w: 9000, h: 9000 }, { w: 1280, h: 800 });
    expect(clamped.w).toBeLessThanOrEqual(1280 - 32);
    expect(clamped.h).toBeLessThanOrEqual(800 - 32);
    expect(clamped.x).toBeLessThanOrEqual(1280 - 48);
    expect(clamped.y).toBeLessThanOrEqual(800 - 48);
  });

  it("enforces minimum sizes", () => {
    expect(normalizeSatToolGeometry({ x: 0, y: 0, w: 10, h: 10 })).toMatchObject({ w: 320, h: 360 });
  });
});
