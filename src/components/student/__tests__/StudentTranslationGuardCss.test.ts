import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('student translation guard CSS', () => {
  const css = readFileSync(resolve(__dirname, '../../../index.css'), 'utf8');

  it('disables callouts on highlightable text and leaves selection policy to the exam rules', () => {
    const guard = css.match(
      /\.student-translation-guard-active\s+\[data-student-highlightable=["']true["']\][^{]*\{([^{}]*)\}/s,
    )?.[1] ?? '';

    expect(guard).toContain('-webkit-touch-callout: none');
    // The guard runs for the whole exam. If it re-declared `user-select`, it
    // would hand native selection — and with it the platform's Copy / Look Up
    // menu — back to every IELTS surface by specificity, no matter what the
    // exam-wide rules say.
    expect(guard).not.toMatch(/user-select/);
    expect(css).not.toMatch(/\.student-translation-guard-active[^,{]*(?:input|textarea|select)/);
  });
});
