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

  it('LIGHT-01: the application is pinned to the light color scheme', () => {
    expect(css).toMatch(/:root\s*\{[\s\S]*?color-scheme:\s*light/);
    expect(css).not.toContain('@media (prefers-color-scheme: dark)');
    expect(css).not.toContain('color-scheme: dark');
  });

  it('LIGHT-02: SAT surfaces keep their light material tokens', () => {
    expect(css).toMatch(/\.sat-ui\s*\{[\s\S]*?color-scheme:\s*light/);
    expect(css).toContain('--sat-staff-surface-solid-fallback: #ffffff');
    expect(css).toContain('--sat-staff-glass-sidebar: rgba(255, 255, 255, 0.82)');
  });

  it('LIGHT-03: accessibility color overrides remain available', () => {
    expect(css).toContain('@media (prefers-contrast: more)');
    expect(css).toContain('@media (forced-colors: active)');
    expect(css).toContain('--sat-staff-surface: Canvas');
    expect(css).toContain('--sat-staff-accent: Highlight');
    expect(css).toMatch(/\.sat-product\s*\{[\s\S]*?forced-color-adjust:\s*auto/);
  });
});
