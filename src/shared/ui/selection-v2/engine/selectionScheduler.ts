/**
 * One read, one compute, one write — per animation frame, never per event.
 *
 * A propagating touch gesture raises `pointermove` far faster than the screen
 * refreshes, and the geometry pass behind it is the expensive kind: resolve a
 * caret (`caretPositionFromPoint`, a layout query), build a `Range`, call
 * `getClientRects()` on it, then measure handles. Doing that in the event
 * handler produces exactly the interleaving this module exists to prevent —
 * read, write, read, write — where each forced style recalculation invalidates
 * the last, the compositor never gets a frame to itself, and the selection
 * visibly lags the finger on the device that needs it most.
 *
 * So every input coalesces into one pending frame: the handler stores the latest
 * pointer and returns, and the frame task does all of the measuring and writing
 * in a single pass. The frame is cancellable, and `flush()` exists for the one
 * moment where waiting a frame is wrong — the finger going up, where the range
 * that is committed has to be the range the student was looking at.
 */

export interface FrameScheduler {
  /** Ask for one frame's work. Many calls in a frame produce one run. */
  schedule: () => void;
  /** Run the pending work now, if any, instead of waiting for the frame. */
  flush: () => void;
  /** Drop pending work: the gesture ended, or the surface went away. */
  cancel: () => void;
  /** True when a run is queued and has not happened yet. */
  pending: () => boolean;
}

export interface FrameSchedulerOptions {
  requestFrame?: ((callback: () => void) => number) | undefined;
  cancelFrame?: ((handle: number) => void) | undefined;
}

function defaultRequestFrame(callback: () => void): number {
  if (typeof requestAnimationFrame === 'function') return requestAnimationFrame(callback);
  return setTimeout(callback, 16) as unknown as number;
}

function defaultCancelFrame(handle: number): void {
  if (typeof cancelAnimationFrame === 'function') {
    cancelAnimationFrame(handle);
    return;
  }
  clearTimeout(handle);
}

export function createFrameScheduler(
  run: () => void,
  options: FrameSchedulerOptions = {},
): FrameScheduler {
  const requestFrame = options.requestFrame ?? defaultRequestFrame;
  const cancelFrame = options.cancelFrame ?? defaultCancelFrame;
  let handle: number | null = null;

  const invoke = () => {
    // Cleared BEFORE the work runs, so work that schedules again (a handle drag
    // that re-measures after moving, an auto-scroll frame) queues the NEXT
    // frame instead of recursing into this one.
    handle = null;
    run();
  };

  return {
    schedule() {
      if (handle !== null) return;
      handle = requestFrame(invoke);
    },
    flush() {
      if (handle === null) return;
      const pending = handle;
      handle = null;
      cancelFrame(pending);
      run();
    },
    cancel() {
      if (handle === null) return;
      cancelFrame(handle);
      handle = null;
    },
    pending() {
      return handle !== null;
    },
  };
}
