import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('student exam visible viewport CSS', () => {
  const css = readFileSync(resolve(__dirname, '../../../index.css'), 'utf8');

  it('fixes the exam shell to the tracked visual viewport top edge', () => {
    const shellRule = css.match(/\.student-exam-shell\s*\{([^}]*)\}/s)?.[1];

    expect(shellRule).toBeDefined();
    expect(shellRule).toMatch(/position:\s*fixed\s*;/);
    expect(shellRule).toMatch(/top:\s*var\(--student-viewport-offset-top,\s*0px\)\s*;/);
    expect(shellRule).toMatch(/left:\s*0\s*;/);
    expect(shellRule).toMatch(/right:\s*0\s*;/);
    expect(shellRule).toMatch(
      /height:\s*max\(var\(--student-viewport-height,\s*100dvh\),\s*100dvh\)\s*;/,
    );
  });
});
