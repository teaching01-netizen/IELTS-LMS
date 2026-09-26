import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SatTextAnchor } from '../../../domain/satResponses';
import { SatSelectionActionsPanel } from '../SatSelectionActionsPanel';
import { useSatAnnotationPlacement } from '../useSatAnnotationPlacement';
import { satAnnotationSurfaceChrome } from '../SatAnnotationSurfaceFrame';
import { SAT_EXAM_ZOOM_MAX, SAT_EXAM_ZOOM_MIN, SAT_EXAM_ZOOM_STEP } from '../../../domain/satReadingPreferences';
import type { SelectionMenuEnvironment } from '@shared/ui/selection-v2/engine/selectionPlacement';

/**
 * The runtime half of annotation placement: the pure engine is tested on its
 * own, and this is what proves the WIRING — that an owned coarse-pointer
 * selection keeps finger-friendly spacing without reserving a native menu
 * lane, that explicit native selection UI does reserve one, that the surface
 * waits for the geometry to settle before it appears, that the VISIBLE region
 * is the bound rather than the container, and that a surface the DOM cannot
 * measure stays reachable instead of vanishing.
 *
 * jsdom measures nothing (no layout, no Range rects), so every measurement the
 * runtime depends on is supplied explicitly. The stubs are the environment, not
 * the subject.
 */

