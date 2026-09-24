import React from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SelectionLoupe, resolveLoupeDiameter } from '../react/SelectionLoupe';
import { pictureTranslation, type LoupePicture } from '../react/loupePicture';

/**
 * The magnifier's picture, and what it must NOT carry with it.
 *
 * Three things are being proven here. The copy must still LOOK like the text
 * (same prose, same ink, positioned from the finger at the configured scale); it
 * must not become a second addressable surface — no data attributes, no
 * identity, no semantics, no pointer, no focus, no assistive-technology entry;
 * and it must be the DOCUMENT'S OWN LAYOUT, so that a coordinate in the page is
 * the same coordinate inside the lens. That last one is not decoration: a clone
 * left to lay itself out at the lens's width puts its text a hundred pixels from
 * where the finger is, and the lens shows an empty white disc while the student's
 * own highlighted words sit visible in the page just outside it.
 */

function source(markup: string): { current: HTMLElement } {
  const element = document.createElement('div');
  element.innerHTML = markup;
  document.body.append(element);
  return { current: element };
}

/**
 * A source with a layout.
 *
 * jsdom measures every element as 0×0, which is exactly the geometry that hides
 * the defect this file guards: with the source at the origin the finger-relative
 * arithmetic is trivially satisfied. A stubbed rect is how the real mapping —
 * finger in the page → finger in the picture — is asserted without a browser.
 */
function measuredSource(
  markup: string,
  box: { left: number; top: number; width: number; height: number },
): { current: HTMLElement } {
  const element = document.createElement('div');
  element.innerHTML = markup;
  element.getBoundingClientRect = () => ({
    ...box,
    right: box.left + box.width,
    bottom: box.top + box.height,
    x: box.left,
    y: box.top,
    toJSON: () => box,
  }) as DOMRect;
  document.body.append(element);
  return { current: element };
}

/**
 * The browser's own answer for how far a box sits inside its parent.
 *
 * jsdom reports 0 for all of it, which is also the honest answer for a passage
 * whose first block carries no top margin — so without this stub the one case the
 * correction exists for is the one case a unit test could not tell apart from a
 * correct lens. The platform's answer is stubbed; the arithmetic under test is
 * the component's own.
 */
function withLeadingMargin(displacement: { x: number; y: number }, run: () => void): void {
  const byProperty = { offsetLeft: displacement.x, offsetTop: displacement.y } as const;
  const spies = (['offsetLeft', 'offsetTop'] as const).map((property) =>
    vi.spyOn(HTMLElement.prototype, property, 'get').mockImplementation(function (this: HTMLElement) {
      // Only the picture is displaced: the probe it is measured in, and the lens
      // it is finally laid out in, both begin where they say they do.
      return this.hasAttribute('data-selection-loupe-source') ? byProperty[property] : 0;
    }));
  try {
    run();
  } finally {
    for (const spy of spies) spy.mockRestore();
  }
}

/** The rendered prose as the app really marks it up: addressing attributes everywhere. */
const PROSE = `
  <div data-student-owned-touch-selection="true" data-sat-annotation-region="stimulus">
    <p data-content-text-node="p1" aria-label="Passage" role="group">
      <span class="ink" style="background-color: rgb(255, 235, 59)" data-sat-highlight="true" data-sat-highlight-color="yellow" data-sat-annotation-control="true" role="button" tabindex="0" aria-label="Edit highlight">alpha beta</span>
    </p>
  </div>
`;

