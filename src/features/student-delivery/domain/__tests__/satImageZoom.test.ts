import { describe, expect, it } from "vitest";
import {
  SAT_IMAGE_ZOOM_MAX,
  SAT_IMAGE_ZOOM_MIN,
  createSatImageZoomState,
  satImageCanZoomIn,
  satImageCanZoomOut,
  satImageClampFocus,
  satImageContentBox,
  satImageGestureTransform,
  satImageIsDirty,
  satImageOffsets,
  satImagePanBy,
  satImagePercentLabel,
  satImageSnapZoom,
  satImageStateFromTransform,
  satImageTransform,
  satImageZoomAtPoint,
  satImageZoomReducer,
  satImageZoomStep,
  type SatImageZoomGeometry,
} from "../satImageZoom";

/**
 * A realistic square figure: the frame is the crop window, the image element
 * has been laid out at the natural size, and 100% therefore fits.
 */
function square(): SatImageZoomGeometry {
  return {
    viewport: { width: 200, height: 200 },
    image: { width: 200, height: 200 },
    natural: { width: 400, height: 400 },
  };
}

/** A figure whose height is capped (`max-h-80`): the painted content is letterboxed. */
function letterboxed(): SatImageZoomGeometry {
  return {
    viewport: { width: 300, height: 240 },
    image: { width: 300, height: 200 },
    natural: { width: 600, height: 200 },
  };
}

/** Nothing measured yet — the source has not loaded. */
function loading(): SatImageZoomGeometry {
  return {
    viewport: { width: 200, height: 200 },
    image: { width: 0, height: 0 },
    natural: { width: 0, height: 0 },
  };
}

