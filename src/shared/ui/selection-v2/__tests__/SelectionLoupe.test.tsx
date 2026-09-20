import React from 'react';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SelectionLoupe } from '../react/SelectionLoupe';

/**
 * The magnifier's picture, and what it must NOT carry with it.
 *
 * Two things are being proven here, and the second one is the reason this file
 * exists separately from the menu: the copy must still LOOK like the text (same
 * prose, same ink, positioned from the finger at the configured scale), and it
 * must not become a second addressable surface — no data attributes, no
 * identity, no semantics, no pointer, no focus, no assistive-technology entry.
 */

function source(markup: string): { current: HTMLElement } {
  const element = document.createElement('div');
  element.innerHTML = markup;
  document.body.append(element);
  return { current: element };
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
  it('does not become a second addressable surface', () => {
    const sourceRef = source(PROSE);
    render(<SelectionLoupe open point={{ x: 40, y: 200 }} sourceRef={sourceRef} />);

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
    expect(clone.querySelector('p')!.getAttributeNames()).toEqual([]);
    // And it is unreachable for pointer, focus and assistive technology alike.
    expect(clone).toHaveAttribute('inert');
    expect(clone).toHaveAttribute('aria-hidden', 'true');
    // A mark that is a real control in the page is not a tab stop in the
    // picture: the engine's own marks are `role="button" tabindex="0"` spans.
    expect(clone.querySelectorAll('[tabindex="-1"]')).toHaveLength(1);
    expect(clone.querySelector('[tabindex="0"]')).toBeNull();
  });

  it('magnifies a clone of the rendered content, taken once, with its ink intact', () => {
    const sourceRef = source(PROSE);
    const { rerender } = render(<SelectionLoupe open point={{ x: 40, y: 200 }} sourceRef={sourceRef} />);

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

    rerender(<SelectionLoupe open point={{ x: 60, y: 220 }} sourceRef={sourceRef} />);

    // Moving the finger must not rebuild the clone: only its transform changes.
    expect(document.querySelector('[data-selection-loupe-source]')).toBe(clone);
  });

  it('sits above the finger, and moves the picture with it at the configured scale', () => {
    const sourceRef = source(PROSE);
    const { rerender } = render(
      <SelectionLoupe open point={{ x: 100, y: 300 }} sourceRef={sourceRef} diameter={120} magnification={1.5} offset={60} />,
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
      <SelectionLoupe open point={{ x: 110, y: 310 }} sourceRef={sourceRef} diameter={120} magnification={1.5} offset={60} />,
    );

    // Following the finger moves the picture by the finger's delta times the
    // magnification — the text under the lens stays the text under the lens.
    expect(document.querySelector('[data-selection-loupe]')).toHaveStyle({ transform: 'translate3d(50px, 190px, 0)' });
    expect(document.querySelector('[data-selection-loupe-content]')).toHaveStyle({
      transform: 'translate3d(-105px, -405px, 0) scale(1.5)',
    });
  });

  it('renders nothing when it is closed', () => {
    const sourceRef = source(PROSE);
    render(<SelectionLoupe open={false} point={{ x: 40, y: 200 }} sourceRef={sourceRef} />);

    expect(document.querySelector('[data-selection-loupe]')).toBeNull();
    expect(document.querySelector('[data-selection-loupe-source]')).toBeNull();
  });
});