describe('SelectionLoupe', () => {
  it.each([0.5, 0.75, 1, 1.25, 1.5, 1.75, 2])('maps the same resolved caret boundary through the loupe at scale %s', (visualScale) => {
    const picture: LoupePicture = {
      left: 30,
      top: 200,
      width: 400,
      visualScale,
      backdrop: '#fff',
      origin: { x: 4, y: 8 },
    };
    const logicalCaret = { x: 100, y: 20 };
    const viewportCaret = {
      x: picture.left + logicalCaret.x * visualScale,
      y: picture.top + logicalCaret.y * visualScale,
    };
    const translation = pictureTranslation(picture, viewportCaret, 120, 1.5);

    expect(translation.left + visualScale * 1.5 * (picture.origin.x + logicalCaret.x)).toBeCloseTo(60);
    expect(translation.top + visualScale * 1.5 * (picture.origin.y + logicalCaret.y)).toBeCloseTo(60);
  });

  it('does not become a second addressable surface', () => {
    const sourceRef = source(PROSE);
    render(<SelectionLoupe open fingerPoint={{ x: 40, y: 200 }} sourceRef={sourceRef} />);

    // One of each, in the whole document — the invariant the engine is built on:
    // one active selection, one addressable surface.
    for (const selector of [
      '[data-student-owned-touch-selection]',
      '[data-sat-annotation-region="stimulus"]',
      '[data-content-text-node]',
      '[data-sat-highlight="true"]',
    ]) {
      expect(document.querySelectorAll(selector), selector).toHaveLength(1);
    }

    const clone = document.querySelector('[data-selection-loupe-source]') as HTMLElement;
    // The picture's own markers, and nothing else that belongs to the page.
    expect(Array.from(clone.attributes).map((attribute) => attribute.name).sort())
      .toEqual(['aria-hidden', 'data-selection-loupe-source', 'inert', 'style']);
    // Semantics and identity are gone from the subtree, not merely hidden.
    // `style` alone survives: the sterilization hardening (`user-select`,
    // `pointer-events`) is written inline so it holds even if the CSS is late.
    expect(clone.querySelector('p')!.getAttributeNames()).toEqual(['style']);
    // And it is unreachable for pointer, focus and assistive technology alike.
    expect(clone).toHaveAttribute('inert');
    expect(clone).toHaveAttribute('aria-hidden', 'true');
    // A mark that is a real control in the page is not a tab stop in the
    // picture: the engine's own marks are `role="button" tabindex="0"` spans.
    expect(clone.querySelectorAll('[tabindex="-1"]')).toHaveLength(1);
    expect(clone.querySelector('[tabindex="0"]')).toBeNull();
  });

  it('is sterile paint: the clone and every descendant are non-selectable', () => {
    // jsdom drops `-webkit-*` declarations from the style object, so the
    // webkit half of `dressPicture` is proven through the calls it issues
    // (real browsers honor them); the standard half is proven on the nodes.
    const spy = vi.spyOn(CSSStyleDeclaration.prototype, 'setProperty');
    const sourceRef = source(PROSE);
    render(<SelectionLoupe open fingerPoint={{ x: 40, y: 200 }} sourceRef={sourceRef} />);
    try {
      const issued = spy.mock.calls.map(
        ([property, value, priority]) => `${property}=${value}/${priority ?? ''}`,
      );
      for (const property of ['-webkit-user-select', 'user-select', '-webkit-touch-callout', 'pointer-events']) {
        expect(issued, property).toContain(`${property}=none/important`);
      }
    } finally {
      spy.mockRestore();
    }

    const clone = document.querySelector('[data-selection-loupe-source]') as HTMLElement;
    const nodes = [clone, ...Array.from(clone.querySelectorAll<HTMLElement>('*'))];
    // At least the prose itself: a clone with no descendants proves nothing.
    expect(nodes.length).toBeGreaterThan(1);
    for (const node of nodes) {
      expect(node.style.getPropertyValue('user-select')).toBe('none');
      expect(node.style.getPropertyValue('pointer-events')).toBe('none');
    }
    // And the stylesheet contract on top of it.
    expect(getComputedStyle(clone).userSelect).toBe('none');
  });

  it('magnifies a clone of the rendered content, taken once, with its ink intact', () => {
    const sourceRef = source(PROSE);
    const { rerender } = render(<SelectionLoupe open fingerPoint={{ x: 40, y: 200 }} sourceRef={sourceRef} />);

    expect(document.querySelector('[data-selection-loupe]')).toBeInTheDocument();
    const clone = document.querySelector('[data-selection-loupe-source]')!;
    expect(clone).toHaveTextContent('alpha beta');

    // The ink is painted inline, so it survives the sanitising: a magnified
    // highlight must still read as a highlight. Everything that described the
    // mark as a target is gone.
    const ink = clone.querySelector('.ink') as HTMLElement;
    expect(ink.getAttributeNames().sort()).toEqual(['class', 'style', 'tabindex']);
    expect(ink).toHaveStyle({ backgroundColor: 'rgb(255, 235, 59)' });
    expect(ink).toHaveAttribute('tabindex', '-1');

    rerender(<SelectionLoupe open fingerPoint={{ x: 60, y: 220 }} sourceRef={sourceRef} />);

    // Moving the finger must not rebuild the clone: only its transform changes.
    expect(document.querySelector('[data-selection-loupe-source]')).toBe(clone);
  });

  it('sits above the finger, and moves the picture with it at the configured scale', () => {
    const sourceRef = source(PROSE);
    const { rerender } = render(
      <SelectionLoupe open fingerPoint={{ x: 100, y: 300 }} sourceRef={sourceRef} diameter={120} magnification={1.5} offset={60} />,
    );

    const loupe = document.querySelector('[data-selection-loupe]') as HTMLElement;
    expect(loupe).toHaveStyle({ width: '120px', height: '120px', pointerEvents: 'none' });
    expect(loupe).toHaveAttribute('aria-hidden', 'true');
    // Centred under the finger, offset above it.
    expect(loupe).toHaveStyle({ transform: 'translate3d(40px, 180px, 0)' });
    // jsdom reports the source at 0,0, so the content offset is the finger's own
    // position, magnified, moved back to the loupe's centre.
    expect(document.querySelector('[data-selection-loupe-content]')).toHaveStyle({
      transform: 'translate3d(-90px, -390px, 0) scale(1.5)',
    });

    rerender(
      <SelectionLoupe open fingerPoint={{ x: 110, y: 310 }} sourceRef={sourceRef} diameter={120} magnification={1.5} offset={60} />,
    );

    // Following the finger moves the picture by the finger's delta times the
    // magnification — the text under the lens stays the text under the lens.
    expect(document.querySelector('[data-selection-loupe]')).toHaveStyle({ transform: 'translate3d(50px, 190px, 0)' });
    expect(document.querySelector('[data-selection-loupe-content]')).toHaveStyle({
      transform: 'translate3d(-105px, -405px, 0) scale(1.5)',
    });
  });

  it('takes the box from the finger and the picture from the caret, falling back only when there is no caret', () => {
    const sourceRef = measuredSource(PROSE, { left: 30, top: 200, width: 340, height: 120 });
    const lens = () => (document.querySelector('[data-selection-loupe]') as HTMLElement).style.transform;
    const content = () => (document.querySelector('[data-selection-loupe-content]') as HTMLElement).style.transform;

    // NO caret — the honest absence (a renderer with no layout, a resolver that
    // found nothing): the content falls back to the finger, and this asserts
    // that boundary as POLICY rather than leaving it as an accident of the
    // optional prop. The box follows the finger in every case below.
    const { rerender } = render(
      <SelectionLoupe open fingerPoint={{ x: 50, y: 360 }} sourceRef={sourceRef} diameter={120} magnification={1.5} offset={60} />,
    );
    expect(lens()).toBe('translate3d(-10px, 240px, 0)');
    expect(content()).toBe('translate3d(30px, -180px, 0) scale(1.5)');

    // A caret: the CONTENT moves to it — magnification × (caret − finger) away
    // from the finger-based mapping — while the BOX does not move a pixel. Both
    // positions, asserted against the same numbers in the same render.
    rerender(
      <SelectionLoupe open fingerPoint={{ x: 50, y: 360 }} caretPoint={{ x: 80, y: 300 }} sourceRef={sourceRef} diameter={120} magnification={1.5} offset={60} />,
    );
    expect(lens()).toBe('translate3d(-10px, 240px, 0)');
    expect(content()).toBe('translate3d(-15px, -90px, 0) scale(1.5)');

    // The finger moves; the caret does not: byte-identical content — the new
    // contract's core sentence — while only the instrument follows the hand.
    rerender(
      <SelectionLoupe open fingerPoint={{ x: 70, y: 380 }} caretPoint={{ x: 80, y: 300 }} sourceRef={sourceRef} diameter={120} magnification={1.5} offset={60} />,
    );
    expect(lens()).toBe('translate3d(10px, 260px, 0)');
    expect(content()).toBe('translate3d(-15px, -90px, 0) scale(1.5)');

    // And the caret gone again: back to the fallback, for the same finger.
    rerender(
      <SelectionLoupe open fingerPoint={{ x: 70, y: 380 }} sourceRef={sourceRef} diameter={120} magnification={1.5} offset={60} />,
    );
    expect(content()).toBe('translate3d(0px, -210px, 0) scale(1.5)');
  });

  it('places the picture where the browser laid the clone out, not where the layer it was written into begins', () => {
    const sourceRef = measuredSource(PROSE, { left: 30, top: 200, width: 340, height: 120 });
    const bodyBefore = document.body.children.length;
    withLeadingMargin({ x: 3, y: 8 }, () => {
      render(
        <SelectionLoupe open fingerPoint={{ x: 50, y: 360 }} sourceRef={sourceRef} diameter={120} magnification={1.5} offset={60} />,
      );
    });

    const clone = document.querySelector('[data-selection-loupe-source]') as HTMLElement;
    const layer = document.querySelector('[data-selection-loupe-content]') as HTMLElement;
    // The clone ends up in the lens, and measuring it leaves nothing behind: the
    // probe is borrowed for one read, not attached to the page.
    expect(clone.parentElement).toBe(layer);
    // Exactly one node joined the page — the render's own container. The probe is
    // borrowed for a single read and taken back out in the same commit.
    expect(document.body.children.length - bodyBefore).toBe(1);

    // A leading margin collapses out of the clone, and the layer it is laid out in
    // is absolutely positioned, so that margin cannot collapse out of that either:
    // it sits inside the layer, above the picture, and displaces the clone by its
    // own height. The picture is therefore moved by the finger's own distance PLUS
    // that displacement — otherwise the lens shows the passage correctly and
    // indexes a column 8 document pixels from the one under the finger.
    expect(layer).toHaveStyle({ transform: 'translate3d(25.5px, -192px, 0) scale(1.5)' });
  });

  it('renders nothing when it is closed', () => {
    const sourceRef = source(PROSE);
    render(<SelectionLoupe open={false} fingerPoint={{ x: 40, y: 200 }} sourceRef={sourceRef} />);

    expect(document.querySelector('[data-selection-loupe]')).toBeNull();
    expect(document.querySelector('[data-selection-loupe-source]')).toBeNull();
  });
});

