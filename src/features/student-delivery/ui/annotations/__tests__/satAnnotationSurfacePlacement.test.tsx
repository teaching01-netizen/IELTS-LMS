import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SatTextAnchor } from '../../../domain/satResponses';
import { SatSelectionActionsPanel } from '../SatSelectionActionsPanel';
import { useSatAnnotationPlacement } from '../useSatAnnotationPlacement';

/**
 * The runtime half of annotation placement: the pure engine is tested on its
 * own, and this is what proves the WIRING — that a coarse pointer widens the
 * budget instead of dictating the presentation, that the dock is sticky for one
 * selection, that a new selection decides again, and that a surface the DOM
 * cannot measure stays reachable instead of vanishing.
 *
 * jsdom measures nothing (no layout, no Range rects), so every measurement the
 * runtime depends on is supplied explicitly. The stubs are the environment, not
 * the subject.
 */

const anchor: SatTextAnchor = { nodeId: 'stimulus:p1', startOffset: 2, endOffset: 6, exact: 'tree' };

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
function stubSurfaceSize(width = 288, height = 108): void {
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

describe('useSatAnnotationPlacement', () => {
  it('floats where there is room and docks where a coarse pointer cannot have it', () => {
    stubSurfaceSize();
    stubAnchorBox(200, 220);

    stubVisualViewport(400);
    const { unmount } = render(<Harness selection={anchor} touch />);
    // A short viewport: 188px above the selection, 168px below. Touch needs 224
    // (surface + gap + the menu's zone + comfort) on one side, and has neither.
    expect(surface().dataset['mode']).toBe('docked');
    unmount();

    stubVisualViewport(800);
    render(<Harness selection={anchor} touch />);
    // The same selection in a viewport with room: the surface floats, and the
    // dock was never a property of the device.
    expect(surface().dataset['mode']).toBe('floating');
    expect(surface().dataset['side']).toBe('below');
  });

  it('holds the dock for one selection and re-decides for the next', () => {
    stubSurfaceSize();
    stubAnchorBox(200, 220);
    stubVisualViewport(400);
    const { rerender } = render(<Harness selection={anchor} touch />);
    expect(surface().dataset['mode']).toBe('docked');

    // Room appears (the keyboard closed) but the selection is unchanged: the
    // surface stays where the student found it rather than jumping mid-action.
    stubVisualViewport(800);
    remeasure();
    expect(surface().dataset['mode']).toBe('docked');

    // A different selection is a new decision.
    rerender(<Harness selection={{ ...anchor, startOffset: 4, endOffset: 8, exact: 'ree' }} touch />);
    expect(surface().dataset['mode']).toBe('floating');
  });

  it('keeps its side while that side still fits', () => {
    stubSurfaceSize();
    stubVisualViewport(800);
    // No room above this selection, so the surface starts below it.
    stubAnchorBox(100, 120);
    const { rerender } = render(<Harness selection={anchor} touch={false} />);
    expect(surface().dataset['side']).toBe('below');

    // The selection moves down the passage: above fits now, and a fresh
    // decision would move the surface up there. It stays put instead — the side
    // is chosen once and kept until it genuinely stops fitting.
    stubAnchorBox(300, 320);
    rerender(<Harness selection={anchor} touch={false} />);
    remeasure();
    expect(surface().dataset['side']).toBe('below');
  });

  it('holds the surface hidden while the device is turning', async () => {
    stubSurfaceSize();
    stubAnchorBox(300, 320);
    stubVisualViewport(800);
    render(<Harness selection={anchor} touch={false} />);
    expect(surface().dataset['mode']).toBe('floating');

    act(() => {
      window.dispatchEvent(new Event('orientationchange'));
    });
    expect(surface().dataset['mode']).toBe('hidden');

    // The resizes the browser reports mid-rotation are transitional. Placing from
    // them would park the surface where the viewport is about to stop being — and
    // the student would watch it flick from side to side while the device turns.
    act(() => {
      window.dispatchEvent(new Event('resize'));
    });
    expect(surface().dataset['mode']).toBe('hidden');

    // Once the viewport has settled the surface comes back, placed from scratch.
    await waitFor(() => expect(surface().dataset['mode']).toBe('floating'));
  });

  it('stays reachable when the DOM cannot measure the anchor at all', () => {
    stubSurfaceSize();
    // No Range measurement (the jsdom default): the runtime must guess a
    // reachable spot rather than hide the tools behind a broken measurement.
    render(<Harness selection={anchor} touch={false} />);
    expect(surface().dataset['mode']).toBe('floating');
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

  it('honours a geometry-driven dock even though it was asked to float', () => {
    stubSurfaceSize();
    stubAnchorBox(200, 220);
    stubVisualViewport(400);
    renderPanel(true);

    // The requested presentation was `floating`; the space budget said otherwise,
    // and the dock is what the student gets — with the selection quoted back, so
    // the sheet is visibly attached to that text, and without a caret, because a
    // sheet has no "that line" to point at.
    expect(document.querySelector('[data-sat-touch-dock="true"]')).not.toBeNull();
    expect(document.querySelector('[data-sat-selection-toolbar="true"]')).toBeNull();
    expect(document.querySelector('[data-sat-dock-quote="true"]')).not.toBeNull();
    expect(document.querySelector('[data-sat-annotation-caret]')).toBeNull();
  });

  it('gives a floating surface a caret pointing at the selection', () => {
    stubSurfaceSize();
    stubAnchorBox(300, 320);
    stubVisualViewport(800);
    renderPanel(false);

    const caret = document.querySelector('[data-sat-annotation-caret]')!;
    expect(document.querySelector('[data-sat-selection-toolbar="true"]')).not.toBeNull();
    // The surface sits above the selection, so the caret points down at it.
    expect(caret.getAttribute('data-sat-annotation-caret')).toBe('down');
    expect(document.querySelector('[data-sat-dock-quote="true"]')).toBeNull();
  });
});
