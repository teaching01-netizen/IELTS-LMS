import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('student exam floating footer viewport shell', () => {
  const css = readFileSync(resolve(__dirname, '../../../index.css'), 'utf8');

  it('anchors the footer absolutely inside the dynamic viewport shell', () => {
    const shellRule = css.match(/^\s*\.student-exam-shell\s*\{([^}]*)\}/m)?.[1];
    const mainRule = css.match(/^\s*\.student-exam-main\s*\{([^}]*)\}/m)?.[1];
    const footerRule = css.match(/^\s*\.student-exam-footer\s*\{([^}]*)\}/m)?.[1];

    expect(shellRule).toBeDefined();
    expect(shellRule).toMatch(/position:\s*relative\s*;/);
    expect(shellRule).not.toMatch(/height:\s*(?:100vh|100svh|100dvh)\s*;/);
    expect(css).toMatch(
      /@supports\s*\(height:\s*100svh\)[\s\S]*?\.student-exam-shell\.student-exam-shell\s*\{[^}]*height:\s*100svh\s*;/,
    );
    expect(css).toMatch(
      /@supports\s*\(height:\s*100dvh\)[\s\S]*?\.student-exam-shell\.student-exam-shell\s*\{[^}]*height:\s*100dvh\s*;/,
    );
    expect(css).toMatch(
      /\.student-exam-shell\.student-exam-shell\s*\{[^}]*height:\s*var\(--student-visual-viewport-height\)\s*;/,
    );
    expect(shellRule).toMatch(/grid-template-rows:\s*auto\s+minmax\(0,\s*1fr\)\s*;/);
    expect(shellRule).toMatch(/--student-exam-footer-clearance:/);

    expect(mainRule).toBeDefined();
    expect(mainRule).not.toMatch(/padding-block-end/);

    expect(footerRule).toBeDefined();
    expect(footerRule).toMatch(/position:\s*absolute\s*;/);
    expect(footerRule).not.toMatch(/position:\s*(?:fixed|sticky)\s*;/);
    expect(footerRule).toMatch(/left:[^;]*safe-area-inset-left/);
    expect(footerRule).toMatch(/right:[^;]*safe-area-inset-right/);
    expect(footerRule).toMatch(/bottom:[^;]*safe-area-inset-bottom/);
    expect(css).not.toContain('--student-viewport-height');
    expect(css).not.toContain('--student-viewport-offset-top');
  });

  it('renders only a white floating pill without a full-width tray', () => {
    const footerRule = css.match(/^\s*\.student-exam-footer\s*\{([^}]*)\}/m)?.[1];

    expect(footerRule).toMatch(/background:\s*#fff\s*;/);
    expect(footerRule).toMatch(/max-inline-size:\s*96rem\s*;/);
    expect(footerRule).toMatch(/border-radius:\s*9999px\s*;/);
    expect(footerRule).toMatch(/box-shadow:/);
    expect(footerRule).not.toMatch(/width:\s*100%\s*;/);
    expect(footerRule).not.toMatch(/margin-block:/);
  });

  it('keeps previous and next controls above the footer pill', () => {
    const stepperRule = css.match(/\.student-question-stepper\s*\{([^}]*)\}/s)?.[1];

    expect(stepperRule).toBeDefined();
    expect(stepperRule).toMatch(/bottom:[^;]*--student-exam-footer-clearance/);
  });
});
