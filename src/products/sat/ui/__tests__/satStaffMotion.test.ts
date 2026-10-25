import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import postcss, { type AtRule } from 'postcss';
import { describe, expect, it } from 'vitest';

const root = postcss.parse(readFileSync(resolve(__dirname, '../../../../index.css'), 'utf8'));
const surfaces = ['.authoring-dialog-content', '.authoring-confirm-dialog', '.authoring-dialog-overlay', '[data-slot="sheet-content"]', '[data-slot="sheet-overlay"]', '[data-slot="dropdown-menu-content"]', '[data-slot="dropdown-menu-sub-content"]', '[data-slot="popover-content"]', '[data-slot="tooltip-content"]'];

describe('SAT staff motion across detached surfaces', () => {
  it.each(surfaces)('provides an actual reduced-motion override for %s', (surface) => {
    let covered = false;
    root.walkAtRules('media', (media) => {
      if (media.params !== '(prefers-reduced-motion: reduce)') return;
      media.walkRules((rule) => {
        if (!rule.selector.includes('.sat-staff-root:is(') || !rule.selector.includes(surface)) return;
        rule.walkDecls('animation', (declaration) => {
          if (declaration.value === 'none' && declaration.important) covered = true;
        });
      });
    });
    expect(covered).toBe(true);
  });

  it('uses opacity-only keyframes for all staff surface entrances and exits', () => {
    for (const name of ['sat-dialog-enter', 'sat-backdrop-enter', 'sat-route-enter', 'sat-fade-out', 'sat-staff-loading', 'sat-workspace-in']) {
      const frames = root.nodes.find((node): node is AtRule => node.type === 'atrule' && node.name === 'keyframes' && node.params === name);
      expect(frames, name).toBeDefined();
      frames?.walkDecls((declaration) => expect(declaration.prop, name).toBe('opacity'));
    }
  });

  it('does not restart a live entrance after the native snapshot finishes', () => {
    let disabled = false;
    root.walkAtRules('supports', (supports) => {
      if (!supports.params.includes('view-transition-name: sat-workspace')) return;
      supports.walkRules('.sat-product .sat-workspace-enter', (rule) => {
        rule.walkDecls('animation', (decl) => { if (decl.value === 'none') disabled = true; });
      });
    });
    expect(disabled).toBe(true);
  });

  it('removes native and fallback navigation animation under reduced motion', () => {
    for (const selector of ['.sat-workspace-enter', '::view-transition-new(sat-workspace)']) {
      let instant = false;
      root.walkAtRules('media', (media) => {
        if (!media.params.includes('prefers-reduced-motion: reduce')) return;
        media.walkRules((rule) => {
          if (!rule.selector.includes(selector)) return;
          rule.walkDecls('animation', (decl) => { if (decl.value === 'none' && decl.important) instant = true; });
        });
      });
      expect(instant, selector).toBe(true);
    }
  });

  it('gives detached sheets and popovers real surface and scrim colors', () => {
    const backgrounds: Array<{ selector: string; value: string }> = [];
    root.walkRules((rule) => {
      if (!rule.selector.startsWith('.sat-staff-root')) return;
      rule.walkDecls('background', (declaration) => backgrounds.push({ selector: rule.selector, value: declaration.value }));
    });
    expect(backgrounds.some(({ selector, value }) => selector.includes('[data-slot="sheet-content"]') && value === 'var(--sat-staff-surface)')).toBe(true);
    expect(backgrounds.some(({ selector, value }) => selector.includes('[data-slot="sheet-overlay"]') && value === 'var(--sat-staff-scrim)')).toBe(true);
    expect(backgrounds.some(({ selector, value }) => selector.includes('[data-slot="popover-content"]') && value === 'var(--sat-staff-surface)')).toBe(true);
  });
});
