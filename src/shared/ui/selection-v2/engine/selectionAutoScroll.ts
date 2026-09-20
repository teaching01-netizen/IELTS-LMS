/**
 * Scrolling the page because the finger is asking for it, without stealing the
 * gesture from the student.
 *
 * A selection handle dragged to the edge of a scrolling passage has to keep
 * extending — that is the whole reason a student drags it there — and on a
 * surface whose platform selection is suppressed there is no native
 * auto-scroll to lean on. `scrollIntoView()` on every move is not an answer: it
 * takes the scroll position away from the finger, jitters on every event, and
 * cannot be tuned to "faster the further past the edge you go".
 *
 * So the rule is a velocity, not a jump, and it is a pure function of the
 * finger's position inside the visible band. The runner below turns that
 * velocity into frames, and reports each one so the engine can re-resolve the
 * caret against the layout the scroll just produced.
 */

export interface AutoScrollBand {
  /** Top of the region the finger can see — a scrolling pane, or the viewport. */
  top: number;
  bottom: number;
}

export interface AutoScrollOptions {
  /** How close to an edge the finger must be before anything moves. */
  edgeBandPx?: number;
  /** Speed at the very edge, in CSS pixels per second. */
  maxSpeedPxPerSecond?: number;
}

/** How close to an edge a finger starts scrolling, in CSS pixels. */
export const AUTO_SCROLL_EDGE_PX = 72;

/** The fastest auto-scroll gets, in CSS pixels per second. */
export const AUTO_SCROLL_MAX_SPEED = 1400;

/**
 * Pixels per second for a finger at `y`, negative when scrolling up.
 *
 * Zero outside the edge bands, so a gesture in the middle of a passage never
 * scrolls it by accident, and a full-speed band that saturates at the edge and
 * beyond rather than growing without bound — a finger held past the top of a
 * passage should scroll at a speed the student can still aim with.
 */
export function autoScrollVelocity(y: number, band: AutoScrollBand, options: AutoScrollOptions = {}): number {
  const height = Math.max(0, band.bottom - band.top);
  const maxSpeed = options.maxSpeedPxPerSecond ?? AUTO_SCROLL_MAX_SPEED;
  // A band thinner than two edge zones would make the bands overlap and scroll
  // in both directions at once; half the band each keeps the middle honest.
  const edge = Math.max(1, Math.min(options.edgeBandPx ?? AUTO_SCROLL_EDGE_PX, height / 2));
  if (height <= 0) return 0;

  const fromTop = y - band.top;
  const fromBottom = band.bottom - y;
  if (fromTop < edge) {
    const penetration = Math.min(1, Math.max(0, (edge - fromTop) / edge));
    return -maxSpeed * penetration;
  }
  if (fromBottom < edge) {
    const penetration = Math.min(1, Math.max(0, (edge - fromBottom) / edge));
    return maxSpeed * penetration;
  }
  return 0;
}

/**
 * The element that actually scrolls the prose a surface rendered — or null.
 *
 * A passage lives inside a pane, and which pane scrolls is a fact about the
 * layout at the moment of the drag, not about the component tree: the same
 * passage is the page in one product and a fixed-height pane in another, and a
 * split pane resizes under it while the student reads. So it is measured rather
 * than configured, at the moment a handle is grabbed.
 *
 * A chain of ancestors that cannot scroll is not a failure: a surface with
 * nothing to scroll simply has no auto-scroll, which is the honest answer.
 * Returning the document's scrolling element as a last resort is what makes a
 * full-page passage work, where the prose is not inside any scrolling ancestor
 * at all.
 */
export function nearestScrollableAncestor(root: Element | null): HTMLElement | null {
  if (!root) return null;
  const view = root.ownerDocument?.defaultView ?? null;
  let element = root.parentElement;
  while (element) {
    const style = view && typeof view.getComputedStyle === 'function' ? view.getComputedStyle(element) : null;
    const overflow = style ? `${style.overflowY}${style.overflow}` : '';
    if (/auto|scroll|overlay/.test(overflow) && element.scrollHeight > element.clientHeight) return element;
    element = element.parentElement;
  }
  const scrolling = root.ownerDocument?.scrollingElement;
  if (!scrolling) return null;
  return scrolling.scrollHeight > scrolling.clientHeight ? (scrolling as HTMLElement) : null;
}

export interface AutoScrollRunner {
  /** Where the finger is now, and the band it is moving inside. */
  update: (y: number, band: AutoScrollBand) => void;
  /** Stop scrolling: the handle was released, or the gesture ended. */
  stop: () => void;
  /** True while a scroll loop is running. */
  active: () => boolean;
}

export interface AutoScrollRunnerOptions extends AutoScrollOptions {
  /** Monotonic clock, in milliseconds. Injected so tests can drive frames. */
  now?: (() => number) | undefined;
  requestFrame?: ((callback: () => void) => number) | undefined;
  cancelFrame?: ((handle: number) => void) | undefined;
  /** Called after each scroll step, so the caller can re-measure and repaint. */
  onStep?: ((scrolledBy: number) => void) | undefined;
}

/**
 * A frame loop that scrolls while the finger is in an edge band.
 *
 * The loop is driven by measured elapsed time rather than a fixed step, because
 * the speed of a frame is not a constant on a device that is also rendering a
 * magnifier — and it stops the instant the velocity is zero, so an ordinary drag
 * in the middle of a passage never starts one.
 */
export function createAutoScrollRunner(
  scrollBy: (dx: number, dy: number) => void,
  options: AutoScrollRunnerOptions = {},
): AutoScrollRunner {
  const now = options.now ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
  const requestFrame = options.requestFrame ?? ((callback: () => void) => (
    typeof requestAnimationFrame === 'function' ? requestAnimationFrame(callback) : (setTimeout(callback, 16) as unknown as number)
  ));
  const cancelFrame = options.cancelFrame ?? ((handle: number) => {
    if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(handle);
    else clearTimeout(handle);
  });

  let handle: number | null = null;
  let band: AutoScrollBand | null = null;
  let pointerY = 0;
  let lastFrameAt = 0;

  const step = () => {
    handle = null;
    if (!band) return;
    const at = now();
    const elapsedMs = Math.max(0, Math.min(64, at - lastFrameAt));
    lastFrameAt = at;
    const velocity = autoScrollVelocity(pointerY, band, options);
    if (velocity === 0) return;
    const distance = (velocity * elapsedMs) / 1000;
    if (distance !== 0) {
      scrollBy(0, distance);
      options.onStep?.(distance);
    }
    handle = requestFrame(step);
  };

  return {
    update(y, nextBand) {
      pointerY = y;
      band = nextBand;
      if (autoScrollVelocity(y, nextBand, options) === 0) {
        this.stop();
        return;
      }
      if (handle !== null) return;
      lastFrameAt = now();
      handle = requestFrame(step);
    },
    stop() {
      if (handle !== null) cancelFrame(handle);
      handle = null;
      band = null;
    },
    active() {
      return handle !== null;
    },
  };
}
