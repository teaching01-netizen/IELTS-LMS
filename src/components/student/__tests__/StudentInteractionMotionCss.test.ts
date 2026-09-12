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

  it('caps every overlay entrance at 130ms (P1.4)', () => {
    expect(css).toMatch(
      /\.student-question-navigator\[open\]\s*\{\s*animation:\s*student-surface-in\s+130ms\s+ease-out\s*;\s*\}/,
    );
    expect(css).toMatch(
      /\.student-tools-sheet\[open\]\s*\{\s*animation:\s*student-sheet-in\s+130ms\s+ease-out\s*;\s*\}/,
    );
    expect(css).toMatch(
      /\.student-confirmation-surface\s*\{\s*animation:\s*student-surface-in\s+130ms\s+ease-out\s*;\s*\}/,
    );
    expect(css).toMatch(
      /\.student-question-navigator\[open\]::backdrop\s*\{\s*animation:\s*student-backdrop-in\s+130ms\s+ease-out\s*;\s*\}/,
    );
    expect(css).toMatch(
      /\.student-tools-sheet\[open\]::backdrop\s*\{\s*animation:\s*student-backdrop-in\s+130ms\s+ease-out\s*;\s*\}/,
    );
    // No student overlay may animate longer than the 140ms cap.
    expect(css).not.toMatch(/student-(surface|sheet|backdrop)-in\s+1[5-9]\dms/);
    expect(css).not.toMatch(/student-(surface|sheet|backdrop)-in\s+[2-9]\d{2,}ms/);
  });

  it('uses a static urgency treatment for the timer (no pulsing animation)', () => {
    // The old keyframe is intentionally gone: reduced-motion environments and
    // animation-end cleanup both made it fragile (P1.4).
    expect(css).not.toMatch(/@keyframes\s+student-urgent-cue\s*\{/);
    expect(css).toMatch(
      /\.student-timer-urgent\s*\{[^}]*box-shadow:\s*inset\s+0\s+0\s+0\s+2px\s+rgba\(212,\s*76,\s*71,\s*0\.55\)[^}]*\}/,
    );
    expect(css).toMatch(
      /\.student-timer-urgent\s*\{[^}]*border-color:\s*rgba\(212,\s*76,\s*71,\s*0\.55\)[^}]*\}/,
    );
    expect(css).not.toMatch(/\.student-timer-urgent[^}]*animation/);
    expect(css).not.toMatch(/\.student-timer-urgent[^}]*infinite/);
  });

  it('collapses dialog backdrop motion under prefers-reduced-motion', () => {
    expect(css).toMatch(
      /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*?dialog::backdrop\s*\{\s*animation-duration:\s*0\.01ms\s*!important;\s*transition-duration:\s*0\.01ms\s*!important;\s*\}/,
    );
  });

  it('declares no viewport-dependent exam font tokens (P1.1 follow-through)', () => {
    // The student shell must not reintroduce clamp()/vw-based content sizes.
    expect(css).not.toMatch(/--student-(passage|question|answer|writing|control|chip|meta|preview)[a-z-]*:\s*[^;]*(clamp\(|vw|vmin|vmax)/);
  });
});
