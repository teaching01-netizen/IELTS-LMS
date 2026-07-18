import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('student exam visible viewport CSS', () => {
  const css = readFileSync(resolve(__dirname, '../../../index.css'), 'utf8');

  it('fixes the exam shell to the exact tracked visual viewport rectangle', () => {
    const activeDocumentRule = css.match(
      /html\.student-exam-active,\s*body\.student-exam-active\s*\{([^}]*)\}/s,
    )?.[1];
    const shellRule = css.match(/\.student-exam-shell\s*\{([^}]*)\}/s)?.[1];

    expect(activeDocumentRule).toBeDefined();
    expect(activeDocumentRule).toMatch(
      /height:\s*100vh\s*;[\s\S]*height:\s*100dvh\s*;[\s\S]*height:\s*var\(--student-viewport-height,\s*100dvh\)\s*;/,
    );
    expect(activeDocumentRule).not.toMatch(/height:\s*max\(/);

    expect(shellRule).toBeDefined();
    expect(shellRule).toMatch(/position:\s*fixed\s*;/);
    expect(shellRule).toMatch(/top:\s*var\(--student-viewport-offset-top,\s*0px\)\s*;/);
    expect(shellRule).toMatch(/left:\s*0\s*;/);
    expect(shellRule).toMatch(/right:\s*0\s*;/);
    expect(shellRule).toMatch(
      /height:\s*100vh\s*;[\s\S]*height:\s*100dvh\s*;[\s\S]*height:\s*var\(--student-viewport-height,\s*100dvh\)\s*;/,
    );
    expect(shellRule).not.toMatch(/height:\s*max\(/);
    expect(shellRule).not.toMatch(/min-height:\s*[1-9]/);
  });
});
