import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SAT_REF_CANVAS_H,
  SAT_REF_CANVAS_W,
  SAT_REF_READABLE_SCALE_MIN,
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
  it.each([0.5, 0.75, 1, 1.25, 1.5, 1.75, 2])('keeps body text readable and maximum zoom physical at Display %s', (scale) => {
    const fit = satRefFitScale(500 / scale, 1, 200 / scale, scale);
    expect(fit * scale * 16).toBeGreaterThanOrEqual(11);
    expect(fit * scale).toBeCloseTo(0.7);
    expect(satRefFitScale(1000 / scale, 1, 560 / scale, scale) * scale).toBeCloseTo(1, 2);
    expect(satRefFitScale(500 / scale, 2 / 0.7, 200 / scale, scale) * scale).toBeCloseTo(2);
    expect(isSatRefAtFit(500 / scale, 1, 200 / scale, scale)).toBe(true);
    expect(isSatRefAtFit(500 / scale, 1.25, 200 / scale, scale)).toBe(false);
  });
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

  it('matches the reference information and two-row arrangement', () => {
    const { container } = render(<SatReferenceSheet />);
    const figures = [...container.querySelectorAll('figure')];
    expect(figures.map((figure) => figure.querySelector('.sr-only')?.textContent)).toEqual([
      'Circle. ', 'Rectangle. ', 'Triangle. ', 'Right triangle. ',
      'Rectangular prism. ', 'Cylinder. ', 'Sphere. ', 'Cone. ', 'Rectangular pyramid. ',
    ]);
    expect(figures.slice(0, 4).every((figure) => figure.style.top === '24px')).toBe(true);
    expect(figures.slice(4).every((figure) => figure.style.top === '210px')).toBe(true);
    expect(figures.map((figure) => [...figure.querySelectorAll('math')].map((formula) => formula.textContent))).toEqual([
      ['A=πr2', 'C=2πr'], ['A=ℓw'], ['A=12bh'], ['c2=a2+b2'],
      ['V=ℓwh'], ['V=πr2h'], ['V=43πr3'], ['V=13πr2h'], ['V=13ℓwh'],
    ]);
    expect(screen.getByRole('img', { name: /45 45 90 triangle/ })).toHaveAccessibleName(
      '45 45 90 triangle with sides s, s, and s square root 2',
    );
    const special = screen.getByRole('region', { name: 'Special Right Triangles' });
    expect(special.style.top).toBe('24px');
    expect(special.querySelectorAll('svg')).toHaveLength(2);
    const facts = screen.getByRole('region', { name: 'Angle and circle facts' });
    expect([...facts.querySelectorAll('p')].map((fact) => fact.textContent?.trim())).toEqual([
      'The number of degrees of arc in a circle is 360.',
      'The number of radians of arc in a circle is 2π.',
      'The sum of the measures in degrees of the angles of a triangle is 180.',
    ]);
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
    // A narrow stage keeps the readable scale and grows the scroll footprint.
    const { container, rerender } = render(<SatReferenceSheet viewportWidth={666} zoom={1} />);
    const canvas = container.querySelector('[data-sat-ref-canvas]') as HTMLElement;
    const wrapper = canvas.parentElement as HTMLElement;
    expect(wrapper.style.width).toBe('700px');
    expect(wrapper.style.height).toBe(`${SAT_REF_CANVAS_H * 0.7}px`);
    expect(canvas.style.transform).toBe(`scale(0.7)`);

    // Zoom grows the wrapper along with the transformed composition.
    rerender(<SatReferenceSheet viewportWidth={1000} zoom={1.25} />);
    expect(wrapper.style.width).toBe('1250px');
    expect(wrapper.style.height).toBe('700px');
    expect(canvas.style.transform).toBe('scale(1.25)');

    // Legacy zoom below 1 is normalized to fit.
    rerender(<SatReferenceSheet viewportWidth={800} zoom={0.75} />);
    expect(Number.parseFloat(wrapper.style.width)).toBeCloseTo(800, 8);
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

    // A narrow stage scrolls horizontally at the readable floor.
    rerender(
      <SatReferenceSheet viewportWidth={480} stageWidth={480} stageHeight={800} zoom={1} />,
    );
    expect(canvas.style.transform).toBe('scale(0.7)');
    expect(Number.parseFloat(canvas.style.top)).toBeCloseTo(
      (800 - SAT_REF_CANVAS_H * 0.7) / 2,
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
  it('fits both axes, floors subpixels, and caps actual size at 100%', () => {
    expect(satRefFitScale(1000, 1, 560)).toBe(1);
    expect(satRefFitScale(920, 1, 517)).toBe(0.92);
    expect(satRefFitScale(900, 1, 503.98)).toBe(0.899);
    expect(satRefFitScale(2000, 1, 1400)).toBe(1);
    expect(satRefFitScale(830, 1)).toBe(0.83);
  });

  it('keeps 16px body text above 11px in small or short stages', () => {
    for (const [w, h] of [[480, 235], [520, 320], [700, 390], [1000, 300]]) {
      const scale = satRefFitScale(w, 1, h);
      expect(scale).toBe(0.7);
      expect(16 * scale).toBeGreaterThanOrEqual(11);
    }
  });

  it('magnifies the readable base and normalizes legacy zoom below fit', () => {
    expect(satRefFitScale(666, 1.5, 458)).toBeCloseTo(1.05);
    expect(satRefFitScale(800, 0.75)).toBe(0.8);
    expect(satRefFitScale(500, 2)).toBe(1.4);
    expect(satRefFitScale(1000, 99)).toBe(SAT_REFERENCE_ZOOM_MAX);
  });

  it('guards invalid measurements and uses width for absent height', () => {
    for (const width of [Number.NaN, 0, -5, undefined, '1000']) {
      expect(satRefFitScale(width, 1)).toBe(1);
    }
    for (const height of [undefined, 0, -10, Number.NaN, '517']) {
      expect(satRefFitScale(800, 1, height)).toBe(0.8);
    }
  });

  it('reports fit mode independently of whether the readable sheet needs scroll', () => {
    expect(isSatRefAtFit(480, 1, 235)).toBe(true);
    expect(isSatRefAtFit(920, 0.75, 517)).toBe(true);
    expect(isSatRefAtFit(920, 1.5, 517)).toBe(false);
  });
});

afterEach(() => vi.restoreAllMocks());

describe('SatReferenceSheetPanel', () => {
  const ids = { scheduleId: 'sched-04', attemptId: 'attempt-04', moduleAttemptId: 'module-04' };

  beforeEach(() => {
    matchMediaMock(false);
    window.localStorage.clear();
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(1000);
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(560);
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
    expect(screen.getByText('Fit', { exact: true })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Zoom out' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Fit sheet' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(screen.getByText('125%')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Fit sheet' }));
    expect(screen.getByText('Fit', { exact: true })).toBeInTheDocument();
    const scroller = document.querySelector('[data-sat-tool-scroll]') as HTMLElement;
    expect(scroller.style.overflow).toBe('auto');
    await user.click(screen.getByRole('button', { name: 'Zoom in' }));
    await user.click(screen.getByRole('button', { name: 'Zoom out' }));
    expect(screen.getByText('Fit', { exact: true })).toBeInTheDocument();
  });

  it('keeps overflow reachable at fit and when zoomed', async () => {
    const user = userEvent.setup();
    render(<SatReferenceSheetPanel open onClose={() => undefined} {...ids} />);
    const scroller = document.querySelector('[data-sat-tool-scroll]') as HTMLElement;
    expect(scroller.style.overflow).toBe('auto');
    await user.click(screen.getByRole('button', { name: 'Zoom in' }));
    await user.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(screen.getByText('150%')).toBeInTheDocument();
    expect(scroller.style.overflow).toBe('auto');
    await user.click(screen.getByRole('button', { name: 'Fit sheet' }));
    expect(screen.getByText('Fit', { exact: true })).toBeInTheDocument();
    expect(scroller.style.overflow).toBe('auto');
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
    expect(clampSatReferenceZoom(99)).toBe(SAT_REFERENCE_ZOOM_MAX / SAT_REF_READABLE_SCALE_MIN);
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
