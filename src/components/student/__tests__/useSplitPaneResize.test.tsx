import React from 'react';
import { act, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useSplitPaneResize } from '../useSplitPaneResize';

/**
 * P2.4 seam semantics: continuous drag, magnetic settle on release, pixel
 * arrow nudges, and a short animated reset back to the recommended split.
 *
 * P2.4b tablet semantics: the recommended split is a function of the live
 * workspace width (cramped touch tablets lean question-first), and container
 * geometry changes clamp the rendered split without destroying the student's
 * chosen ratio.
 */

const WORKSPACE_LEFT = 100;
const WORKSPACE_WIDTH = 1200;
const RAIL_WIDTH = 10;

interface HarnessOptions {
  isTabletMode?: boolean;
  crampedDefaultLeftWidth?: number;
  workspaceWidth?: number;
}

/**
 * Frame-capture helper (project convention in the SAT tool tests): the reset
 * animation is driven manually so its easing is deterministic rather than
 * dependent on real frame timing.
 */
function captureAnimationFrames() {
  const frames: FrameRequestCallback[] = [];
  const spy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    frames.push(callback);
    return frames.length;
  });
  return {
    run(timestamp: number) {
      const frame = frames.shift();
      expect(frame).toBeDefined();
      act(() => {
        frame?.(timestamp);
      });
    },
    pending: () => frames.length,
    restore: () => spy.mockRestore(),
  };
}