describe("satImageZoom", () => {
  it("starts fitted at 100%, fully visible and unpannable", () => {
    const geometry = letterboxed();
    const state = satImageZoomReducer(createSatImageZoomState(), { type: "GEOMETRY_CHANGED" }, geometry);
    expect(satImagePercentLabel(state.zoom)).toBe("100%");
    expect(satImageOffsets(state, geometry)).toEqual({ x: 0, y: 0 });
    // Content fits both axes, so dragging in any direction is a no-op rather
    // than a slow slide into empty space.
    const panned = satImagePanBy(state, 500, 500, geometry);
    expect(satImageOffsets(panned, geometry)).toEqual({ x: 0, y: 0 });
    expect(satImageIsDirty(panned)).toBe(false);
  });

  it("paints the content box with object-contain, honouring a capped image box", () => {
    expect(satImageContentBox(letterboxed())).toEqual({ width: 300, height: 100 });
    expect(satImageContentBox(square())).toEqual({ width: 200, height: 200 });
    expect(satImageContentBox(loading())).toBeNull();
  });

  it("steps in discrete 25% increments and stops at the bounds", () => {
    const geometry = square();
    let state = createSatImageZoomState();
    state = satImageZoomStep(state, 1, geometry);
    expect(satImagePercentLabel(state.zoom)).toBe("125%");
    state = satImageZoomStep(state, 1, geometry);
    expect(satImagePercentLabel(state.zoom)).toBe("150%");
    state = satImageZoomStep(state, -1, geometry);
    expect(satImagePercentLabel(state.zoom)).toBe("125%");
    while (satImageCanZoomIn(state)) state = satImageZoomStep(state, 1, geometry);
    expect(state.zoom).toBe(SAT_IMAGE_ZOOM_MAX);
    expect(satImagePercentLabel(state.zoom)).toBe("300%");
    while (satImageCanZoomOut(state)) state = satImageZoomStep(state, -1, geometry);
    expect(state.zoom).toBe(SAT_IMAGE_ZOOM_MIN);
    expect(satImageCanZoomOut(state)).toBe(false);
    expect(satImageIsDirty(state)).toBe(false);
  });

  it("snaps foreign zoom values onto the step grid", () => {
    expect(satImageSnapZoom(1.37)).toBe(1.25);
    expect(satImageSnapZoom(1.4)).toBe(1.5);
    expect(satImageSnapZoom(0.2)).toBe(SAT_IMAGE_ZOOM_MIN);
    expect(satImageSnapZoom(Number.NaN)).toBe(SAT_IMAGE_ZOOM_MIN);
    expect(satImageSnapZoom(99)).toBe(SAT_IMAGE_ZOOM_MAX);
  });

  it("keeps the content point under the cursor while zooming at a point", () => {
    const geometry = square();
    const state = createSatImageZoomState();
    const point = { x: 60, y: -40 };
    const zoomed = satImageZoomAtPoint(state, point, 1, geometry);
    // The content point that was under the cursor before the zoom...
    const anchoredBefore = 0.5 + point.x / 200;
    // ...is still under it afterwards: window point → focus + point / (content·zoom).
    const anchoredAfter = zoomed.focus.x + point.x / (200 * zoomed.zoom);
    expect(anchoredAfter).toBeCloseTo(anchoredBefore, 6);
    expect(satImagePercentLabel(zoomed.zoom)).toBe("125%");
  });

  it("clamps panning so an edge of the content never leaves the window", () => {
    const geometry = square();
    const zoomed = satImageZoomStep(satImageZoomStep(createSatImageZoomState(), 1, geometry), 1, geometry);
    expect(zoomed.zoom).toBe(1.5);
    // Content is 300px in a 200px window, so 50px is as far as it can travel:
    // dragging past the edge parks there instead of sliding into empty space.
    const dragged = satImageTransform(satImagePanBy(zoomed, 10_000, 10_000, geometry), geometry);
    expect(dragged.offsetX).toBe(50);
    expect(dragged.offsetY).toBe(50);
    const draggedBack = satImageTransform(
      satImagePanBy(zoomed, -10_000, -10_000, geometry),
      geometry,
    );
    expect(draggedBack.offsetX).toBe(-50);
    expect(draggedBack.offsetY).toBe(-50);
    expect(satImageIsDirty(satImagePanBy(zoomed, 10_000, 10_000, geometry))).toBe(true);
  });

  it("holds the focused content point when the window changes size", () => {
    const embedded = square();
    const fullScreen: SatImageZoomGeometry = {
      viewport: { width: 300, height: 300 },
      image: { width: 300, height: 300 },
      natural: { width: 400, height: 400 },
    };
    const zoomed = satImageZoomStep(createSatImageZoomState(), 1, embedded);
    const panned = satImagePanBy(zoomed, -20, 0, embedded);
    const held = satImageClampFocus(panned, fullScreen);
    // Same focus, so the student is still looking at the same part of the graph;
    // only the pixel offset changed, because the window did.
    expect(held.focus).toEqual(panned.focus);
    // A window that can show everything re-centres instead of drifting. At 100%
    // the clamp pins focus, so the same content point cannot be preserved —
    // there is nowhere to pan to.
    const roomy: SatImageZoomGeometry = {
      viewport: { width: 400, height: 400 },
      image: { width: 400, height: 400 },
      natural: { width: 400, height: 400 },
    };
    expect(satImageClampFocus({ zoom: 1, focus: panned.focus }, roomy).focus).toEqual({
      x: 0.5,
      y: 0.5,
    });
  });

  it("clamps a drag and settles when the student lets go", () => {
    const geometry = square();
    // The renderer hands gestures over as intents; the maths stays here.
    const zoomed = satImageTransform(
      satImageZoomStep(satImageZoomStep(createSatImageZoomState(), 1, geometry), 1, geometry),
      geometry,
    );
    const dragged = satImageGestureTransform({
      view: zoomed,
      geometry,
      intent: { kind: "pan", dx: 9_999, dy: 9_999 },
    });
    expect(dragged).toEqual({ zoom: 1.5, offsetX: 50, offsetY: 50 });
    // Release returns the clamped view, so the promise "the figure never leaves
    // the window" holds for the whole gesture, not just for its end.
    expect(satImageGestureTransform({ view: dragged, geometry, intent: { kind: "pan-end" } })).toEqual(
      dragged,
    );
  });

  it("ignores a drag that has nowhere to go", () => {
    const geometry = square();
    const fit = satImageTransform(createSatImageZoomState(), geometry);
    expect(
      satImageGestureTransform({ view: fit, geometry, intent: { kind: "pan", dx: 120, dy: -80 } }),
    ).toEqual(fit);
  });

  it("zooms one level about the point the student pointed at", () => {
    const geometry = square();
    const fit = satImageTransform(createSatImageZoomState(), geometry);
    const point = { x: 50, y: 0 };
    const zoomed = satImageGestureTransform({
      view: fit,
      geometry,
      intent: { kind: "zoom-at-point", point, direction: 1 },
    });
    expect(zoomed.zoom).toBe(1.25);
    // Content is 200 wide; the point 50px right of centre is content 0.75.
    // After the step, that same content point is still 50px right of centre:
    // focus + point / (content · zoom) is unchanged by the zoom itself.
    const anchoredBefore = 0.5 + point.x / 200;
    const anchoredAfter = 0.5 - zoomed.offsetX / (200 * zoomed.zoom) + point.x / (200 * zoomed.zoom);
    expect(anchoredAfter).toBeCloseTo(anchoredBefore, 6);
  });

  it("round-trips state through the renderer's transform", () => {
    const geometry = square();
    const zoomed = satImageZoomStep(satImageZoomStep(createSatImageZoomState(), 1, geometry), 1, geometry);
    const panned = satImagePanBy(zoomed, -12, 8, geometry);
    const transform = satImageTransform(panned, geometry);
    expect(transform.zoom).toBe(1.5);
    expect(satImageStateFromTransform(transform, geometry)).toEqual(panned);
  });

  it("resets to the reference state and reports dirtiness while zoomed or panned", () => {
    const geometry = square();
    const zoomed = satImageZoomStep(createSatImageZoomState(), 1, geometry);
    expect(satImageIsDirty(zoomed)).toBe(true);
    const reset = satImageZoomReducer(zoomed, { type: "RESET" }, geometry);
    expect(reset).toEqual({ zoom: 1, focus: { x: 0.5, y: 0.5 } });
    expect(satImageIsDirty(reset)).toBe(false);
    expect(satImageTransform(reset, geometry)).toEqual({ zoom: 1, offsetX: 0, offsetY: 0 });
  });

  it("stays fitted and steppable while the source is still loading", () => {
    const geometry = loading();
    let state = createSatImageZoomState();
    state = satImageZoomStep(state, 1, geometry);
    expect(state.zoom).toBe(1.25);
    // Nothing measured yet: no maths can move the figure, so it stays centred.
    expect(state.focus).toEqual({ x: 0.5, y: 0.5 });
    expect(satImageOffsets(state, geometry)).toEqual({ x: 0, y: 0 });
    expect(satImageTransform(state, geometry)).toEqual({ zoom: 1.25, offsetX: 0, offsetY: 0 });
    expect(satImagePanBy(state, 100, 100, geometry).focus).toEqual({ x: 0.5, y: 0.5 });
  });
});
