import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { SatImageEnlargeView } from "../../exam-rendering/api/structuredContentEnlarge";
import {
  satImageCanZoomIn,
  satImageCanZoomOut,
  satImageClampFocus,
  satImageContentBox,
  satImageIsDirty,
  satImagePercent,
  satImageStateFromTransform,
  satImageTransform,
  satImageZoomReducer,
  type SatImageZoomEvent,
  type SatImageZoomGeometry,
  type SatImageZoomState,
  type SatImageZoomTransform,
} from "../domain/satImageZoom";

/**
 * The viewing half of the figure viewer: a *controlled* controller.
 *
 * The view (and the geometry it was measured in) live with the image, in
 * exam-rendering, exactly like the full-screen flag does — so navigating
 * questions, unmounting a figure, or switching presentations cannot leave
 * magnification behind. This hook is the only place that translates between
 * that stored pixel transform and the content-relative state the maths uses.
 *
 * Every action re-derives the pixels from the geometry at hand, which is why a
 * window resize, a split-pane drag, or the move into full screen keeps the
 * student looking at the same part of the figure instead of jumping.
 */

export interface SatImageZoomController {
  state: SatImageZoomState;
  zoom: number;
  percent: string;
  canZoomIn: boolean;
  canZoomOut: boolean;
  dirty: boolean;
  /** `null` at 100%: nothing to transform, so nothing is styled. */
  transform: SatImageZoomTransform | null;
  zoomIn: () => void;
  zoomOut: () => void;
  /** Zoom about a point measured from the centre of the window (cursor, pinch). */
  zoomAtPoint: (point: { x: number; y: number }, direction: 1 | -1) => void;
  panBy: (dx: number, dy: number) => void;
  reset: () => void;
}

const EPSILON = 0.01;

function differs(current: SatImageEnlargeView, next: SatImageZoomTransform): boolean {
  return (
    Math.abs(current.zoom - next.zoom) > 1e-6 ||
    Math.abs(current.offsetX - next.offsetX) > EPSILON ||
    Math.abs(current.offsetY - next.offsetY) > EPSILON
  );
}

export function useSatImageZoom(input: {
  view: SatImageEnlargeView;
  geometry: SatImageZoomGeometry;
  onViewChange: (view: SatImageEnlargeView) => void;
}): SatImageZoomController {
  const { view, geometry } = input;
  const changeRef = useRef(input.onViewChange);
  const viewRef = useRef(view);
  const geometryRef = useRef(geometry);

  useEffect(() => {
    changeRef.current = input.onViewChange;
  }, [input.onViewChange]);

  useEffect(() => {
    viewRef.current = view;
  }, [view]);

  // Geometry is compared by value, not identity: a re-measure that changes
  // nothing must not restart the effect.
  const { viewport, image: imageBox, natural } = geometry;
  useEffect(() => {
    geometryRef.current = geometry;
    // Nothing has been laid out or loaded yet: there is no correct answer to
    // "where should this sit?", so the stored view is left untouched rather than
    // re-centred from a window that does not exist.
    if (!satImageContentBox(geometry)) return;
    const clamped = satImageClampFocus(
      satImageStateFromTransform(viewRef.current, geometry),
      geometry,
    );
    const next = satImageTransform(clamped, geometry);
    if (differs(viewRef.current, next)) {
      viewRef.current = next;
      changeRef.current(next);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- boxes are the value identity of `geometry`.
  }, [
    viewport.width,
    viewport.height,
    imageBox.width,
    imageBox.height,
    natural.width,
    natural.height,
  ]);

  const dispatch = useCallback((event: SatImageZoomEvent) => {
    const active = geometryRef.current;
    const current = satImageStateFromTransform(viewRef.current, active);
    const next = satImageTransform(satImageZoomReducer(current, event, active), active);
    viewRef.current = next;
    changeRef.current(next);
  }, []);

  const state = satImageStateFromTransform(view, geometry);

  return {
    state,
    zoom: state.zoom,
    percent: satImagePercent(state),
    canZoomIn: satImageCanZoomIn(state),
    canZoomOut: satImageCanZoomOut(state),
    dirty: satImageIsDirty(state),
    transform: state.zoom > 1 ? satImageTransform(state, geometry) : null,
    zoomIn: useCallback(() => dispatch({ type: "ZOOM_IN" }), [dispatch]),
    zoomOut: useCallback(() => dispatch({ type: "ZOOM_OUT" }), [dispatch]),
    zoomAtPoint: useCallback(
      (point: { x: number; y: number }, direction: 1 | -1) =>
        dispatch({ type: "ZOOM_AT_POINT", point, direction }),
      [dispatch],
    ),
    panBy: useCallback((dx: number, dy: number) => dispatch({ type: "PAN_BY", dx, dy }), [dispatch]),
    reset: useCallback(() => dispatch({ type: "RESET" }), [dispatch]),
  };
}

/**
 * Geometry of a window the viewer owns (the full-screen pane), measured from
 * the DOM the same way the question frame measures itself.
 *
 * Layout boxes, never rects: the image carries the zoom transform, and a
 * transformed rect would report the zoomed size back as its own.
 */
export function useSatImageWindowGeometry(input: {
  windowRef: RefObject<HTMLElement | null>;
  imageRef: RefObject<HTMLImageElement | null>;
  enabled: boolean;
  /** Intrinsic size known from the embedded figure, for the first frames before load. */
  naturalFallback?: { width: number; height: number } | undefined;
}): SatImageZoomGeometry {
  const naturalFallbackWidth = input.naturalFallback?.width ?? 0;
  const naturalFallbackHeight = input.naturalFallback?.height ?? 0;
  const geometryRef = useRef<SatImageZoomGeometry>(emptyGeometry());
  const [, setTick] = useState(0);

  const measure = useCallback(() => {
    const windowElement = input.windowRef.current;
    const image = input.imageRef.current;
    if (!windowElement || !image) return;
    const measured: SatImageZoomGeometry = {
      viewport: { width: windowElement.clientWidth, height: windowElement.clientHeight },
      image: { width: image.offsetWidth, height: image.offsetHeight },
      natural: {
        width: image.naturalWidth || naturalFallbackWidth,
        height: image.naturalHeight || naturalFallbackHeight,
      },
    };
    const current = geometryRef.current;
    if (sameGeometry(current, measured)) return;
    geometryRef.current = measured;
    setTick((tick) => tick + 1);
  }, [input.windowRef, input.imageRef, naturalFallbackWidth, naturalFallbackHeight]);

  useEffect(() => {
    if (!input.enabled) return;
    const windowElement = input.windowRef.current;
    const image = input.imageRef.current;
    if (!windowElement || !image) return;
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(windowElement);
    observer.observe(image);
    image.addEventListener("load", measure);
    return () => {
      observer.disconnect();
      image.removeEventListener("load", measure);
    };
  }, [input.enabled, measure, input.windowRef, input.imageRef]);

  return geometryRef.current;
}

function emptyGeometry(): SatImageZoomGeometry {
  const zero = { width: 0, height: 0 };
  return { viewport: { ...zero }, image: { ...zero }, natural: { ...zero } };
}

function sameGeometry(a: SatImageZoomGeometry, b: SatImageZoomGeometry): boolean {
  return (
    a.viewport.width === b.viewport.width &&
    a.viewport.height === b.viewport.height &&
    a.image.width === b.image.width &&
    a.image.height === b.image.height &&
    a.natural.width === b.natural.width &&
    a.natural.height === b.natural.height
  );
}
