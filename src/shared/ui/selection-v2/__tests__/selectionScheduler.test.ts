import { describe, expect, it, vi } from 'vitest';
import { createFrameScheduler } from '../engine/selectionScheduler';

/** A frame the test drives by hand, so "per animation frame" is exact. */
function manualFrames() {
  const queue = new Map<number, () => void>();
  let nextHandle = 1;
  return {
    requestFrame: (callback: () => void) => {
      const handle = nextHandle++;
      queue.set(handle, callback);
      return handle;
    },
    cancelFrame: (handle: number) => {
      queue.delete(handle);
    },
    runFrame: () => {
      const pending = [...queue.entries()];
      queue.clear();
      for (const [, callback] of pending) callback();
    },
    queued: () => queue.size,
  };
}

describe('createFrameScheduler', () => {
  it('coalesces any number of requests in one frame into a single run', () => {
    const frames = manualFrames();
    const run = vi.fn();
    const scheduler = createFrameScheduler(run, frames);

    for (let index = 0; index < 500; index += 1) scheduler.schedule();
    expect(run).not.toHaveBeenCalled();
    expect(frames.queued()).toBe(1);

    frames.runFrame();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('runs once per frame while events keep arriving', () => {
    const frames = manualFrames();
    const run = vi.fn();
    const scheduler = createFrameScheduler(run, frames);

    for (let frame = 0; frame < 3; frame += 1) {
      for (let move = 0; move < 20; move += 1) scheduler.schedule();
      frames.runFrame();
    }

    expect(run).toHaveBeenCalledTimes(3);
  });

  it('queues the NEXT frame when work reschedules itself, instead of recursing', () => {
    const frames = manualFrames();
    let depth = 0;
    let maxDepth = 0;
    const scheduler = createFrameScheduler(() => {
      depth += 1;
      maxDepth = Math.max(maxDepth, depth);
      scheduler.schedule();
      depth -= 1;
    }, frames);

    scheduler.schedule();
    frames.runFrame();
    frames.runFrame();

    expect(maxDepth).toBe(1);
    expect(frames.queued()).toBe(1);
  });

  it('flushes the pending work immediately, for the moment a gesture commits', () => {
    const frames = manualFrames();
    const run = vi.fn();
    const scheduler = createFrameScheduler(run, frames);

    scheduler.schedule();
    scheduler.schedule();
    scheduler.flush();

    expect(run).toHaveBeenCalledTimes(1);
    expect(frames.queued()).toBe(0);
    expect(scheduler.pending()).toBe(false);
  });

  it('does not run the queued frame a second time after a flush', () => {
    const frames = manualFrames();
    const run = vi.fn();
    const scheduler = createFrameScheduler(run, frames);

    scheduler.schedule();
    scheduler.flush();
    frames.runFrame();

    expect(run).toHaveBeenCalledTimes(1);
  });

  it('drops pending work when the gesture goes away', () => {
    const frames = manualFrames();
    const run = vi.fn();
    const scheduler = createFrameScheduler(run, frames);

    scheduler.schedule();
    scheduler.cancel();
    frames.runFrame();

    expect(run).not.toHaveBeenCalled();
    expect(frames.queued()).toBe(0);
  });

  it('does nothing when flushed with no work pending', () => {
    const frames = manualFrames();
    const run = vi.fn();
    const scheduler = createFrameScheduler(run, frames);

    scheduler.flush();

    expect(run).not.toHaveBeenCalled();
  });
});
