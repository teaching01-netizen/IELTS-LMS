/**
 * SAT figure inspection — the pure half of the Bluebook two-layer model.
 *
 * A question's visual is exam content first and an inspectable object second:
 * it opens at 100% (fitted, fully visible), a quiet strip above it steps the
 * magnification up and down, and Full screen escalates the *same* view into a
 * larger window. None of that decides anything here — this module owns only the
 * numbers, so the behaviour is testable without a DOM.
 *
 * The state is deliberately content-relative, not pixel-relative:
 *
 *     { zoom, focus }        focus ∈ 0..1 over the content box
 *
 * Pixel offsets are derived from the geometry at hand, which is what makes the
 * three promises fall out of one clamp function:
 *
 *   - the focal point survives a viewport change (window resize, split-pane
 *     drag, embedded ⇄ full screen), because a focus in content coordinates
 *     means the same thing in every window;
 *   - the figure can never be lost off-screen, because focus is clamped so the
 *     content always covers the window;
 *   - 100% is a real reference state, because at zoom 1 the content fits, the
 *     clamp pins focus to the centre, and there is nothing left to restore.
 *
 * Zoom values are step-aligned integers, so repeated presses cannot drift into
 * 137.00000001% — a student reads "slightly bigger", not a float.
 */

export const SAT_IMAGE_ZOOM_MIN = 1;
export const SAT_IMAGE_ZOOM_MAX = 3;
export const SAT_IMAGE_ZOOM_STEP = 0.25;

const MAX_ZOOM_STEPS = Math.round((SAT_IMAGE_ZOOM_MAX - SAT_IMAGE_ZOOM_MIN) / SAT_IMAGE_ZOOM_STEP);

/** The centre of the content — the resting focus, and 100%'s only focus. */
export const SAT_IMAGE_ZOOM_CENTER = { x: 0.5, y: 0.5 } as const;

export interface SatImageZoomSize {
  width: number;
  height: number;
}

/**
 * The three boxes the maths needs. They are genuinely distinct: the image
 * element lays `object-contain` out inside itself (so a stored `max-h-80` can
 * leave the painted content smaller than the element), and the crop viewport is
 * the frame around it.
 *
 *   viewport — what the student can see (the frame, or the full-screen pane)
 *   image    — the image element's own layout box, before any zoom transform
 *   natural  — intrinsic pixels; 0×0 until the source loads
 */
export interface SatImageZoomGeometry {
  viewport: SatImageZoomSize;
  image: SatImageZoomSize;
  natural: SatImageZoomSize;
}

export interface SatImageZoomState {
  zoom: number;
  /** Which point of the content sits at the centre of the window. */
  focus: { x: number; y: number };
}

/**
 * The presentation-ready form the renderer applies: pixels, already clamped.
 * Field-for-field the slot's view type, so the seam carries no second dialect.
 */
export interface SatImageZoomTransform {
  zoom: number;
  offsetX: number;
  offsetY: number;
}

export type SatImageZoomEvent =
  | { type: "ZOOM_IN" }
  | { type: "ZOOM_OUT" }
  | { type: "RESET" }
  | { type: "ZOOM_AT_POINT"; direction: 1 | -1; point: { x: number; y: number } }
  | { type: "PAN_BY"; dx: number; dy: number }
  | { type: "GEOMETRY_CHANGED" };

export function createSatImageZoomState(): SatImageZoomState {
  return { zoom: SAT_IMAGE_ZOOM_MIN, focus: { ...SAT_IMAGE_ZOOM_CENTER } };
}

function dimensions(geometry: SatImageZoomGeometry): {
  content: SatImageZoomSize;
  viewport: SatImageZoomSize;
} | null {
  const { natural, image, viewport } = geometry;
  if (natural.width <= 0 || natural.height <= 0) return null;
  if (image.width <= 0 || image.height <= 0) return null;
  // `object-contain`: the painted content is the natural box scaled by whichever
  // axis runs out first.
  const fit = Math.min(image.width / natural.width, image.height / natural.height);
  if (!Number.isFinite(fit) || fit <= 0) return null;
  return {
    content: { width: natural.width * fit, height: natural.height * fit },
    viewport,
  };
}

