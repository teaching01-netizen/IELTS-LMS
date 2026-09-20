import { describe, expect, it, vi } from 'vitest';
import {
  AUTO_SCROLL_EDGE_PX,
  AUTO_SCROLL_MAX_SPEED,
  autoScrollVelocity,
  createAutoScrollRunner,
  nearestScrollableAncestor,
} from '../engine/selectionAutoScroll';

const band = { top: 100, bottom: 700 };

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
      const pending = [...queue.values()];
      queue.clear();
      for (const callback of pending) callback();
    },
    queued: () => queue.size,
  };
}

describe('autoScrollVelocity', () => {
  it('stays still in the middle of the band, so reading never scrolls by accident', () => {
    expect(autoScrollVelocity(400, band)).toBe(0);
    expect(autoScrollVelocity(band.top + AUTO_SCROLL_EDGE_PX, band)).toBe(0);
    expect(autoScrollVelocity(band.bottom - AUTO_SCROLL_EDGE_PX, band)).toBe(0);
  });

  it('scrolls up near the top edge and down near the bottom one', () => {
    expect(autoScrollVelocity(band.top + 10, band)).toBeLessThan(0);
    expect(autoScrollVelocity(band.bottom - 10, band)).toBeGreaterThan(0);
  });

  it('speeds up as the finger approaches the edge', () => {
    const near = Math.abs(autoScrollVelocity(band.top + 60, band));
    const closer = Math.abs(autoScrollVelocity(band.top + 20, band));

    expect(closer).toBeGreaterThan(near);
  });

  it('saturates at the edge instead of running away past it', () => {
    expect(autoScrollVelocity(band.top - 500, band)).toBe(-AUTO_SCROLL_MAX_SPEED);
    expect(autoScrollVelocity(band.bottom + 500, band)).toBe(AUTO_SCROLL_MAX_SPEED);
  });

  it('keeps a band thinner than two edge zones scrolling in one direction only', () => {
    const thin = { top: 0, bottom: 60 };

    expect(autoScrollVelocity(30, thin)).toBe(0);
    expect(autoScrollVelocity(0, thin)).toBe(-AUTO_SCROLL_MAX_SPEED);
    expect(autoScrollVelocity(60, thin)).toBe(AUTO_SCROLL_MAX_SPEED);
  });

  it('does nothing for a band with no height', () => {
    expect(autoScrollVelocity(10, { top: 50, bottom: 50 })).toBe(0);
  });
});

describe('nearestScrollableAncestor', () => {
  function scroller(overflowY: string, scrollHeight = 1000, clientHeight = 400) {
    const element = document.createElement('div');
    Object.defineProperty(element, 'scrollHeight', { configurable: true, value: scrollHeight });
    Object.defineProperty(element, 'clientHeight', { configurable: true, value: clientHeight });
    element.style.overflowY = overflowY;
    return element;
  }

  it('finds the pane that actually scrolls the prose', () => {
    const pane = scroller('auto');
    const prose = document.createElement('p');
    pane.append(prose);
    document.body.append(pane);

    expect(nearestScrollableAncestor(prose)).toBe(pane);
  });

  it('skips an ancestor that cannot scroll its content', () => {
    const overflowing = scroller('auto', 400, 400);
    const prose = document.createElement('p');
    overflowing.append(prose);
    document.body.append(overflowing);

    // Nothing in the chain scrolls, and the document does not either in jsdom,
    // so the honest answer is "there is no auto-scroll here".
    expect(nearestScrollableAncestor(prose)).toBeNull();
  });

  it('reports nothing for a detached surface', () => {
    expect(nearestScrollableAncestor(null)).toBeNull();
  });
});

describe('createAutoScrollRunner', () => {
  it('scrolls in proportion to elapsed time while the finger stays in a band', () => {
    const frames = manualFrames();
    let now = 0;
    const scrollBy = vi.fn();
    const runner = createAutoScrollRunner(scrollBy, { ...frames, now: () => now });

    runner.update(band.bottom, band);
    // One 16ms frame at the maximum speed moves speed × 0.016 px.
    now = 16;
    frames.runFrame();

    expect(scrollBy).toHaveBeenCalledTimes(1);
    const [, dy] = scrollBy.mock.calls[0]!;
    expect(dy).toBeCloseTo(AUTO_SCROLL_MAX_SPEED * 0.016, 5);
    runner.stop();
  });

  it('reports every step so the selection can be re-measured against the new layout', () => {
    const frames = manualFrames();
    let now = 0;
    const onStep = vi.fn();
    const runner = createAutoScrollRunner(vi.fn(), { ...frames, now: () => now, onStep });

    runner.update(band.bottom, band);
    now = 50;
    frames.runFrame();
    now = 100;
    frames.runFrame();

    expect(onStep).toHaveBeenCalledTimes(2);
    runner.stop();
  });

  it('does not start a loop for a finger in the middle of the band', () => {
    const frames = manualFrames();
    const scrollBy = vi.fn();
    const runner = createAutoScrollRunner(scrollBy, { ...frames, now: () => 0 });

    runner.update(400, band);
    frames.runFrame();

    expect(runner.active()).toBe(false);
    expect(scrollBy).not.toHaveBeenCalled();
  });

  it('stops the loop the moment the finger comes back inside', () => {
    const frames = manualFrames();
    const runner = createAutoScrollRunner(vi.fn(), { ...frames, now: () => 0 });

    runner.update(band.bottom, band);
    expect(runner.active()).toBe(true);

    runner.update(400, band);
    expect(runner.active()).toBe(false);
    expect(frames.queued()).toBe(0);
  });

  it('scrolling stops when the handle is released', () => {
    const frames = manualFrames();
    const scrollBy = vi.fn();
    const runner = createAutoScrollRunner(scrollBy, { ...frames, now: () => 0 });

    runner.update(band.top, band);
    runner.stop();
    frames.runFrame();

    expect(runner.active()).toBe(false);
    expect(scrollBy).not.toHaveBeenCalled();
  });
});
