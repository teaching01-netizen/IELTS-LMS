import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('highlight tool selection tint CSS', () => {
  const css = readFileSync(resolve(__dirname, '../../../index.css'), 'utf8');

  it('binds surface text selection to the active highlight color variable', () => {
    expect(css).toMatch(
      /\[data-student-highlight-selection=["']true["']\]::selection[^{]*\{[^}]*background-color:\s*var\(--student-highlight-selection-color\)[^}]*color:\s*inherit[^}]*\}/s,
    );
  });

  it('keeps the tint on existing highlight marks inside a tinted surface', () => {
    expect(css).toMatch(
      /\[data-student-highlight-selection=["']true["']\]\s+\[data-highlighted=["']true["']\]::selection[^{]*\{[^}]*background-color:\s*var\(--student-highlight-selection-color\)[^}]*\}/s,
    );
  });

  it('mirrors both selection rules for Firefox ::-moz-selection', () => {
    expect(css).toMatch(
      /\[data-student-highlight-selection=["']true["']\]::-moz-selection[^{]*\{[^}]*background-color:\s*var\(--student-highlight-selection-color\)/s,
    );
    expect(css).toMatch(
      /\[data-student-highlight-selection=["']true["']\]\s+\[data-highlighted=["']true["']\]::-moz-selection/s,
    );
  });

  it('keeps the static blue selection fallback for untinted contexts', () => {
    expect(css).toMatch(
      /\[data-highlighted=["']true["']\]::selection[^{]*\{[^}]*background-color:\s*rgba\(\s*59,\s*130,\s*246,\s*0\.35\s*\)/s,
    );
  });

  it('never attaches the tint to form controls', () => {
    expect(css).not.toMatch(/(?:input|textarea|select)::selection/);
  });

  it('declares the tint rules after the static blue fallback so marks stay tinted', () => {
    const tintedMarksIndex = css.indexOf(
      '[data-student-highlight-selection="true"] [data-highlighted="true"]::selection',
    );
    const blueFallbackIndex = css.indexOf('[data-highlighted="true"]::selection');
    expect(tintedMarksIndex).toBeGreaterThan(blueFallbackIndex);
  });
});