describe('the picture is the document, magnified', () => {
  it('lays the picture out at the document\'s own width, so a page coordinate is the same coordinate in the lens', () => {
    const sourceRef = measuredSource(PROSE, { left: 30, top: 200, width: 340, height: 120 });
    render(
      <SelectionLoupe open fingerPoint={{ x: 50, y: 360 }} sourceRef={sourceRef} diameter={120} magnification={1.5} offset={60} />,
    );

    // The picture's box IS the source's box: same width, and its own padding and
    // borders eating into that width rather than extending it.
    const picture = document.querySelector('[data-selection-loupe-content]') as HTMLElement;
    expect(picture).toHaveStyle({ width: '340px' });
    const clone = document.querySelector('[data-selection-loupe-source]') as HTMLElement;
    expect(clone).toHaveStyle({ width: '100%', boxSizing: 'border-box' });

    // And the finger's page position lands at the centre of the lens: the source
    // is 20px to the right of and 160px below the finger, so the picture moves
    // those 20/160 magnified distances back onto the lens's centre line.
    expect(picture).toHaveStyle({ transform: 'translate3d(30px, -180px, 0) scale(1.5)' });
  });

  it('re-reads the box on the commit that paints, so a passage the page moved without a scroll is followed', () => {
    const box = { left: 30, top: 200, width: 340, height: 120 };
    const sourceRef = measuredSource(PROSE, box);
    const { rerender } = render(
      <SelectionLoupe open fingerPoint={{ x: 50, y: 360 }} sourceRef={sourceRef} diameter={120} magnification={1.5} offset={60} />,
    );
    const layer = () => document.querySelector('[data-selection-loupe-content]') as HTMLElement;

    // The passage is 160px below the finger, so the picture moves those 160px,
    // magnified, up onto the lens's centre line.
    expect(layer()).toHaveStyle({ transform: 'translate3d(30px, -180px, 0) scale(1.5)' });

    // The page moves the passage 60px down: no scroll, no resize, and no change to
    // the passage's own size — nothing the lens could be listening for. Its box is
    // therefore not a value it may remember; the commit that paints reads it again.
    box.top = 260;
    rerender(
      <SelectionLoupe open fingerPoint={{ x: 50, y: 360 }} sourceRef={sourceRef} diameter={120} magnification={1.5} offset={60} />,
    );

    expect(layer()).toHaveStyle({ transform: 'translate3d(30px, -90px, 0) scale(1.5)' });
  });

  it('renders the picture in the document\'s own type, so the lines break where the document breaks them', () => {
    const element = document.createElement('div');
    element.textContent = 'alpha beta';
    element.style.fontFamily = 'Georgia, serif';
    element.style.fontSize = '21px';
    element.style.lineHeight = '34px';
    element.style.letterSpacing = '0.4px';
    element.style.color = 'rgb(12, 34, 56)';
    document.body.append(element);

    render(<SelectionLoupe open fingerPoint={{ x: 40, y: 200 }} sourceRef={{ current: element }} />);

    // The clone is mounted in a layer at `document.body`, so without this it would
    // inherit the LAYER's font: different metrics, different wrapping, different
    // words under the lens.
    const clone = document.querySelector('[data-selection-loupe-source]') as HTMLElement;
    expect(clone.style.fontFamily).toContain('Georgia');
    expect(clone.style.fontSize).toBe('21px');
    expect(clone.style.lineHeight).toBe('34px');
    expect(clone.style.letterSpacing).toBe('0.4px');
    expect(clone.style.color).toBe('rgb(12, 34, 56)');
  });

  it('sits on the document\'s own backdrop instead of assuming a white page', () => {
    const pane = document.createElement('div');
    pane.style.backgroundColor = 'rgb(18, 18, 20)';
    const element = document.createElement('div');
    element.innerHTML = PROSE;
    pane.append(element);
    document.body.append(pane);

    render(<SelectionLoupe open fingerPoint={{ x: 40, y: 200 }} sourceRef={{ current: element }} />);

    // The prose declares no background of its own; the pane it sits in does, and
    // a lens with a white disc under light text is a lens that shows nothing.
    expect(document.querySelector('[data-selection-loupe-frame]')).toHaveStyle({
      backgroundColor: 'rgb(18, 18, 20)',
    });
  });

  it('marks the column under the finger with a tick that the magnification does not scale', () => {
    const sourceRef = measuredSource(PROSE, { left: 30, top: 200, width: 340, height: 120 });
    render(<SelectionLoupe open fingerPoint={{ x: 50, y: 360 }} sourceRef={sourceRef} />);

    const marker = document.querySelector('[data-selection-loupe-marker]') as HTMLElement;
    // In the frame, never inside the picture: the mark indexes the column, so the
    // magnification must not scale it along with the text it is indexing. (Its
    // placement at the lens's centre is the sheet's — `selection.css`.)
    expect(marker).toHaveClass('selection-v2-loupe-marker');
    expect(marker.closest('[data-selection-loupe-content]')).toBeNull();
    expect(marker.closest('[data-selection-loupe-frame]')).not.toBeNull();
  });
});

