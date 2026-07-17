import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('student question touch-callout CSS', () => {
  const css = readFileSync(resolve(__dirname, '../../../index.css'), 'utf8');

  it('suppresses the callout on marked question copy while preserving selection', () => {
    expect(css).toMatch(
      /\[data-student-question-callout-protected=["']true["']\],\s*\[data-student-question-callout-protected=["']true["']\] \*\s*\{[^}]*-webkit-touch-callout:\s*none[^}]*-webkit-user-select:\s*text[^}]*user-select:\s*text[^}]*\}/s,
    );
  });

  it('does not include answer controls in the protection selector', () => {
    const selector = css.match(
      /([^{}]*data-student-question-callout-protected[^{}]*)\{/,
    )?.[1] ?? '';

    expect(selector).not.toMatch(/input|textarea|select|button|contenteditable/);
  });
});
