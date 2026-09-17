import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SatTextAnchor } from '../../../domain/satResponses';
import { SatSelectionActionsPanel } from '../SatSelectionActionsPanel';
import { useSatAnnotationPlacement } from '../useSatAnnotationPlacement';

/**
 * The runtime half of annotation placement: the pure engine is tested on its
 * own, and this is what proves the WIRING — that a coarse pointer widens the
 * budget instead of dictating the presentation, that the surface waits for the
 * geometry to settle before it appears, that the dock follows the visible region
 * rather than the container, and that a surface the DOM cannot measure stays
 * reachable instead of vanishing.
 *
 * jsdom measures nothing (no layout, no Range rects), so every measurement the
 * runtime depends on is supplied explicitly. The stubs are the environment, not
 * the subject.
 */

const anchor: SatTextAnchor = { nodeId: 'stimulus:p1', startOffset: 2, endOffset: 6, exact: 'tree' };
const SURFACE = { width: 288, height: 108 };

const descriptors: Array<{ target: object; key: string; descriptor: PropertyDescriptor | undefined }> = [];

/** Replace a property, remembering how to put it back exactly as it was. */
function override(target: object, key: string, value: unknown): void {
  descriptors.push({ target, key, descriptor: Object.getOwnPropertyDescriptor(target, key) });
  Object.defineProperty(target, key, { configurable: true, writable: true, value });
}

/**
 * The passage the anchor resolves against, and the container the surface is
 * positioned in. They are siblings on purpose: React owns the container it
 * renders into, and clears it on mount — a passage inside it would be wiped
 * along with the anchor's ability to measure itself.
 */
function mountPassage(): HTMLElement {
  const passage = document.createElement('div');
  passage.innerHTML = '<div data-sat-annotation-region="stimulus"><div data-content-text-node="p1">A tree grows.</div></div>';
  document.body.appendChild(passage);
  const bounds = document.createElement('div');
  bounds.setAttribute('data-sat-annotation-bounds', 'true');
  document.body.appendChild(bounds);
  return bounds;
}

function anchorRect(top: number, bottom: number, left = 200, right = 600): DOMRect {
  return {
    x: left, y: top, top, bottom, left, right, width: right - left, height: bottom - top,
    toJSON: () => ({}),
  } as DOMRect;
}

/** Give the surface a measured size (jsdom reports none). */
function stubSurfaceSize(width = SURFACE.width, height = SURFACE.height): void {
  override(HTMLElement.prototype, 'offsetWidth', width);
  override(HTMLElement.prototype, 'offsetHeight', height);
}

/** Give the anchored span a measured box at the given band of the viewport. */
function stubAnchorBox(top: number, bottom: number): void {
  const rect = () => anchorRect(top, bottom);
  override(Range.prototype, 'getBoundingClientRect', rect);
  override(Range.prototype, 'getClientRects', () => [rect()] as unknown as DOMRectList);
}

/** The region the surface must stay inside. */
function stubVisualViewport(height: number, width = 800): void {
  override(window, 'visualViewport', {
    offsetTop: 0,
    offsetLeft: 0,
    width,
    height,
    addEventListener: () => {},
    removeEventListener: () => {},
  });
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  while (descriptors.length > 0) {
    const entry = descriptors.pop()!;
    if (entry.descriptor) Object.defineProperty(entry.target, entry.key, entry.descriptor);
    else delete (entry.target as Record<string, unknown>)[entry.key];
  }
  document.body.innerHTML = '';
});

beforeEach(() => {
  mountPassage();
});

/** The hook, with a container the runtime can actually measure. */
function Harness({ selection, touch }: { selection: SatTextAnchor | null; touch: boolean }) {
  const { placement, containerRef, measure } = useSatAnnotationPlacement(selection, { touch });
  return (
    <div data-testid="bounds" data-sat-annotation-bounds="true">
      <div
        ref={containerRef}
        data-testid="surface"
        data-mode={placement?.mode ?? 'none'}
        data-side={placement?.side ?? 'none'}
        data-top={placement?.top ?? -1}
        data-left={placement?.left ?? -1}
        data-width={placement?.width ?? -1}
      />
      <button type="button" data-testid="remeasure" onClick={measure}>
        remeasure
      </button>
    </div>
  );
}

function surface(): HTMLElement {
  return document.querySelector<HTMLElement>('[data-testid="surface"]')!;
}

function remeasure(): void {
  act(() => {
    document.querySelector<HTMLButtonElement>('[data-testid="remeasure"]')!.click();
  });
}

const settled = (mode: string) => waitFor(() => expect(surface().dataset['mode']).toBe(mode));

