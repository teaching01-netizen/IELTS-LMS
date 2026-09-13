import { describe, expect, it } from "vitest";
import {
  SAT_DRAG_THRESHOLD_PX,
  SAT_TOOL_ALIGN_PX,
  alignToSafeArea,
  dragExceeded,
  resizeGeometry,
} from "./satToolPointer";

describe("satToolPointer", () => {
  it("gates drags behind a small movement threshold", () => {
    expect(SAT_DRAG_THRESHOLD_PX).toBe(4);
    expect(dragExceeded(0, 0, 2, 1)).toBe(false);
    expect(dragExceeded(0, 0, 4, 0)).toBe(true);
    expect(dragExceeded(600, 110, 601, 111)).toBe(false);
    expect(dragExceeded(600, 110, 610, 120)).toBe(true);
  });

  it("moves the correct corner per edge and pins the content minimum", () => {
    const start = { x: 60, y: 110, w: 420, h: 520 };
    expect(resizeGeometry(start, "e", 40, 0, { w: 400, h: 480 })).toMatchObject({ x: 60, w: 460 });
    expect(resizeGeometry(start, "w", 10, 0, { w: 400, h: 480 })).toMatchObject({ x: 70, w: 410 });
    // 200px past the minimum stays pinned exactly at the minimum.
    expect(resizeGeometry(start, "w", 220, 0, { w: 400, h: 480 })).toMatchObject({ x: 80, w: 400 });
    expect(resizeGeometry(start, "n", 0, 240, { w: 400, h: 480 })).toMatchObject({ y: 150, h: 480 });
    expect(resizeGeometry(start, "ne", 20, 30, { w: 400, h: 480 })).toMatchObject({ w: 440, h: 490 });
  });

  it("snaps within the assist radius and leaves distant rects untouched", () => {
    expect(SAT_TOOL_ALIGN_PX).toBe(8);
    const safe = { x: 16, y: 16, w: 1162, h: 802 };
    const nearRight = { x: 753, y: 110, w: 420, h: 520 };
    expect(alignToSafeArea(nearRight, safe).x).toBe(758);
    const far = { x: 600, y: 110, w: 420, h: 520 };
    expect(alignToSafeArea(far, safe)).toBe(far);
  });
});