/** The painted content box at 100%, or null while the source is still loading. */
export function satImageContentBox(geometry: SatImageZoomGeometry): SatImageZoomSize | null {
  return dimensions(geometry)?.content ?? null;
}

function scaledAxis(content: number, zoom: number): number {
  return content * zoom;
}

/**
 * How far the content may travel before its own edge would leave the window's
 * edge. Zero when the content is smaller than the window — which is what makes
 * panning simply impossible at 100%, rather than merely pointless.
 */
function maxOffset(axis: { content: number; viewport: number }, zoom: number): number {
  const scaled = scaledAxis(axis.content, zoom);
  return Math.max(0, (scaled - axis.viewport) / 2);
}

/** Pins the focus so the content always covers the window. */
export function satImageClampFocus(
  state: SatImageZoomState,
  geometry: SatImageZoomGeometry,
): SatImageZoomState {
  const dims = dimensions(geometry);
  if (!dims) return { zoom: state.zoom, focus: { ...SAT_IMAGE_ZOOM_CENTER } };
  const limitX = maxOffset(
    { content: dims.content.width, viewport: dims.viewport.width },
    state.zoom,
  );
  const limitY = maxOffset(
    { content: dims.content.height, viewport: dims.viewport.height },
    state.zoom,
  );
  const room = {
    x: limitX / scaledAxis(dims.content.width, state.zoom),
    y: limitY / scaledAxis(dims.content.height, state.zoom),
  };
  return {
    zoom: state.zoom,
    focus: {
      x: clamp(state.focus.x, 0.5 - room.x, 0.5 + room.x),
      y: clamp(state.focus.y, 0.5 - room.y, 0.5 + room.y),
    },
  };
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return (min + max) / 2;
  return Math.min(max, Math.max(min, value));
}

/** Snaps an arbitrary zoom to the nearest step, so foreign input cannot drift. */
export function satImageSnapZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return SAT_IMAGE_ZOOM_MIN;
  const steps = Math.round((zoom - SAT_IMAGE_ZOOM_MIN) / SAT_IMAGE_ZOOM_STEP);
  return satImageZoomFromSteps(clamp(steps, 0, MAX_ZOOM_STEPS));
}

function satImageZoomFromSteps(steps: number): number {
  // Multiplication on whole steps keeps 125/150/175 exact in binary floats.
  return SAT_IMAGE_ZOOM_MIN + steps * SAT_IMAGE_ZOOM_STEP;
}

export function satImageZoomSteps(zoom: number): number {
  return Math.round((satImageSnapZoom(zoom) - SAT_IMAGE_ZOOM_MIN) / SAT_IMAGE_ZOOM_STEP);
}

export function satImageCanZoomIn(state: SatImageZoomState): boolean {
  return satImageZoomSteps(state.zoom) < MAX_ZOOM_STEPS;
}

export function satImageCanZoomOut(state: SatImageZoomState): boolean {
  return satImageZoomSteps(state.zoom) > 0;
}

/**
 * True when anything is left to restore: zoomed, or panned off-centre. Drives
 * Reset's enabled state — the control itself is always present, so the strip
 * never shifts under the student's finger.
 */
export function satImageIsDirty(state: SatImageZoomState): boolean {
  return (
    satImageZoomSteps(state.zoom) !== 0 ||
    Math.abs(state.focus.x - 0.5) > 1e-6 ||
    Math.abs(state.focus.y - 0.5) > 1e-6
  );
}

/** Human-facing magnification, e.g. "125%". Status and confirmation in one. */
export function satImagePercentLabel(zoom: number): string {
  return Math.round(satImageSnapZoom(zoom) * 100) + "%";
}

export function satImagePercent(state: SatImageZoomState): string {
  return satImagePercentLabel(state.zoom);
}