describe('useSatAnnotationPlacement', () => {
  it('waits for the selection to settle before it surfaces', () => {
    vi.useFakeTimers();
    stubSurfaceSize();
    stubAnchorBox(300, 320);
    stubVisualViewport(800);
    render(<Harness selection={anchor} touch={false} />);
    // Mounted, measured, and deliberately not shown yet: a selection that is
    // still moving does not get a toolbar under the student's finger.
    expect(surface().dataset['mode']).toBe('hidden');

    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(surface().dataset['mode']).toBe('floating');
  });

  it('floats in the lane the native menu leaves free, and docks when it leaves none', async () => {
    stubSurfaceSize();
    stubAnchorBox(200, 220);

    stubVisualViewport(400);
    const { unmount } = render(<Harness selection={anchor} touch />);
    // A short visible region with the menu above: the lane below is still ours
    // (168px against the 144 a comfortable toolbar needs), so a phone gets a
    // toolbar rather than a sheet.
    await settled('floating');
    expect(surface().dataset['side']).toBe('below');
    unmount();

    stubVisualViewport(800);
    render(<Harness selection={anchor} touch />);
    // More room, same lane: the dock was never a property of the device.
    await settled('floating');
    expect(surface().dataset['side']).toBe('below');
  });

  it('docks on touch when the menu has taken the lane with all the room', async () => {
    stubSurfaceSize();
    stubVisualViewport(400);
    // High in the visible region: iOS cannot fit its menu above and flips it
    // below — the lane we would have used — and above has nothing to offer, so
    // the sheet is the answer instead of a toolbar under the menu.
    stubAnchorBox(60, 80);
    render(<Harness selection={anchor} touch />);
    await settled('docked');
  });

  it('comes out of the dock for real room and re-decides for a new selection', async () => {
    stubSurfaceSize();
    stubVisualViewport(400);
    stubAnchorBox(60, 80);
    const { rerender } = render(<Harness selection={anchor} touch />);
    await settled('docked');

    // Room appears (the keyboard closed, the passage scrolled) and it is worth
    // the move: the sheet becomes a toolbar again rather than staying one for
    // the whole selection.
    stubVisualViewport(800);
    stubAnchorBox(300, 320);
    remeasure();
    await settled('floating');

    // A different selection is a new decision, and starts by waiting to settle.
    vi.useFakeTimers();
    rerender(<Harness selection={{ ...anchor, startOffset: 4, endOffset: 8, exact: 'ree' }} touch />);
    expect(surface().dataset['mode']).toBe('hidden');
  });

  it('keeps its side while that side still fits', async () => {
    stubSurfaceSize();
    stubVisualViewport(800);
    // No room above this selection, so the surface starts below it.
    stubAnchorBox(100, 120);
    const { rerender } = render(<Harness selection={anchor} touch={false} />);
    await settled('floating');
    expect(surface().dataset['side']).toBe('below');

    // The selection moves down the passage: above fits now, and a fresh decision
    // would move the surface up there. It stays put instead — the side is chosen
    // once and kept until it genuinely stops fitting.
    stubAnchorBox(300, 320);
    rerender(<Harness selection={anchor} touch={false} />);
    remeasure();
    expect(surface().dataset['side']).toBe('below');
  });

  it('follows the visible region, not the container, when it docks', async () => {
    stubSurfaceSize(320, 168);
    stubVisualViewport(400);
    // The shell freezes its own height while the software keyboard is open, so
    // the container stays tall while only 400px remain visible.
    vi.spyOn(
      document.querySelector<HTMLElement>('[data-sat-annotation-bounds="true"]')!,
      'getBoundingClientRect',
    ).mockReturnValue({ top: 0, left: 0, width: 800, height: 700 } as DOMRect);
    // A selection that covers half the visible region: no "nearby" to float in.
    stubAnchorBox(60, 260);
    render(<Harness selection={anchor} touch />);

    await settled('docked');
    const top = Number(surface().dataset['top']);
    // Pinned above the visible bottom edge (400 - 12), not the container's (700).
    expect(top + 168).toBeLessThanOrEqual(400 - 12);
    expect(top).toBeLessThan(400);
  });

  it('holds the surface hidden while the device is turning', async () => {
    vi.useFakeTimers();
    stubSurfaceSize();
    stubAnchorBox(300, 320);
    stubVisualViewport(800);
    render(<Harness selection={anchor} touch={false} />);
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(surface().dataset['mode']).toBe('floating');

    act(() => {
      window.dispatchEvent(new Event('orientationchange'));
    });
    expect(surface().dataset['mode']).toBe('hidden');

    // The resizes the browser reports mid-rotation are transitional, and the
    // wait is not releasable by them.
    act(() => {
      window.dispatchEvent(new Event('resize'));
      vi.advanceTimersByTime(40);
    });
    expect(surface().dataset['mode']).toBe('hidden');

    // Once the viewport has settled the surface comes back, placed from scratch.
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(surface().dataset['mode']).toBe('floating');
  });

  it('stays reachable when the DOM cannot measure the anchor at all', () => {
    stubSurfaceSize();
    // No Range measurement (the jsdom default): the runtime must guess a
    // reachable spot rather than hide the tools behind a broken measurement —
    // and there is no geometry to wait for, so it does not wait to settle.
    render(<Harness selection={anchor} touch={false} />);
    expect(surface().dataset['mode']).toBe('floating');
    expect(surface().dataset['left']).toBe('8');
  });
});