function renderHarness(options: HarnessOptions = {}) {
  const {
    workspaceWidth = WORKSPACE_WIDTH,
    isTabletMode = false,
    crampedDefaultLeftWidth,
  } = options;
  const api: { current: ReturnType<typeof useSplitPaneResize> | null } = { current: null };

  function Harness() {
    const resize = useSplitPaneResize({
      isTabletMode,
      materialPaneWidthProperty: '--reading-pane-width',
      dividerMode: isTabletMode ? 'overlay' : 'consumes-space',
      ...(crampedDefaultLeftWidth === undefined ? {} : { crampedDefaultLeftWidth }),
    });
    api.current = resize;
    return <div ref={resize.workspaceRef} data-testid="harness-workspace" style={resize.splitPaneStyle} />;
  }

  const utils = render(<Harness />);
  const workspace = utils.getByTestId('harness-workspace');
  const rect = (width: number) => ({
    bottom: 700,
    height: 700,
    left: WORKSPACE_LEFT,
    right: WORKSPACE_LEFT + width,
    top: 0,
    width,
    x: WORKSPACE_LEFT,
    y: 0,
    toJSON: () => ({}),
  });

  const rectSpy = vi.spyOn(workspace, 'getBoundingClientRect').mockReturnValue(rect(workspaceWidth));

  const pointer = (clientX: number) =>
    ({
      pointerId: 1,
      clientX,
      currentTarget: { setPointerCapture: () => undefined },
      preventDefault: () => undefined,
    }) as unknown as React.PointerEvent<HTMLDivElement>;

  return {
    ...utils,
    workspace,
    api,
    dragStart: (clientX: number) => act(() => api.current!.handleDrag(pointer(clientX))),
    dragMove: (clientX: number) => act(() => api.current!.handlePointerMove(pointer(clientX))),
    dragEnd: () => act(() => api.current!.handlePointerEnd(pointer(0))),
    press: (key: string, shiftKey = false) =>
      act(() =>
        api.current!.handleKeyboardResize({
          key,
          shiftKey,
          preventDefault: () => undefined,
        } as unknown as React.KeyboardEvent<HTMLDivElement>),
      ),
    /** Rotate / resize the workspace (Stage Manager, split view, window drag). */
    setWorkspaceWidth: (width: number) => {
      rectSpy.mockReturnValue(rect(width));
      act(() => {
        window.dispatchEvent(new Event('resize'));
      });
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useSplitPaneResize direct manipulation', () => {
  it('follows the pointer continuously and quantizes the rendered percentage', () => {
    const harness = renderHarness();
    expect(harness.api.current?.leftWidth).toBe(50);

    // +119px of the 1190px usable width is +10%.
    harness.dragStart(WORKSPACE_LEFT + 600);
    harness.dragMove(WORKSPACE_LEFT + 719);
    expect(harness.api.current?.splitPaneStyle).toMatchObject({
      '--reading-pane-width': '60%',
    });

    harness.dragEnd();
    expect(harness.api.current?.leftWidth).toBe(60);
  });

  it('does not pull the divider into the recommended split while the pointer is down', () => {
    const harness = renderHarness();

    // +6px lands inside the magnetic zone but must track the pointer exactly.
    harness.dragStart(WORKSPACE_LEFT + 600);
    harness.dragMove(WORKSPACE_LEFT + 606);
    expect(harness.api.current?.leftWidth).toBe(50.5);

    // The settle happens on release only.
    harness.dragEnd();
    expect(harness.api.current?.leftWidth).toBe(50);
  });

  it('keeps a deliberate wide split instead of snapping it back', () => {
    const harness = renderHarness();

    harness.dragStart(WORKSPACE_LEFT + 600);
    harness.dragMove(WORKSPACE_LEFT + 700);
    harness.dragEnd();

    expect(harness.api.current?.leftWidth).toBe(58.5);
  });

  it('nudges by pixels with the arrow keys and jumps to the bounds with Home/End', () => {
    const harness = renderHarness();

    // 12px of 1190px ≈ 1% → quantized to 51%.
    harness.press('ArrowRight');
    expect(harness.api.current?.leftWidth).toBe(51);

    harness.press('ArrowLeft');
    expect(harness.api.current?.leftWidth).toBe(50);

    // Shift uses the larger step (32px ≈ 2.7%).
    harness.press('ArrowRight', true);
    expect(harness.api.current?.leftWidth).toBe(53);

    harness.press('Home');
    expect(harness.api.current?.leftWidth).toBe(32);

    // End reaches the exact pixel bound (1 - 430px of 1190px usable).
    harness.press('End');
    expect(harness.api.current?.leftWidth).toBeCloseTo(63.87, 1);
  });

  it('eases back to the recommended split on Enter instead of jumping', () => {
    const frames = captureAnimationFrames();
    try {
      const harness = renderHarness();

      harness.dragStart(WORKSPACE_LEFT + 600);
      harness.dragMove(WORKSPACE_LEFT + 700);
      harness.dragEnd();
      expect(harness.api.current?.leftWidth).toBe(58.5);

      harness.press('Enter');
      // Nothing moves until the first frame anchors the animation.
      expect(harness.api.current?.leftWidth).toBe(58.5);
      frames.run(0);
      expect(harness.api.current?.leftWidth).toBe(58.5);

      // Part-way through the ~200ms settle the split is still in flight…
      frames.run(80);
      const midFlight = harness.api.current?.leftWidth ?? 0;
      expect(midFlight).toBeGreaterThan(50);
      expect(midFlight).toBeLessThan(58.5);

      // …and past the budget it lands exactly on the recommended split.
      frames.run(240);
      expect(harness.api.current?.leftWidth).toBe(50);
      expect(frames.pending()).toBe(0);
    } finally {
      frames.restore();
    }
  });
});

describe('useSplitPaneResize tablet canonical layout', () => {
  it('opens question-first on a cramped touch tablet and resets back to it', () => {
    const frames = captureAnimationFrames();
    try {
      // 1024px workspace: below the wide breakpoint, so the module's cramped
      // default (Reading: 45/55) is the canonical layout.
      const harness = renderHarness({
        isTabletMode: true,
        crampedDefaultLeftWidth: 45,
        workspaceWidth: 1024,
      });

      expect(harness.api.current?.leftWidth).toBe(45);

      // Dragging away and resetting returns to 45, not to an even split.
      harness.dragStart(WORKSPACE_LEFT + 512);
      harness.dragMove(WORKSPACE_LEFT + 612);
      harness.dragEnd();
      expect(harness.api.current?.leftWidth).toBe(55);

      harness.press('Enter');
      frames.run(0);
      frames.run(240);
      expect(harness.api.current?.leftWidth).toBe(45);
    } finally {
      frames.restore();
    }
  });

  it('keeps the even split once the workspace is wide', () => {
    const frames = captureAnimationFrames();
    try {
      const harness = renderHarness({
        isTabletMode: true,
        crampedDefaultLeftWidth: 45,
        workspaceWidth: 1280,
      });

      harness.dragStart(WORKSPACE_LEFT + 640);
      harness.dragMove(WORKSPACE_LEFT + 740);
      harness.dragEnd();
      expect(harness.api.current?.leftWidth).toBe(53);

      // 1280px is a wide workspace: the recommended split is 50/50, so the
      // cramped default must not leak into wide layouts.
      harness.press('Enter');
      frames.run(0);
      frames.run(240);
      expect(harness.api.current?.leftWidth).toBe(50);
    } finally {
      frames.restore();
    }
  });

  it('clamps to safe geometry on rotation and restores the intent when it returns', () => {
    const harness = renderHarness({
      isTabletMode: true,
      crampedDefaultLeftWidth: 45,
      workspaceWidth: 1200,
    });

    harness.dragStart(WORKSPACE_LEFT + 600);
    harness.dragMove(WORKSPACE_LEFT + 720);
    harness.dragEnd();
    expect(harness.api.current?.leftWidth).toBe(55);

    // Narrower geometry: 900px cannot honour 55/45, so the RENDERED split
    // clamps to the readable bound (52% is the widest the material may be)...
    harness.setWorkspaceWidth(900);
    expect(harness.api.current?.leftWidth).toBe(52);
    expect(harness.api.current?.splittable).toBe(true);

    // ...and the student's chosen 55/45 comes back with the space.
    harness.setWorkspaceWidth(1200);
    expect(harness.api.current?.leftWidth).toBe(55);
  });
});

describe('useSplitPaneResize minimums', () => {
  it('stops splitting instead of inverting the bounds when panes cannot fit', () => {
    const harness = renderHarness();
    expect(harness.api.current?.splittable).toBe(true);

    // 700px cannot fit 380 + 10 + 430 whatever the preference is: the seam
    // reports itself unusable (the module then hides the separator and the
    // layout policy drops to a single surface).
    harness.setWorkspaceWidth(700);

    expect(harness.api.current?.splittable).toBe(false);
    expect(harness.api.current?.splitBounds).toMatchObject({ unsplittable: true });
  });
});
