import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('student interaction motion CSS', () => {
  const css = readFileSync(resolve(__dirname, '../../../index.css'), 'utf8');

  it('declares the surface entrance keyframes (fade + 8px rise)', () => {
    expect(css).toMatch(
      /@keyframes\s+student-surface-in\s*\{\s*from\s*\{\s*opacity:\s*0;\s*transform:\s*translateY\(8px\);\s*\}\s*to\s*\{\s*opacity:\s*1;\s*transform:\s*none;\s*\}\s*\}/,
    );
  });

  it('declares the bottom-sheet entrance keyframes (fade + 32px rise)', () => {
    expect(css).toMatch(
      /@keyframes\s+student-sheet-in\s*\{\s*from\s*\{\s*opacity:\s*0;\s*transform:\s*translateY\(32px\);\s*\}\s*to\s*\{\s*opacity:\s*1;\s*transform:\s*none;\s*\}\s*\}/,
    );
  });

  it('declares the backdrop fade-in keyframes', () => {
    expect(css).toMatch(
      /@keyframes\s+student-backdrop-in\s*\{\s*from\s*\{\s*opacity:\s*0;\s*\}\s*to\s*\{\s*opacity:\s*1;\s*\}\s*\}/,
    );
  });

  it('binds the open question navigator to the surface entrance', () => {
    expect(css).toMatch(
      /\.student-question-navigator\[open\]\s*\{\s*animation:\s*student-surface-in\s+200ms\s+ease-out\s*;\s*\}/,
    );
  });

  it('binds the open tools sheet to the sheet entrance', () => {
    expect(css).toMatch(
      /\.student-tools-sheet\[open\]\s*\{\s*animation:\s*student-sheet-in\s+200ms\s+ease-out\s*;\s*\}/,
    );
  });

  it('binds the submit confirmation surface to the entrance', () => {
    expect(css).toMatch(
      /\.student-confirmation-surface\s*\{\s*animation:\s*student-surface-in\s+200ms\s+ease-out\s*;\s*\}/,
    );
  });

  it('fades in both dialog backdrops alongside the surface', () => {
    expect(css).toMatch(
      /\.student-question-navigator\[open\]::backdrop\s*\{\s*animation:\s*student-backdrop-in\s+200ms\s+ease-out\s*;\s*\}/,
    );
    expect(css).toMatch(
      /\.student-tools-sheet\[open\]::backdrop\s*\{\s*animation:\s*student-backdrop-in\s+200ms\s+ease-out\s*;\s*\}/,
    );
  });

  it('declares the one-shot timer urgency cue (2s, exactly one iteration)', () => {
    expect(css).toMatch(
      /@keyframes\s+student-urgent-cue\s*\{\s*0%,\s*100%\s*\{\s*box-shadow:\s*0\s+0\s+0\s+0\s+rgba\(212,\s*76,\s*71,\s*0\);\s*\}\s*50%\s*\{\s*box-shadow:\s*0\s+0\s+0\s+4px\s+rgba\(212,\s*76,\s*71,\s*0\.12\);\s*\}\s*\}/,
    );
    expect(css).toMatch(
      /\.student-timer-urgent\s*\{\s*animation:\s*student-urgent-cue\s+2s\s+ease-out\s+1\s*;\s*\}/,
    );
    expect(css).not.toMatch(/\.student-timer-urgent[^}]*infinite/);
  });

  it('collapses dialog backdrop motion under prefers-reduced-motion', () => {
    expect(css).toMatch(
      /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*?dialog::backdrop\s*\{\s*animation-duration:\s*0\.01ms\s*!important;\s*transition-duration:\s*0\.01ms\s*!important;\s*\}/,
    );
  });
});