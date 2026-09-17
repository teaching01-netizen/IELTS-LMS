import type { ReactNode } from "react";

export interface SatImageEnlargeSize {
  width: number;
  height: number;
}

/**
 * How the consumer wants the visual's content sized and placed inside the
 * frame: pixels, already clamped by whoever ran the zoom maths. The renderer
 * applies these verbatim and never interprets them — at `zoom: 1` it applies no
 * transform at all, so an untouched figure renders exactly as it always has.
 */
export interface SatImageEnlargeView {
  zoom: number;
  offsetX: number;
  offsetY: number;
}

/**
 * What the frame measured, reported out so the consumer can do the maths:
 * the crop viewport, the image element's own layout box, and the intrinsic size
 * (0×0 until the source loads).
 */
export interface SatImageEnlargeGeometry {
  /** The crop viewport: the frame's inner box, or the full-screen pane's. */
  viewport: SatImageEnlargeSize;
  image: SatImageEnlargeSize;
  natural: SatImageEnlargeSize;
}

export const SAT_IMAGE_ENLARGE_FIT_VIEW: SatImageEnlargeView = {
  zoom: 1,
  offsetX: 0,
  offsetY: 0,
};

export const SAT_IMAGE_ENLARGE_NO_GEOMETRY: SatImageEnlargeGeometry = {
  viewport: { width: 0, height: 0 },
  image: { width: 0, height: 0 },
  natural: { width: 0, height: 0 },
};

export interface SatImageEnlargeProps {
  label: string;
  enlargeId: string;
  src: string;
  /** True while the consumer's full-screen layer is presented. */
  open: boolean;
  view: SatImageEnlargeView;
  geometry: SatImageEnlargeGeometry;
  onOpen: () => void;
  onClose: () => void;
  onViewChange: (view: SatImageEnlargeView) => void;
  returnFocusSelector: string;
}

/**
 * What the student did to the frame, reported as an intent rather than as
 * browser events. `point` is in pixels from the centre of the frame, so the
 * consumer never has to know where the frame is on the page.
 */
export type SatImageGestureIntent =
  | { kind: "pan"; dx: number; dy: number }
  | { kind: "pan-end" }
  | { kind: "zoom-at-point"; point: { x: number; y: number }; direction: 1 | -1 };

/**
 * A gesture on the frame, handed to the consumer. The frame owns the DOM
 * mechanics (pointer capture, deltas, double-click); the consumer owns what the
 * gesture means — steps, anchoring, clamping, whether it is allowed at all —
 * and returns the next view.
 */
export interface SatImageGestureInput {
  view: SatImageEnlargeView;
  geometry: SatImageEnlargeGeometry;
  intent: SatImageGestureIntent;
}

export type SatImageResolveGesture = (input: SatImageGestureInput) => SatImageEnlargeView;

export type SatImageEnlargeSlot = (props: SatImageEnlargeProps) => ReactNode;