describe('the lens is sized for the device it is on', () => {
  it('stays a phone-sized instrument between 120 and 150 CSS px, whatever the viewport', () => {
    for (const viewport of [
      { width: 320, height: 568 },
      { width: 390, height: 844 },
      { width: 430, height: 932 },
      { width: 768, height: 1024 },
      { width: 1440, height: 900 },
    ]) {
      const diameter = resolveLoupeDiameter(viewport);
      expect(diameter, JSON.stringify(viewport)).toBeGreaterThanOrEqual(120);
      expect(diameter, JSON.stringify(viewport)).toBeLessThanOrEqual(150);
    }

    // Responsive rather than hard-coded around one iPhone, and monotonic: a
    // narrower phone never gets the bigger lens.
    expect(resolveLoupeDiameter({ width: 320, height: 568 })).toBe(120);
    expect(resolveLoupeDiameter({ width: 1024, height: 1366 })).toBe(150);
    expect(resolveLoupeDiameter({ width: 360, height: 800 }))
      .toBeLessThan(resolveLoupeDiameter({ width: 430, height: 932 }));
  });

  it('uses the device\'s own lens when no size is passed, and the caller\'s when one is', () => {
    const sourceRef = source(PROSE);
    const { rerender } = render(<SelectionLoupe open fingerPoint={{ x: 40, y: 200 }} sourceRef={sourceRef} />);

    const width = Number.parseFloat((document.querySelector('[data-selection-loupe]') as HTMLElement).style.width);
    expect(width).toBeGreaterThanOrEqual(120);
    expect(width).toBeLessThanOrEqual(150);

    // The override is what the geometry suite drives, so it has to win outright.
    rerender(<SelectionLoupe open fingerPoint={{ x: 40, y: 200 }} sourceRef={sourceRef} diameter={128} />);
    expect(document.querySelector('[data-selection-loupe]')).toHaveStyle({ width: '128px', height: '128px' });
  });
});

