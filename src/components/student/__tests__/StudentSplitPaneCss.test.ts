import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('student reading and writing split-pane CSS', () => {
  const css = readFileSync(resolve(__dirname, '../../../index.css'), 'utf8');

  it('does not retain an orphaned adaptive workspace scroll owner', () => {
    expect(css).not.toContain('.student-adaptive-workspace');
  });

  it('keeps named content panes shrinkable and touch-scrollable', () => {
    const paneRule = css.match(
      /\.student-reading-passage-pane,[\s\S]*?\.student-writing-editor-pane\s*\{([^}]*)\}/,
    )?.[1];
    expect(paneRule).toBeDefined();
    expect(paneRule).toMatch(/min-height:\s*0\s*;/);
    expect(paneRule).toMatch(/min-width:\s*0\s*;/);
    expect(paneRule).toMatch(/-webkit-overflow-scrolling:\s*touch\s*;/);
  });

  it('shows the draggable separator at all viewport sizes', () => {
    expect(css).not.toContain('.student-pane-separator {\n    display: none;');
    expect(css).toContain('.student-pane-separator {\n    display: flex;');
  });
});