/**
 * Steps the magnification while holding the current focus.
 *
 * Holding focus — rather than the window centre — is what makes the buttons
 * feel like they magnify what the student is already looking at; after a pan,
 * zooming in keeps the corner they travelled to on screen.
 */
export function satImageZoomStep(
  state: SatImageZoomState,
  direction: 1 | -1,
  geometry: SatImageZoomGeometry,
): SatImageZoomState {
  const steps = clamp(satImageZoomSteps(state.zoom) + direction, 0, MAX_ZOOM_STEPS);
  return satImageClampFocus({ zoom: satImageZoomFromSteps(steps), focus: state.focus }, geometry);
}

/**
 * The content point currently at `point`, in pixels from the centre of the
 * window. A window point maps to content as `focus + point / (content · zoom)`.
 */
export function satImageFocusAtPoint(
  state: SatImageZoomState,
  point: { x: number; y: number },
  geometry: SatImageZoomGeometry,
): { x: number; y: number } {
  const dims = dimensions(geometry);
  if (!dims) return { ...state.focus };
  return {
    x: state.focus.x + point.x / scaledAxis(dims.content.width, state.zoom),
    y: state.focus.y + point.y / scaledAxis(dims.content.height, state.zoom),
  };
}

/**
 * Zooms about a window point (cursor or pinch mid-point): the content under
 * that point stays under it across the zoom, as long as the clamp allows.
 */
export function satImageZoomAtPoint(
  state: SatImageZoomState,
  point: { x: number; y: number },
  direction: 1 | -1,
  geometry: SatImageZoomGeometry,
): SatImageZoomState {
  const dims = dimensions(geometry);
  const anchored = satImageFocusAtPoint(state, point, geometry);
  const steps = clamp(satImageZoomSteps(state.zoom) + direction, 0, MAX_ZOOM_STEPS);
  const zoom = satImageZoomFromSteps(steps);
  if (!dims) return { zoom, focus: anchored };
  return satImageClampFocus(
    {
      zoom,
      focus: {
        x: anchored.x - point.x / scaledAxis(dims.content.width, zoom),
        y: anchored.y - point.y / scaledAxis(dims.content.height, zoom),
      },
    },
    geometry,
  );
}

/** Drag-to-pan: the content follows the pointer, then the clamp stops it. */
export function satImagePanBy(
  state: SatImageZoomState,
  dx: number,
  dy: number,
  geometry: SatImageZoomGeometry,
): SatImageZoomState {
  const dims = dimensions(geometry);
  if (!dims) return satImageClampFocus(state, geometry);
  const offset = satImageOffsets(state, geometry);
  const scaledX = scaledAxis(dims.content.width, state.zoom);
  const scaledY = scaledAxis(dims.content.height, state.zoom);
  return satImageClampFocus(
    {
      zoom: state.zoom,
      focus: {
        x: 0.5 - (offset.x + dx) / scaledX,
        y: 0.5 - (offset.y + dy) / scaledY,
      },
    },
    geometry,
  );
}

/** Content offset in pixels: focus 0 shows the content's left/top edge. */
export function satImageOffsets(
  state: SatImageZoomState,
  geometry: SatImageZoomGeometry,
): { x: number; y: number } {
  const dims = dimensions(geometry);
  if (!dims) return { x: 0, y: 0 };
  const limitX = maxOffset(
    { content: dims.content.width, viewport: dims.viewport.width },
    state.zoom,
  );
  const limitY = maxOffset(
    { content: dims.content.height, viewport: dims.viewport.height },
    state.zoom,
  );
  return {
    x: clamp((0.5 - state.focus.x) * scaledAxis(dims.content.width, state.zoom), -limitX, limitX),
    y: clamp((0.5 - state.focus.y) * scaledAxis(dims.content.height, state.zoom), -limitY, limitY),
  };
}

/**
 * The CSS the renderer applies to the image element. At 100% this is the
 * identity, and callers are expected to skip the transform entirely — an
 * untouched figure must render exactly as it did before this feature existed.
 */
