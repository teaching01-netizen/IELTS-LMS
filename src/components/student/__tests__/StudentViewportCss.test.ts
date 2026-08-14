import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('student exam viewport shell CSS', () => {
  const css = readFileSync(resolve(__dirname, '../../../index.css'), 'utf8');

  it('uses dynamic viewport fallbacks without an unguarded height owner', () => {
    const shellRule = css.match(/^\s*\.student-exam-shell\s*\{([^}]*)\}/m)?.[1];

    expect(shellRule).toBeDefined();
    expect(shellRule).toMatch(/position:\s*relative\s*;/);
    expect(shellRule).toMatch(/min-height:\s*0\s*;/);
    expect(shellRule).not.toMatch(/height:\s*(?:100vh|100svh|100dvh)\s*;/);
    expect(css).toMatch(
      /@supports\s*\(height:\s*100svh\)[\s\S]*?\.student-exam-shell\.student-exam-shell\s*\{[^}]*height:\s*100svh\s*;/,
    );
    expect(css).toMatch(
      /@supports\s*\(height:\s*100dvh\)[\s\S]*?\.student-exam-shell\.student-exam-shell\s*\{[^}]*height:\s*100dvh\s*;/,
    );
    expect(css).toMatch(
      /\.student-exam-shell\.student-exam-shell\s*\{[^}]*height:\s*var\(--student-visual-viewport-height,\s*100dvh\)\s*;/,
    );
    expect(css).not.toContain('--student-viewport-height');
    expect(css).not.toContain('--student-viewport-offset-top');
  });

  it('uses grid containment for viewport, workspace, and footer flow', () => {
    const viewportRule = css.match(/^\s*\.student-exam-viewport\s*\{([^}]*)\}/m)?.[1];
    const mainRule = css.match(/^\s*\.student-exam-main\s*\{([^}]*)\}/m)?.[1];
    const footerRule = css.match(/^\s*\.student-exam-footer\s*\{([^}]*)\}/m)?.[1];

    expect(viewportRule).toMatch(/display:\s*grid\s*;/);
    expect(viewportRule).toMatch(/grid-template-rows:\s*minmax\(0,\s*1fr\)\s+auto\s*;/);
    expect(viewportRule).toMatch(/min-height:\s*0\s*;/);
    expect(viewportRule).toMatch(/overflow:\s*hidden\s*;/);
    expect(mainRule).toMatch(/min-height:\s*0\s*;/);
    expect(mainRule).toMatch(/min-width:\s*0\s*;/);
    expect(footerRule).not.toMatch(/position:\s*(?:absolute|fixed|sticky)\s*;/);
    expect(footerRule).toMatch(/margin-block-end:\s*max\(/);
    expect(footerRule).toMatch(/max-inline-size:\s*96rem\s*;/);
    expect(css).not.toContain('--student-exam-footer-clearance');
  });

  it('keeps the footer visual pill while preventing a full-width tray', () => {
    const footerRule = css.match(/^\s*\.student-exam-footer\s*\{([^}]*)\}/m)?.[1];

    expect(footerRule).toMatch(/background:\s*#fff\s*;/);
    expect(footerRule).toMatch(/max-inline-size:\s*96rem\s*;/);
    expect(footerRule).toMatch(/border-radius:\s*9999px\s*;/);
    expect(footerRule).toMatch(/box-shadow:/);
    expect(footerRule).not.toMatch(/width:\s*100%\s*;/);
  });

  it('keeps question stepper clearance local to its workspace', () => {
    const stepperRule = css.match(/\.student-question-stepper\s*\{([^}]*)\}/s)?.[1];

    expect(stepperRule).toBeDefined();
    expect(stepperRule).toMatch(/bottom:\s*1rem\s*;/);
    expect(stepperRule).not.toContain('--student-exam-footer-clearance');
  });
});
