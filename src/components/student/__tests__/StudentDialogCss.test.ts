import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('student native dialog CSS', () => {
  const css = readFileSync(resolve(__dirname, '../../../index.css'), 'utf8');

  it('keeps open native dialogs centered after the Tailwind reset', () => {
    const openDialogRule = css.match(/dialog\[open\]\s*\{([^}]*)\}/)?.[1];

    expect(openDialogRule).toBeDefined();
    expect(openDialogRule).toMatch(/margin:\s*auto\s*;/);
  });
});