export function satImageTransform(
  state: SatImageZoomState,
  geometry: SatImageZoomGeometry,
): SatImageZoomTransform {
  const offsets = satImageOffsets(state, geometry);
  return { zoom: state.zoom, offsetX: round(offsets.x), offsetY: round(offsets.y) };
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Reads a renderer's transform back into content-relative state. */
export function satImageStateFromTransform(
  transform: SatImageZoomTransform,
  geometry: SatImageZoomGeometry,
): SatImageZoomState {
  const zoom = satImageSnapZoom(transform.zoom);
  const dims = dimensions(geometry);
  // An unmeasured window cannot place a focus, but it must never cost the
  // student their magnification: only the pan is unknowable, not the zoom.
  if (!dims) return { zoom, focus: { ...SAT_IMAGE_ZOOM_CENTER } };
  return satImageClampFocus(
    {
      zoom,
      focus: {
        x: 0.5 - transform.offsetX / scaledAxis(dims.content.width, zoom),
        y: 0.5 - transform.offsetY / scaledAxis(dims.content.height, zoom),
      },
    },
    geometry,
  );
}

/**
 * The gestures a renderer can report. Deliberately a tiny vocabulary: the frame
 * says *what the student did*, never what it should mean.
 *
 *   pan          — a drag, in pixels
 *   pan-end      — the drag finished; settle whatever it left behind
 *   zoom-at-point — double-click / double-tap at a point, one step in or out
 */
export type SatImageGestureEvent =
  | { kind: "pan"; dx: number; dy: number }
  | { kind: "pan-end" }
  | { kind: "zoom-at-point"; point: { x: number; y: number }; direction: 1 | -1 };

/**
 * A gesture on the frame, resolved into the next presentation transform.
 *
 * This is the seam's rule: the renderer owns the pointer mechanics (capture,
 * deltas, double-click) and translating an event into window-relative
 * coordinates, while this function owns what each gesture *means* — the steps,
 * the anchoring and the clamp. Neither side needs to know the other's concerns,
 * and the maths stays testable without a DOM.
 *
 * `pan-end` is the settle: a drag stops the moment focus says so, and release
 * returns the clamped view. The zoom maths already forbid losing the figure, so
 * today that is idempotent — it stays a gesture of its own so resistance can be
 * added later without touching the renderer or the reducer.
 */
export function satImageGestureTransform(input: {
  view: SatImageZoomTransform;
  geometry: SatImageZoomGeometry;
  intent: SatImageGestureEvent;
}): SatImageZoomTransform {
  const state = satImageStateFromTransform(input.view, input.geometry);
  const event: SatImageZoomEvent =
    input.intent.kind === "pan"
      ? { type: "PAN_BY", dx: input.intent.dx, dy: input.intent.dy }
      : input.intent.kind === "zoom-at-point"
        ? { type: "ZOOM_AT_POINT", point: input.intent.point, direction: input.intent.direction }
        : { type: "GEOMETRY_CHANGED" };
  return satImageTransform(satImageZoomReducer(state, event, input.geometry), input.geometry);
}

/**
 * Boring-by-design pure reducer: (state, event, geometry) → state'. Every case
 * re-clamps, so no sequence of events can leave the figure off-screen.
 */
export function satImageZoomReducer(
  state: SatImageZoomState,
  event: SatImageZoomEvent,
  geometry: SatImageZoomGeometry,
): SatImageZoomState {
  switch (event.type) {
    case "ZOOM_IN":
      return satImageZoomStep(state, 1, geometry);
    case "ZOOM_OUT":
      return satImageZoomStep(state, -1, geometry);
    case "RESET":
      return createSatImageZoomState();
    case "ZOOM_AT_POINT":
      return satImageZoomAtPoint(state, event.point, event.direction, geometry);
    case "PAN_BY":
      return satImagePanBy(state, event.dx, event.dy, geometry);
    case "GEOMETRY_CHANGED":
      return satImageClampFocus(
        { zoom: satImageSnapZoom(state.zoom), focus: state.focus },
        geometry,
      );
    default:
      return state;
  }
}
