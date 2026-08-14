import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('student adaptive shell CSS contract', () => {
  const css = readFileSync(resolve(__dirname, '../../../../index.css'), 'utf8');

  it('centralizes safe-area tokens', () => {
    expect(css).toMatch(/--student-safe-top:\s*env\(safe-area-inset-top/);
    expect(css).toMatch(/--student-safe-right:\s*env\(safe-area-inset-right/);
    expect(css).toMatch(/--student-safe-bottom:\s*env\(safe-area-inset-bottom/);
    expect(css).toMatch(/--student-safe-left:\s*env\(safe-area-inset-left/);
    expect(css).not.toContain('--student-exam-footer-clearance');
  });

  it('gives the shell the only viewport-height ownership and clips document overflow', () => {
    const shellRule = css.match(/\.student-exam-shell\s*\{([^}]*)\}/s)?.[1];

    expect(shellRule).toBeDefined();
    expect(shellRule).toMatch(/min-height:\s*0\s*;/);
    expect(shellRule).toMatch(/overflow:\s*hidden\s*;/);
    expect(shellRule).toMatch(/grid-template-rows:\s*auto\s+minmax\(0,\s*1fr\)\s*;/);
    expect(css).toMatch(
      /@supports\s*\(height:\s*100svh\)[\s\S]*?height:\s*100svh\s*;/,
    );
    expect(css).toMatch(
      /@supports\s*\(height:\s*100dvh\)[\s\S]*?height:\s*100dvh\s*;/,
    );
    expect(css).toMatch(
      /height:\s*var\(--student-visual-viewport-height,\s*100dvh\)\s*;/,
    );
  });

  it('partitions the viewport into flexible workspace and normal-flow footer rows', () => {
    const viewportRule = css.match(/\.student-exam-viewport\s*\{([^}]*)\}/s)?.[1];
    const mainRule = css.match(/^\s*\.student-exam-main\s*\{([^}]*)\}/m)?.[1];
    const footerRule = css.match(/^\s*\.student-exam-footer\s*\{([^}]*)\}/m)?.[1];

    expect(viewportRule).toBeDefined();
    expect(viewportRule).toMatch(/display:\s*grid\s*;/);
    expect(viewportRule).toMatch(/grid-template-rows:\s*minmax\(0,\s*1fr\)\s+auto\s*;/);
    expect(viewportRule).toMatch(/min-height:\s*0\s*;/);
    expect(viewportRule).toMatch(/overflow:\s*hidden\s*;/);

    expect(mainRule).toBeDefined();
    expect(mainRule).toMatch(/min-height:\s*0\s*;/);
    expect(mainRule).not.toMatch(/padding-block-end/);

    expect(footerRule).toBeDefined();
    expect(footerRule).not.toMatch(/position:\s*(?:absolute|fixed|sticky)\s*;/);
    expect(footerRule).toMatch(/margin-block-end:\s*max\(/);
    expect(footerRule).toMatch(/max-inline-size:\s*96rem\s*;/);
  });

  it('defines compact navigation as a safe-area-aware touch row', () => {
    const rule = css.match(/\.student-compact-question-navigation\s*\{([^}]*)\}/s)?.[1];

    expect(rule).toBeDefined();
    expect(rule).toMatch(/display:\s*flex/);
    expect(rule).toMatch(/min-height:\s*var\(--student-bottom-bar-height\)/);
    expect(rule).toMatch(/padding-bottom:\s*max\(/);
  });

  it('defines touch dimensions from runtime CSS tokens', () => {
    expect(css).toMatch(/--student-touch-target-min:\s*2\.75rem/);
    expect(css).toMatch(/--student-touch-target-preferred:\s*3rem/);
    expect(css).toMatch(/--student-header-height-compact:\s*3\.5rem/);
    expect(css).toMatch(/\.student-exam-shell\[data-student-layout-mode='compact'\].*button/s);
    expect(css).toMatch(/min-block-size:\s*var\(--student-touch-target-preferred\)/);
    expect(css).toMatch(/\.student-wide-header\s*\{[^}]*height:\s*var\(--student-header-height\)/s);
    expect(css).toMatch(/\.student-exam-shell\[data-student-touch-mode='true'\].*button/s);
  });
});