const anchor: SatTextAnchor = { nodeId: 'stimulus:p1', startOffset: 2, endOffset: 6, exact: 'tree' };
const SURFACE = { width: 288, height: 108 };
const FINE_POINTER: SelectionMenuEnvironment = { coarsePointer: false, nativeSelectionUi: false };
const OWNED_COARSE_POINTER: SelectionMenuEnvironment = { coarsePointer: true, nativeSelectionUi: false };

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
  override(HTMLElement.prototype, 'getBoundingClientRect', function (this: HTMLElement) {
    if (this.dataset['testid'] === 'surface' || this.getAttribute('role') === 'toolbar') {
      return {
        x: 0, y: 0, left: 0, top: 0, right: width, bottom: height, width, height,
        toJSON: () => ({}),
      } as DOMRect;
    }
    return {
      x: 0, y: 0, left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0,
      toJSON: () => ({}),
    } as DOMRect;
  });
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
function Harness({ selection, environment }: { selection: SatTextAnchor | null; environment: SelectionMenuEnvironment }) {
  const { placement, containerRef, measure } = useSatAnnotationPlacement(selection, { environment });
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
        data-max-height={placement?.maxHeight ?? -1}
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
const zoomValues = Array.from(
  { length: Math.round((SAT_EXAM_ZOOM_MAX - SAT_EXAM_ZOOM_MIN) / SAT_EXAM_ZOOM_STEP) + 1 },
  (_, index) => SAT_EXAM_ZOOM_MIN + index * SAT_EXAM_ZOOM_STEP,
);

describe('useSatAnnotationPlacement', () => {
  it('converts viewport placement and rendered size back to the exam plane at 50%', () => {
    const chrome = satAnnotationSurfaceChrome({
      mode: 'floating',
      left: 120,
      top: 80,
      width: 288,
      maxHeight: 400,
      side: 'above',
      arrowX: 32,
      animated: false,
      clamped: false,
    }, 0.5);

    expect(chrome.style.left).toBe(240);
    expect(chrome.style.top).toBe(160);
    expect(chrome.style.width).toBe(576);
    expect(chrome.style.maxHeight).toBe(800);
    expect(chrome.bodyMaxHeight).toBe(800);
  });

  it.each(zoomValues)('uses the shared geometry conversion at %s zoom', (scale) => {
    const placement = {
      mode: 'floating' as const,
      left: 120,
      top: 80,
      width: 288,
      maxHeight: 400,
      side: 'above' as const,
      arrowX: 32,
      animated: false,
      clamped: false,
    };
    const chrome = satAnnotationSurfaceChrome(placement, scale);

    expect(chrome.style.left).toBeCloseTo(placement.left / scale, 8);
    expect(chrome.style.top).toBeCloseTo(placement.top / scale, 8);
    expect(chrome.style.width).toBeCloseTo(placement.width / scale, 8);
    expect(chrome.style.maxHeight).toBeCloseTo(placement.maxHeight / scale, 8);
    expect(chrome.bodyMaxHeight).toBeCloseTo(placement.maxHeight / scale, 8);
  });

  it('waits for the selection to settle before it surfaces', () => {
    vi.useFakeTimers();
    stubSurfaceSize();
    stubAnchorBox(300, 320);
    stubVisualViewport(800);
    render(<Harness selection={anchor} environment={FINE_POINTER} />);
    // Mounted, measured, and deliberately not shown yet: a selection that is
    // still moving does not get a toolbar under the student's finger.
    expect(surface().dataset['mode']).toBe('hidden');

    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(surface().dataset['mode']).toBe('floating');
  });

  it('uses ordinary touch comfort spacing when the exam owns selection', async () => {
    stubSurfaceSize();
    stubAnchorBox(200, 220);

    stubVisualViewport(400);
    const { unmount } = render(<Harness selection={anchor} environment={OWNED_COARSE_POINTER} />);
    // Coarse-pointer ergonomics do not imply native selection UI. With enough
    // room on both sides the owned toolbar takes the ordinary preferred side.
    await settled('floating');
    expect(surface().dataset['side']).toBe('above');
    unmount();

    stubVisualViewport(800);
    render(<Harness selection={anchor} environment={OWNED_COARSE_POINTER} />);
    // More room does not introduce a native-menu reservation either.
    await settled('floating');
    expect(surface().dataset['side']).toBe('above');
  });

  it('uses only the normal gap when an owned selection has no room above', async () => {
    stubSurfaceSize();
    stubVisualViewport(400);
    // High in the visible region, above has no room for the toolbar. The owned
    // selection puts it below at the normal 12px gap.
    stubAnchorBox(60, 80);
    render(<Harness selection={anchor} environment={OWNED_COARSE_POINTER} />);
    await settled('floating');
    expect(surface().dataset['side']).toBe('below');
    expect(Number(surface().dataset['top'])).toBe(80 + 12);
  });

  it('follows the room that appears and re-decides for a new selection', async () => {
    stubSurfaceSize();
    stubVisualViewport(400);
    stubAnchorBox(60, 80);
    const { rerender } = render(<Harness selection={anchor} environment={OWNED_COARSE_POINTER} />);
    await settled('floating');
    expect(surface().dataset['side']).toBe('below');

    // Room appears (the keyboard closed, the passage scrolled): the surface is
    // placed against the words again, keeping its already chosen side.
    stubVisualViewport(800);
    stubAnchorBox(300, 320);
    remeasure();
    await settled('floating');

    // A different selection is a new decision, and starts by waiting to settle.
    vi.useFakeTimers();
    rerender(<Harness selection={{ ...anchor, startOffset: 4, endOffset: 8, exact: 'ree' }} environment={OWNED_COARSE_POINTER} />);
    expect(surface().dataset['mode']).toBe('hidden');
  });

  it('keeps its side while that side still fits', async () => {
    stubSurfaceSize();
    stubVisualViewport(800);
    // No room above this selection, so the surface starts below it.
    stubAnchorBox(100, 120);
    const { rerender } = render(<Harness selection={anchor} environment={FINE_POINTER} />);
    await settled('floating');
    expect(surface().dataset['side']).toBe('below');

    // The selection moves down the passage: above fits now, and a fresh decision
    // would move the surface up there. It stays put instead — the side is chosen
    // once and kept until it genuinely stops fitting.
    stubAnchorBox(300, 320);
    rerender(<Harness selection={anchor} environment={FINE_POINTER} />);
    remeasure();
    expect(surface().dataset['side']).toBe('below');
  });

  it('bounds the surface with the visible region, not the container', async () => {
    stubSurfaceSize(320, 168);
    // A phone with the software keyboard up: the shell freezes its own height,
    // so the container stays tall while only 110px remain visible.
    stubVisualViewport(110);
    vi.spyOn(
      document.querySelector<HTMLElement>('[data-sat-annotation-bounds="true"]')!,
      'getBoundingClientRect',
    ).mockReturnValue({ top: 0, left: 0, width: 800, height: 700 } as DOMRect);
    stubAnchorBox(40, 60);
    render(<Harness selection={anchor} environment={FINE_POINTER} />);

    await settled('floating');
    // Pinned to the top of what the student can see, with its rows bounded by the
    // visible bottom edge (110 - 12) rather than the container's (700): the
    // actions scroll instead of hiding under the keyboard, and the surface never
    // grows past the region it was placed in.
    expect(Number(surface().dataset['top'])).toBe(12);
    expect(Number(surface().dataset['maxHeight'])).toBe(110 - 12 * 2);
    expect(Number(surface().dataset['maxHeight'])).toBeLessThan(168);
  });

  it('holds the surface hidden while the device is turning', async () => {
    vi.useFakeTimers();
    stubSurfaceSize();
    stubAnchorBox(300, 320);
    stubVisualViewport(800);
    render(<Harness selection={anchor} environment={FINE_POINTER} />);
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
    render(<Harness selection={anchor} environment={FINE_POINTER} />);
    expect(surface().dataset['mode']).toBe('floating');
    expect(surface().dataset['left']).toBe('8');
  });
});

describe('SatSelectionActionsPanel', () => {
  const actions = { highlight: () => {}, underline: () => {}, addNote: () => {} };

  function renderPanel(environment: SelectionMenuEnvironment) {
    return render(
      <SatSelectionActionsPanel
        anchor={anchor}
        currentColor="yellow"
        actions={actions}
        environment={environment}
        onClose={() => {}}
      />,
      { container: document.querySelector<HTMLElement>('[data-sat-annotation-bounds="true"]')! },
    );
  }

  it('keeps the toolbar pinned and scrollable when the visible region is shorter than it', async () => {
    stubSurfaceSize();
    // A visible region shorter than the surface itself: there is nowhere to sit
    // beside the words, so the toolbar is pinned inside the region.
    stubVisualViewport(110);
    stubAnchorBox(40, 60);
    renderPanel(FINE_POINTER);

    // Still the toolbar — one presentation, and it scrolls its own rows — and
    // drawn as the plain capsule it always is. The bar carries no pointer in any
    // mode, so there is nothing here that the clamp would have to take away.
    await waitFor(() => expect(document.querySelector('[data-sat-selection-toolbar="true"]')).not.toBeNull());
    expect(document.querySelector('[data-sat-annotation-caret]')).toBeNull();
    expect(document.querySelector('[data-sat-annotation-surface-body]')).not.toBeNull();
  });

  it('places owned coarse-pointer selection beside the text with no native-menu lane', async () => {
    stubSurfaceSize();
    // Above cannot fit, so the owned toolbar sits 12px below the selected line.
    // The old touch/native-UI conflation inserted an artificial 80px gap here.
    stubAnchorBox(40, 60);
    stubVisualViewport(800);
    renderPanel(OWNED_COARSE_POINTER);

    await waitFor(() => expect(document.querySelector('[data-sat-selection-toolbar="true"]')).not.toBeNull());
    const toolbar = document.querySelector<HTMLElement>('[data-sat-selection-toolbar="true"]')!;
    expect(toolbar.style.top).toBe(`${60 + 12}px`);
  });

  it('reserves a lane when a native selection surface is explicitly present', async () => {
    stubSurfaceSize();
    stubAnchorBox(40, 60);
    stubVisualViewport(800);
    renderPanel({ coarsePointer: true, nativeSelectionUi: true });

    await waitFor(() => expect(document.querySelector('[data-sat-selection-toolbar="true"]')).not.toBeNull());
    const toolbar = document.querySelector<HTMLElement>('[data-sat-selection-toolbar="true"]')!;
    expect(toolbar.style.top).toBe(`${60 + 80 + 12}px`);
  });

  it('centres a floating surface on its anchored line, with no pointer of its own', async () => {
    stubSurfaceSize();
    stubAnchorBox(300, 320);
    stubVisualViewport(800);
    renderPanel(FINE_POINTER);

    await waitFor(() => expect(document.querySelector('[data-sat-selection-toolbar="true"]')).not.toBeNull());
    const toolbar = document.querySelector<HTMLElement>('[data-sat-selection-toolbar="true"]')!;
    // The anchored line runs 200→600, so its centre is 400 and a 288px surface
    // centred on it starts at 256; the same surface sits one 12px gap above the
    // line. That pair of numbers is the whole spatial argument now — the bar
    // draws no caret, so where it sits IS what says which line it belongs to.
    expect(toolbar.style.left).toBe(`${400 - SURFACE.width / 2}px`);
    expect(toolbar.style.top).toBe(`${300 - SURFACE.height - 12}px`);
    expect(document.querySelector('[data-sat-annotation-caret]')).toBeNull();
    expect(document.querySelector('.sat-annotation-caret-layer')).toBeNull();
  });

  it('claims no interaction hooks while it is waiting to settle', () => {
    vi.useFakeTimers();
    stubSurfaceSize();
    stubAnchorBox(300, 320);
    stubVisualViewport(800);
    renderPanel(FINE_POINTER);

    // Present in the DOM, invisible to the student: the shortcut that focuses
    // "the first toolbar control" must not find one nobody can see.
    const toolbar = document.querySelector('[role="toolbar"]')!;
    expect(toolbar).not.toBeNull();
    expect(toolbar.getAttribute('data-sat-selection-toolbar')).toBeNull();
  });
});
