import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('student translation guard CSS', () => {
  const css = readFileSync(resolve(__dirname, '../../../index.css'), 'utf8');

  it('disables callouts only for active highlightable text while preserving selection', () => {
    expect(css).toMatch(
      /\.student-translation-guard-active\s+\[data-student-highlightable=["']true["']\][^{]*\{[^}]*-webkit-touch-callout:\s*none[^}]*user-select:\s*text[^}]*\}/s,
    );
    expect(css).not.toMatch(/\.student-translation-guard-active[^,{]*(?:input|textarea|select)/);
  });
});