describe('SatSelectionActionsPanel', () => {
  const actions = { highlight: () => {}, underline: () => {}, addNote: () => {} };

  function renderPanel(touch: boolean) {
    return render(
      <SatSelectionActionsPanel
        anchor={anchor}
        currentColor="yellow"
        actions={actions}
        variant="floating"
        touch={touch}
        onClose={() => {}}
      />,
      { container: document.querySelector<HTMLElement>('[data-sat-annotation-bounds="true"]')! },
    );
  }

  it('honours a geometry-driven dock even though it was asked to float', async () => {
    stubSurfaceSize();
    stubVisualViewport(400);
    // High in the visible region: the native menu cannot fit above and flips
    // below, leaving us the lane with no room in it. The requested presentation
    // was `floating`; the space budget said otherwise.
    stubAnchorBox(60, 80);
    renderPanel(true);

    // The dock is what the student gets — with the selection quoted back, so the
    // sheet is visibly attached to that text, and without a caret, because a
    // sheet has no "that line" to point at.
    await waitFor(() => expect(document.querySelector('[data-sat-touch-dock="true"]')).not.toBeNull());
    expect(document.querySelector('[data-sat-selection-toolbar="true"]')).toBeNull();
    expect(document.querySelector('[data-sat-dock-quote="true"]')).not.toBeNull();
    expect(document.querySelector('[data-sat-annotation-caret]')).toBeNull();
  });

  it('points a touch surface at the lane the native menu leaves free', async () => {
    stubSurfaceSize();
    // Plenty of room on both sides, which is exactly the case the native menu
    // would occupy above: on glass the surface goes below it and says so with an
    // upward caret, so the tools are never painted over by the browser's menu.
    stubAnchorBox(300, 320);
    stubVisualViewport(800);
    renderPanel(true);

    await waitFor(() => expect(document.querySelector('[data-sat-annotation-caret]')).not.toBeNull());
    expect(document.querySelector('[data-sat-annotation-caret]')!.getAttribute('data-sat-annotation-caret')).toBe('up');
    expect(document.querySelector('[data-sat-selection-toolbar="true"]')).not.toBeNull();
  });

  it('gives a floating surface a caret pointing at the selection', async () => {
    stubSurfaceSize();
    stubAnchorBox(300, 320);
    stubVisualViewport(800);
    renderPanel(false);

    await waitFor(() => expect(document.querySelector('[data-sat-annotation-caret]')).not.toBeNull());
    const caret = document.querySelector('[data-sat-annotation-caret]')!;
    expect(document.querySelector('[data-sat-selection-toolbar="true"]')).not.toBeNull();
    // The surface sits above the selection, so the caret points down at it, and
    // it is positioned inside the layer that sits on the surface's border box.
    expect(caret.getAttribute('data-sat-annotation-caret')).toBe('down');
    expect(caret.closest('.sat-annotation-caret-layer')).not.toBeNull();
    expect(document.querySelector('[data-sat-dock-quote="true"]')).toBeNull();
  });

  it('claims no interaction hooks while it is waiting to settle', () => {
    vi.useFakeTimers();
    stubSurfaceSize();
    stubAnchorBox(300, 320);
    stubVisualViewport(800);
    renderPanel(false);

    // Present in the DOM, invisible to the student: the shortcut that focuses
    // "the first toolbar control" must not find one nobody can see.
    const toolbar = document.querySelector('[role="toolbar"]')!;
    expect(toolbar).not.toBeNull();
    expect(toolbar.getAttribute('data-sat-selection-toolbar')).toBeNull();
    expect(toolbar.getAttribute('data-sat-touch-dock')).toBeNull();
  });
});