describe('selection-v2 presentation is sterile', () => {
  // Comments are stripped before the rules are read: the rationale above the
  // rule talks about selection, and prose is not a selector.
  const rules = [
    ...readFileSync(resolve(__dirname, '../styles/selection.css'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .matchAll(/([^{}]+)\{([^{}]*)\}/g),
  ].map(([, selectors = '', body = '']) => ({ selectors: selectors.trim(), body: body.trim() }));

  it('denies native selection to the whole floating layer, loupe and clone', () => {
    const sterile = rules.find((rule) => rule.selectors.includes('[data-selection-loupe-source]'));
    expect(sterile).toBeDefined();
    // The complete synthetic surface — layer, loupe, clone — never the page.
    for (const selector of [
      '.selection-v2-layer',
      '.selection-v2-layer *',
      '.selection-v2-loupe',
      '.selection-v2-loupe *',
      '[data-selection-loupe-source]',
      '[data-selection-loupe-source] *',
    ]) {
      expect(sterile!.selectors, selector).toContain(selector);
    }
    expect(sterile!.selectors).not.toMatch(/html|body|\[data-sat-selection-protected\]/);
    expect(sterile!.body).toContain('-webkit-touch-callout: none');
    expect(sterile!.body).toContain('-webkit-user-select: none');
    expect(sterile!.body).toContain('user-select: none');
  });
});
