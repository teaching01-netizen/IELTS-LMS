import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('SAT system-contracts CSS (sat-* rules only)', () => {
  const css = readFileSync(resolve(__dirname, '../../../../index.css'), 'utf8');

  it('F-A6: search-clear stays centered at a 28px target, exempt from the coarse 44px floor', () => {
    const rule = css.match(/\.sat-product\s+\.sat-search-clear\s*\{([^}]*)\}/)?.[1];
    expect(rule).toBeDefined();
    expect(rule).toMatch(/top:\s*50%\s*!important/);
    expect(rule).toMatch(/transform:\s*translateY\(-50%\)/);
    expect(rule).toMatch(/min-block-size:\s*28px\s*!important/);
    expect(rule).toMatch(/min-inline-size:\s*28px\s*!important/);
  });

  it('F-A12: route fade gate opts out with a reduced-motion guard', () => {
    expect(css).toContain('.sat-route-fade');
    const gate = css.match(/\.sat-route-fade\s*\{([^}]*)\}/)?.[1];
    expect(gate).toMatch(/animation:\s*none/);
    expect(css).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*?\.sat-route-fade[\s\S]*?opacity:\s*1\s*!important/);
  });

  // Phase 05 dark appearance (system-following only, no toggle). Helpers:
  // the dark region is sliced dark-media-start → dark+more-media-start so a
  // forced-colors mapping can never mask a missing dark twin.
  const darkMediaStart = css.indexOf('@media (prefers-color-scheme: dark)');
  const darkMoreStart = css.indexOf('@media (prefers-color-scheme: dark) and (prefers-contrast: more)');
  const darkRegion = css.slice(darkMediaStart, darkMoreStart);
  const darkMoreRegion = css.slice(darkMoreStart);

  it('DARK-01: dark media sets color-scheme: dark for .sat-product', () => {
    expect(darkMediaStart).toBeGreaterThan(-1);
    expect(css).toMatch(/@media\s*\(prefers-color-scheme:\s*dark\)[\s\S]*?\.sat-product[\s\S]*?color-scheme:\s*dark/);
  });

  it('DARK-02: every --sat-staff-* light token has a dark override', () => {
    const lightBlock = css.match(/\.sat-product\s*\{([^}]*--sat-staff-canvas[^}]*)\}/)?.[1] ?? '';
    expect(lightBlock).toContain('--sat-staff-canvas');
    const names = (s: string) =>
      new Set([...s.matchAll(/(--sat-staff-[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
    // Exempt: geometry + motion vocabulary never inverts (plan §Step 7).
    const EXEMPT = new Set([
      '--sat-staff-radius-chip', '--sat-staff-radius-control-sm', '--sat-staff-radius-control',
      '--sat-staff-radius-input', '--sat-staff-radius-menu', '--sat-staff-radius-card',
      '--sat-staff-radius-dialog', '--sat-staff-ease', '--sat-staff-ease-press',
      '--sat-staff-motion-hover', '--sat-staff-motion-state', '--sat-staff-motion-banner',
      '--sat-staff-motion-row', '--sat-staff-motion-press', '--sat-staff-motion-dialog',
      '--sat-staff-motion-dialog-max', '--sat-staff-stagger-step', '--sat-staff-stagger-cap',
      '--sat-staff-focus-width', '--sat-staff-focus-offset', '--sat-staff-focus-offset-tight',
      '--sat-staff-shimmer-duration', '--sat-staff-skeleton-pulse-duration',
      '--sat-staff-spinner-duration', '--sat-staff-live-dot-duration',
    ]);
    for (const n of names(lightBlock)) {
      if (!EXEMPT.has(n)) expect(darkRegion, n).toContain(n + ':');
    }
  });

  it('DARK-03: no light-only white glass survives in dark', () => {
    expect(darkRegion).toContain('--sat-staff-glass-sidebar: rgba(28, 28, 30');
    expect(darkRegion).toContain('--sat-staff-surface-solid-fallback: #1c1c1e');
    expect(darkRegion).toContain('--sat-staff-surface: #1c1c1e');
    expect(darkRegion).not.toContain('255, 255, 255, 0.82');
  });

  it('DARK-04: status text/dot dark twins present', () => {
    for (const token of [
      '--sat-staff-warning-text: #ffd09a',
      '--sat-staff-success-text: #76e8b7',
      '--sat-staff-info-text: #8ac2ff',
      '--sat-staff-danger: #ff8f85',
      '--sat-staff-neutral-dot: #a1a1a6',
      '--sat-staff-form-error: #ff8f85',
    ]) {
      expect(darkRegion, token).toContain(token);
    }
  });

  it('DARK-05: no theme toggle surface', () => {
    // CSS scope: no .dark class / data-theme attribute may theme .sat-product.
    expect(css).not.toMatch(/\.sat-product[^{]*\.dark\b/);
    expect(css).not.toMatch(/data-theme|data-sat-theme/);
    // TSX scope (no JS theme state) is pinned by CI grep gate G2b:
    // grep -rn "matchMedia.*color-scheme\|localStorage.*theme\|useState.*[Tt]heme" src/products/sat
    // must print empty. Encoded here as documentation, not a filesystem glob.
  });

  it('DARK-06: forced-colors still wins after dark', () => {
    // (a) A forced-colors block sits after both dark blocks, so for every
    // token it maps it wins over dark by cascade order (plan §Step 10a).
    const lastForcedColors = css.lastIndexOf('@media (forced-colors: active)');
    expect(lastForcedColors).toBeGreaterThan(darkMediaStart);
    expect(lastForcedColors).toBeGreaterThan(darkMoreStart);
    // (b) The staff system map (pre-dark @media (forced-colors: active) block)
    // covers the staff tokens; (c) forced-color-adjust: auto lets the browser
    // force remaining surfaces in dark+forced-colors.
    expect(css).toContain('--sat-staff-surface: Canvas');
    expect(css).toContain('--sat-staff-accent: Highlight');
    expect(css).toMatch(/\.sat-product\s*\{[\s\S]*?forced-color-adjust:\s*auto/);
  });

  it('DARK-07: dark+contrast-more strengthens staff text/borders', () => {
    expect(darkMoreStart).toBeGreaterThan(darkMediaStart);
    expect(darkMoreRegion).toContain('--sat-staff-text-secondary: #f0f0f2');
    expect(darkMoreRegion).toContain('--sat-staff-border-input');
  });

  it('DARK-08: computed dark contrast floors', () => {
    const lum = (hex: string) => {
      const c = [1, 3, 5].map((i) => {
        const v = parseInt(hex.slice(i, i + 2), 16) / 255;
        return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
      });
      return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    };
    const ratio = (fg: string, bg: string) => {
      const [hi, lo] = [lum(fg), lum(bg)].sort((a, b) => b - a);
      return (hi + 0.05) / (lo + 0.05);
    };
    // [name, foreground, background, floor] — text ≥ 4.5, dots ≥ 3.0.
    const pairs: [string, string, string, number][] = [
      ['primary', '#f5f5f7', '#1c1c1e', 4.5],
      ['secondary', '#c7c7cc', '#1c1c1e', 4.5],
      ['tertiary', '#a1a1a6', '#1c1c1e', 4.5],
      ['info-text', '#8ac2ff', '#1c1c1e', 4.5],
      ['success-text', '#76e8b7', '#1c1c1e', 4.5],
      ['warning-text', '#ffd09a', '#1c1c1e', 4.5],
      ['danger-text', '#ff8f85', '#1c1c1e', 4.5],
      ['white-on-accent', '#ffffff', '#0a72d8', 4.5],
      ['neutral-dot', '#a1a1a6', '#1c1c1e', 3.0],
      ['warning-dot', '#ffbd70', '#1c1c1e', 3.0],
      ['success-dot', '#58d7a1', '#1c1c1e', 3.0],
    ];
    for (const [name, fg, bg, floor] of pairs) {
      expect(ratio(fg, bg), `${name} ${fg} on ${bg}`).toBeGreaterThanOrEqual(floor);
    }
  });
});
