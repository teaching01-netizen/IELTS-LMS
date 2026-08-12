import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('student adaptive shell CSS contract', () => {
  const css = readFileSync(resolve(__dirname, '../../../../index.css'), 'utf8');

  it('centralizes safe-area and shell clearance tokens', () => {
    expect(css).toMatch(/--student-safe-top:\s*env\(safe-area-inset-top/);
    expect(css).toMatch(/--student-safe-right:\s*env\(safe-area-inset-right/);
    expect(css).toMatch(/--student-safe-bottom:\s*env\(safe-area-inset-bottom/);
    expect(css).toMatch(/--student-safe-left:\s*env\(safe-area-inset-left/);
    expect(css).toMatch(/--student-exam-footer-clearance:\s*calc\(/);
  });

  it('defines compact navigation as a safe-area-aware touch row', () => {
    const rule = css.match(/\.student-compact-question-navigation\s*\{([^}]*)\}/s)?.[1];

    expect(rule).toBeDefined();
    expect(rule).toMatch(/display:\s*flex/);
    expect(rule).toMatch(/min-height:\s*var\(--student-bottom-bar-height\)/);
    expect(rule).toMatch(/padding-bottom:\s*max\(/);
  });
});
