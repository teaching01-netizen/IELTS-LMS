import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('student exam CSS-owned viewport shell', () => {
  const css = readFileSync(resolve(__dirname, '../../../index.css'), 'utf8');

  it('uses one fixed grid constraint system without measured geometry', () => {
    const activeDocumentRule = css.match(
      /html\.student-exam-active,\s*body\.student-exam-active\s*\{([^}]*)\}/s,
    )?.[1];
    const shellRule = css.match(/\.student-exam-shell\s*\{([^}]*)\}/s)?.[1];
    const mainRule = css.match(/\.student-exam-main\s*\{([^}]*)\}/s)?.[1];
    const footerRule = css.match(/\.student-exam-footer\s*\{([^}]*)\}/s)?.[1];

    expect(activeDocumentRule).toBeDefined();
    expect(activeDocumentRule).toMatch(/overflow:\s*hidden\s*;/);
    expect(activeDocumentRule).not.toMatch(/--student-viewport-/);
    expect(activeDocumentRule).not.toMatch(/height:\s*(?:100v|var\()/);

    expect(shellRule).toBeDefined();
    expect(shellRule).toMatch(/position:\s*fixed\s*;/);
    expect(shellRule).toMatch(/inset:\s*0\s*;/);
    expect(shellRule).toMatch(/display:\s*grid\s*;/);
    expect(shellRule).toMatch(/grid-template-rows:\s*auto\s+minmax\(0,\s*1fr\)\s*;/);
    expect(shellRule).not.toMatch(/minmax\(0,\s*1fr\)\s+auto/);
    expect(shellRule).not.toMatch(/--student-viewport-/);
    expect(shellRule).not.toMatch(/(?:^|;)\s*(?:height|top):/);

    expect(mainRule).toBeDefined();
    expect(mainRule).toMatch(
      /padding-block-end:\s*var\(--student-exam-footer-reserve\)\s*;/,
    );

    expect(footerRule).toBeDefined();
    expect(footerRule).toMatch(/position:\s*fixed\s*;/);
    expect(footerRule).toMatch(/border-radius:\s*9999px\s*;/);
    expect(footerRule).toMatch(/safe-area-inset-bottom/);
    expect(footerRule).not.toMatch(/position:\s*sticky\s*;/);
    expect(css).not.toContain('--student-viewport-height');
    expect(css).not.toContain('--student-viewport-offset-top');
  });

  it('renders the floating pill over a continuous white exam canvas', () => {
    const mainRule = css.match(/\.student-exam-main\s*\{([^}]*)\}/s)?.[1];
    const footerRule = css.match(/\.student-exam-footer\s*\{([^}]*)\}/s)?.[1];
    const footerShadow = footerRule?.match(/box-shadow:\s*([^;]+);/s)?.[1];

    expect(mainRule).toMatch(/background-color:\s*#fff\s*;/);
    expect(footerRule).not.toMatch(/(?:^|;)\s*border\s*:/);
    expect(footerShadow).toContain(',');
    expect(footerShadow).toMatch(/rgba\(9,\s*30,\s*66,\s*0\.08\)/);
    expect(footerShadow).toMatch(/rgba\(9,\s*30,\s*66,\s*0\.12\)/);
    expect(footerShadow).not.toMatch(/rgba\([^)]*,\s*0\.2\)/);
  });
});
