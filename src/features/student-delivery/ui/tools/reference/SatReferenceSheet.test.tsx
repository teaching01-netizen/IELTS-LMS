import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SAT_REF_CANVAS_H,
  SAT_REF_CANVAS_W,
  isSatRefAtFit,
  SatReferenceSheet,
  satRefFitScale,
} from './SatReferenceSheet';
import {
  SAT_REFERENCE_ZOOM_MAX,
  SAT_REFERENCE_ZOOM_MIN,
  SatReferenceSheetPanel,
  clampSatReferenceZoom,
  satReferenceViewKey,
} from '../SatReferenceSheetPanel';

const matchMediaMock = (matches: boolean) => {
  vi.stubGlobal(
    'matchMedia',
    vi.fn(
      (query: string) =>
        ({
          matches,
          media: query,
          onchange: null,
          addListener: vi.fn(),
          removeListener: vi.fn(),
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
          dispatchEvent: vi.fn(),
        }) satisfies MediaQueryList,
    ),
  );
};

describe('SatReferenceSheet', () => {
  it('exposes geometry diagrams instead of hiding their authored accessibility labels', () => {
    render(<SatReferenceSheet />);
    expect(screen.getByRole('article', { name: 'SAT Math reference sheet' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Circle with radius r' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /30 60 90 triangle/i })).toBeInTheDocument();
  });

  it('keeps every figure accessible label', () => {
    render(<SatReferenceSheet />);
    expect(screen.getByRole('img', { name: 'Rectangle with length l and width w' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Triangle with base b and height h' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Right triangle with sides a b and c' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Rectangular prism with length width and height' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Cylinder with radius r and height h' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Sphere with radius r' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Cone with radius r and height h' })).toBeInTheDocument();
    expect(
      screen.getByRole('img', { name: 'Rectangular pyramid with length width and height' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /45 45 90 triangle/i })).toBeInTheDocument();
  });

  it('is a fixed-canonical canvas: no container/viewport breakpoints, 1000x560 inline geometry', () => {
    const { container } = render(<SatReferenceSheet />);
    const article = screen.getByRole('article', { name: 'SAT Math reference sheet' });
    expect(article.className).not.toContain('@container');
    expect(article.className).not.toContain('max-w-[900px]');
    expect(container.innerHTML).not.toContain('max-w-[900px]');
    // D7 regression: zero breakpoint/grid-column strings anywhere in the document.
    for (const banned of ['@[', 'sm:', 'md:', 'lg:', 'grid-cols-']) {
      expect(container.innerHTML).not.toContain(banned);
    }
    const canvas = container.querySelector('[data-sat-ref-canvas]') as HTMLElement;
    expect(canvas).not.toBeNull();
    expect(canvas.style.width).toBe(`${SAT_REF_CANVAS_W}px`);
    expect(canvas.style.height).toBe(`${SAT_REF_CANVAS_H}px`);
  });

  it('scales the fixed canvas as one composition from viewportWidth and zoom', () => {
    // R-07: 2-arg calls keep the legacy fit-width meaning (stageHeight
    // absent -> fit = vw / 1000, before the new cap/floor below).
    const { container, rerender } = render(<SatReferenceSheet viewportWidth={666} zoom={1} />);
    const canvas = container.querySelector('[data-sat-ref-canvas]') as HTMLElement;
    const wrapper = canvas.parentElement as HTMLElement;
    expect(wrapper.style.width).toBe('666px');
    expect(wrapper.style.height).toBe(`${SAT_REF_CANVAS_H * 0.666}px`);
    expect(canvas.style.transform).toBe(`scale(${666 / SAT_REF_CANVAS_W})`);

    // Zoom multiplies the legacy fit-width base (2-arg compat: no fit
    // floor/cap on the zoom factor); wrapper-height math tracks exactly.
    rerender(<SatReferenceSheet viewportWidth={1000} zoom={1.25} />);
    expect(wrapper.style.width).toBe('1250px');
    expect(wrapper.style.height).toBe('700px');
    expect(canvas.style.transform).toBe('scale(1.25)');

    // Zoom below 1 centers via margin auto on the shrunken wrapper.
    rerender(<SatReferenceSheet viewportWidth={800} zoom={0.75} />);
    expect(Number.parseFloat(wrapper.style.width)).toBeCloseTo(600, 8);
    expect(wrapper.style.margin).toBe('0px auto');
    expect(canvas.style.transform).toBe(`scale(${satRefFitScale(800, 0.75)})`);
  });

  it('centers the fitted sheet in an explicit stage (both axes)', () => {
    const { container, rerender } = render(
      <SatReferenceSheet viewportWidth={920} stageWidth={920} stageHeight={517} zoom={1} />,
    );
    const canvas = container.querySelector('[data-sat-ref-canvas]') as HTMLElement;
    const wrapper = canvas.parentElement as HTMLElement;
    // fit = min(0.92, 517 / 560 = 0.923) = 0.92, capped/floored -> 0.92.
    expect(wrapper.style.width).toBe('920px');
    expect(wrapper.style.height).toBe('517px');
    expect(wrapper.style.position).toBe('relative');
    expect(wrapper.style.overflow).toBe('hidden');
    expect(canvas.style.transform).toBe('scale(0.92)');
    expect(canvas.style.position).toBe('absolute');
    // Centered offsets: (920 - 920) / 2 = 0 left, (517 - 515.2) / 2 = 0.9 top.
    expect(Number.parseFloat(canvas.style.left)).toBeCloseTo(0, 8);
    expect(Number.parseFloat(canvas.style.top)).toBeCloseTo(
      (517 - SAT_REF_CANVAS_H * 0.92) / 2,
      8,
    );

    // Height-bound stage: tall-narrow 480x800 -> min(0.48, 1.428) = 0.48.
    rerender(
      <SatReferenceSheet viewportWidth={480} stageWidth={480} stageHeight={800} zoom={1} />,
    );
    expect(canvas.style.transform).toBe('scale(0.48)');
    expect(Number.parseFloat(canvas.style.top)).toBeCloseTo(
      (800 - SAT_REF_CANVAS_H * 0.48) / 2,
      8,
    );

    // Zoomed past fit grows the wrapper to the scaled size (never clips
    // before the panel scroller can pan); cap-1 sheets keep staged offsets.
    rerender(
      <SatReferenceSheet viewportWidth={1000} stageWidth={1000} stageHeight={560} zoom={1.5} />,
    );
    expect(canvas.style.transform).toBe('scale(1.5)');
    expect(Number.parseFloat(wrapper.style.width)).toBeCloseTo(1500, 8);
    expect(Number.parseFloat(wrapper.style.height)).toBeCloseTo(840, 8);
  });

  it('renders MathML formulas with the serif stack, not KaTeX or wrapping grids', () => {
    const { container } = render(<SatReferenceSheet />);
    const maths = container.querySelectorAll('math');
    expect(maths.length).toBeGreaterThanOrEqual(9);
    expect(container.querySelector('msup')).not.toBeNull();
    expect(container.querySelector('mfrac')).not.toBeNull();
    expect(container.innerHTML).not.toContain('katex');
    const article = screen.getByRole('article', { name: 'SAT Math reference sheet' });
    expect(article.querySelector('.grid')).toBeNull();
  });
});

describe('satRefFitScale', () => {
  it('returns viewportWidth / 1000 at zoom 1 (2-arg legacy compat)', () => {
    expect(satRefFitScale(1000, 1)).toBe(1);
    expect(satRefFitScale(666, 1)).toBeCloseTo(0.666, 10);
    expect(satRefFitScale(800, 1)).toBe(0.8);
    expect(satRefFitScale(830, 1)).toBeCloseTo(0.83, 10);
    expect(satRefFitScale(900, 1)).toBe(0.9);
  });

  it('multiplies by the clamped zoom (2-arg legacy compat)', () => {
    expect(satRefFitScale(1000, 1.25)).toBe(1.25);
    expect(satRefFitScale(500, 2)).toBe(1);
    expect(satRefFitScale(1000, 99)).toBe(SAT_REFERENCE_ZOOM_MAX);
  });

  it('guards non-finite and non-positive viewports to 1', () => {
    expect(satRefFitScale(Number.NaN, 1)).toBe(1);
    expect(satRefFitScale(0, 1)).toBe(1);
    expect(satRefFitScale(-5, 1)).toBe(1);
    expect(satRefFitScale(undefined, 1)).toBe(1);
    expect(satRefFitScale('1000', 1)).toBe(1);
  });

  // R-07 contain-fit vectors (§6 Step 1): min(vw/1000, vh/560), cap 1,
  // effective floor fit (legacy zoom < 1 renders as fit).
  it('contains the sheet in the stage box (R-07 §6 vectors)', () => {
    // 1000x560 -> 1 (exact fit).
    expect(satRefFitScale(1000, 1, 560)).toBe(1);
    // 666x458 -> min(0.666, 0.817) = 0.666 (width-bound).
    expect(satRefFitScale(666, 1, 458)).toBeCloseTo(0.666, 10);
    // 920x517(stage) -> min(0.92, 0.923) = 0.92.
    expect(satRefFitScale(920, 1, 517)).toBeCloseTo(0.92, 10);
    // tall-narrow 480x800 -> min(0.48, 1.428) = 0.48 (width-bound).
    expect(satRefFitScale(480, 1, 800)).toBeCloseTo(0.48, 10);
    // short-wide 1000x300 -> min(1, 0.5357) = 0.5357 (height-bound).
    expect(satRefFitScale(1000, 1, 300)).toBeCloseTo(300 / 560, 10);
  });

  it('caps at 1 on huge stages and magnifies zoom over fit', () => {
    // huge 2000x1400 -> min(2, 2.5) capped to 1.
    expect(satRefFitScale(2000, 1, 1400)).toBe(1);
    // zoom 1.5 over a 0.666 fit -> 0.999.
    expect(satRefFitScale(666, 1.5, 458)).toBeCloseTo(0.666 * 1.5, 10);
    // legacy zoom 0.75 renders exactly as fit (== zoom-1 result).
    expect(satRefFitScale(666, 0.75, 458)).toBe(satRefFitScale(666, 1, 458));
    expect(satRefFitScale(666, 0.75, 458)).toBeCloseTo(0.666, 10);
  });

  it('ignores degenerate stage heights (2-arg compat preserved)', () => {
    for (const bad of [undefined, 0, -10, Number.NaN, '517' as unknown as number]) {
      expect(satRefFitScale(666, 1, bad)).toBeCloseTo(satRefFitScale(666, 1), 10);
    }
    // Legacy zoom factors survive the degenerate path too (no fit floor).
    expect(satRefFitScale(800, 0.75, undefined)).toBeCloseTo(0.6, 10);
  });

  it('reports at-fit through the exported pure fn', () => {
    expect(isSatRefAtFit(920, 1, 517)).toBe(true);
    expect(isSatRefAtFit(920, 0.75, 517)).toBe(true);
    expect(isSatRefAtFit(920, 1.5, 517)).toBe(false);
    expect(isSatRefAtFit(920, 1, undefined)).toBe(true);
  });
});

describe('SatReferenceSheetPanel', () => {
  const ids = { scheduleId: 'sched-04', attemptId: 'attempt-04', moduleAttemptId: 'module-04' };

  beforeEach(() => {
    matchMediaMock(false);
    window.localStorage.clear();
    vi.unstubAllGlobals();
    matchMediaMock(false);
  });

  it('renders the resizable floating shell (C11 parity) with the thin stable scroll viewport', () => {
    render(<SatReferenceSheetPanel open onClose={() => undefined} {...ids} />);
    const dialog = screen.getByRole('dialog', { name: 'Reference Sheet' });
    expect(dialog).toHaveAttribute('data-sat-tool-window', 'Reference Sheet');
    expect(dialog).toHaveAttribute('data-sat-tool-presentation', 'floating');
    expect(dialog).toHaveAttribute('data-sat-tool-resizable', 'true');
    expect(dialog.querySelectorAll('[data-sat-resize-handle]')).toHaveLength(1);
    expect(dialog.querySelector('[data-sat-tool-scroll]')).not.toBeNull();
  });

  it('zooms in steps, labels the percent, and Fit sheet resets to whole-visible', async () => {
    const user = userEvent.setup();
    render(<SatReferenceSheetPanel open onClose={() => undefined} {...ids} />);
    expect(screen.getByText('100%')).toBeInTheDocument();
    const zoomOut = screen.getByRole('button', { name: 'Zoom out' });
    expect(zoomOut).toBeDisabled();
    expect(zoomOut).toHaveAttribute('title', 'The sheet already fits the window');
    await user.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(screen.getByText('125%')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Fit sheet' }));
    expect(screen.getByText('100%')).toBeInTheDocument();
    const scroller = document.querySelector('[data-sat-tool-scroll]') as HTMLElement;
    expect(scroller.style.overflow).toBe('hidden');
    await user.click(screen.getByRole('button', { name: 'Zoom in' }));
    await user.click(screen.getByRole('button', { name: 'Zoom out' }));
    expect(screen.getByText('100%')).toBeInTheDocument();
  });

  it('hides overflow at fit and pans when zoomed past fit (R-07)', async () => {
    const user = userEvent.setup();
    render(<SatReferenceSheetPanel open onClose={() => undefined} {...ids} />);
    const scroller = document.querySelector('[data-sat-tool-scroll]') as HTMLElement;
    expect(scroller.style.overflow).toBe('hidden');
    await user.click(screen.getByRole('button', { name: 'Zoom in' }));
    await user.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(screen.getByText('150%')).toBeInTheDocument();
    expect(scroller.style.overflow).toBe('auto');
    await user.click(screen.getByRole('button', { name: 'Fit sheet' }));
    expect(screen.getByText('100%')).toBeInTheDocument();
    expect(scroller.style.overflow).toBe('hidden');
    expect(scroller.scrollTop).toBe(0);
  });

  it('persists zoom and scrollTop and restores them on remount', async () => {
    const user = userEvent.setup();
    const viewKey = satReferenceViewKey(ids.scheduleId, ids.attemptId, ids.moduleAttemptId);
    const first = render(<SatReferenceSheetPanel open onClose={() => undefined} {...ids} />);
    await user.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(screen.getByText('125%')).toBeInTheDocument();
    const stored = JSON.parse(window.localStorage.getItem(viewKey) ?? '{}') as {
      zoom?: number;
      scrollTop?: number;
    };
    expect(stored.zoom).toBeCloseTo(1.25);
    const scroller = document.querySelector('[data-sat-tool-scroll]') as HTMLElement;
    scroller.scrollTop = 77;
    fireEvent.scroll(scroller);
    expect(
      (JSON.parse(window.localStorage.getItem(viewKey) ?? '{}') as { scrollTop?: number })
        .scrollTop,
    ).toBe(77);
    first.unmount();

    window.localStorage.setItem(viewKey, JSON.stringify({ zoom: 1.5, scrollTop: 0 }));
    render(<SatReferenceSheetPanel open onClose={() => undefined} {...ids} />);
    expect(screen.getByText('150%')).toBeInTheDocument();
  });

  it('clamps zoom to the supported range', () => {
    expect(clampSatReferenceZoom(1)).toBe(1);
    expect(clampSatReferenceZoom(99)).toBe(SAT_REFERENCE_ZOOM_MAX);
    expect(clampSatReferenceZoom(-3)).toBe(SAT_REFERENCE_ZOOM_MIN);
    expect(clampSatReferenceZoom(Number.NaN)).toBe(1);
  });

  it('announces zoom changes politely without announcing on mount', async () => {
    const user = userEvent.setup();
    const { container } = render(<SatReferenceSheetPanel open onClose={() => undefined} {...ids} />);
    const status = container.querySelector('[role="status"]');
    expect(status).not.toBeNull();
    expect(status!.textContent).toBe('');
    await user.click(screen.getByRole('button', { name: 'Zoom in' }));
    await waitFor(() => expect(status!.textContent).toContain('125'));
  });
});
