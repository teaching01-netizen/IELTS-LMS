import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('student exam in-flow viewport shell', () => {
  const css = readFileSync(resolve(__dirname, '../../../index.css'), 'utf8');

  it('uses dynamic viewport grid rows with an in-flow footer', () => {
    const activeDocumentRule = css.match(
      /html\.student-exam-active,\s*body\.student-exam-active\s*\{([^}]*)\}/s,
    )?.[1];
    const shellRule = css.match(/\.student-exam-shell\s*\{([^}]*)\}/s)?.[1];
    const mainRule = css.match(/\.student-exam-main\s*\{([^}]*)\}/s)?.[1];
    const footerRule = css.match(/\.student-exam-footer\s*\{([^}]*)\}/s)?.[1];

    expect(activeDocumentRule).toBeDefined();
    expect(activeDocumentRule).toMatch(/height:\s*100%\s*;/);
    expect(activeDocumentRule).toMatch(/overflow:\s*hidden\s*;/);
    expect(activeDocumentRule).not.toMatch(/--student-viewport-/);

    expect(shellRule).toBeDefined();
    expect(shellRule).toMatch(/position:\s*relative\s*;/);
    expect(shellRule).not.toMatch(/position:\s*fixed\s*;/);
    expect(shellRule).not.toMatch(/(?:^|;)\s*inset\s*:/);
    expect(shellRule).toMatch(/display:\s*grid\s*;/);
    expect(shellRule).toMatch(/height:\s*100vh\s*;[\s\S]*height:\s*100svh\s*;[\s\S]*height:\s*100dvh\s*;/);
    expect(shellRule).toMatch(/grid-template-rows:\s*auto\s+minmax\(0,\s*1fr\)\s+auto\s*;/);
    expect(shellRule).not.toMatch(/--student-viewport-/);

    expect(mainRule).toBeDefined();
    expect(mainRule).not.toMatch(/padding-block-end/);

    expect(footerRule).toBeDefined();
    expect(footerRule).toMatch(/position:\s*relative\s*;/);
    expect(footerRule).toMatch(/width:\s*100%\s*;/);
    expect(footerRule).toMatch(/padding-bottom:[^;]*safe-area-inset-bottom/);
    expect(footerRule).toMatch(/border-top:/);
    expect(footerRule).not.toMatch(/(?:^|;)\s*(?:bottom|inset-block-end)\s*:/);
    expect(footerRule).not.toMatch(/border-radius:\s*9999px\s*;/);
    expect(css).not.toContain('--student-exam-footer-reserve');
    expect(css).not.toContain('--student-viewport-height');
    expect(css).not.toContain('--student-viewport-offset-top');
  });

  it('renders a full-width footer surface without floating elevation', () => {
    const mainRule = css.match(/\.student-exam-main\s*\{([^}]*)\}/s)?.[1];
    const footerRule = css.match(/\.student-exam-footer\s*\{([^}]*)\}/s)?.[1];

    expect(mainRule).toMatch(/background-color:\s*#fff\s*;/);
    expect(footerRule).toMatch(/background:\s*#fff\s*;/);
    expect(footerRule).toMatch(/border-top:/);
    expect(footerRule).not.toMatch(/box-shadow:/);
  });
});
