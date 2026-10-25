import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * AT-01/02/04/22/25 — the SAT staff press vocabulary is a contract, not a
 * suggestion. Press feedback is the one interaction signal staff feel on every
 * click, so it must be: instant on press-in, animated on release, scaled by
 * tokens (one scale per surface size), present for the round icon grammar, and
 * removed — never merely shortened — under reduced motion.
 *
 * These assertions read the stylesheet because jsdom cannot compute :active.
 */
const CSS = readFileSync(resolve(__dirname, '../../../../index.css'), 'utf8');

function escape(selector: string): string {
  return selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Every rule body for a selector (a selector may be declared more than once,
 * e.g. a press rule and its reduced-motion counterpart). */
function rules(selector: string): string[] {
  return [...CSS.matchAll(new RegExp(`${escape(selector)}\\s*\\{([^}]*)\\}`, 'g'))].map((match) => match[1] ?? '');
}

function rule(selector: string): string {
  return rules(selector)[0] ?? '';
}

/** Text of every `@media (prefers-reduced-motion: reduce)` block, so a guard is
 * found wherever it lives in the stylesheet. */
function reducedMotionCss(): string {
  const query = '@media (prefers-reduced-motion: reduce)';
  const blocks: string[] = [];
  let index = CSS.indexOf(query);
  while (index !== -1) {
    const next = CSS.indexOf('@media', index + query.length);
    blocks.push(CSS.slice(index, next === -1 ? undefined : next));
    index = CSS.indexOf(query, index + query.length);
  }
  return blocks.join('\n');
}

const REDUCED_MOTION = reducedMotionCss();

describe('SAT press vocabulary (sat-press)', () => {
  it('AT-02: scales come from tokens — one for controls, one for large surfaces', () => {
    expect(CSS).toMatch(/--sat-staff-press-scale:\s*0\.97/);
    expect(CSS).toMatch(/--sat-staff-press-scale-row:\s*1\s*;/);

    const control = rule('.sat-product .sat-press');
    expect(control).toContain('--sat-staff-press-scale');

    const row = rule('.sat-product .sat-press-row');
    expect(row).toContain('--sat-staff-press-scale-row');
  });

  it('AT-01: press-in is instant and reads the press scale token', () => {
    const pressed = rule(
      '.sat-product :is(.sat-press, .sat-press-row):active:not(:disabled):not([aria-disabled="true"])',
    );
    expect(pressed).toContain('transition-duration: 0ms');
    expect(pressed).toMatch(/transform:\s*scale\(var\(--sat-staff-press-scale/);
  });

  it('AT-03: release settles over the shared press duration and ease', () => {
    const base = rule('.sat-product :is(.sat-press, .sat-press-row)');
    expect(base).toMatch(/transform var\(--sat-staff-motion-press\) var\(--sat-staff-ease-press\)/);
    // No bounce vocabulary: routine controls never overshoot.
    expect(CSS).not.toMatch(/sat-press[^{]*\{[^}]*cubic-bezier\([^)]*1\.[1-9]/);
  });

  it('AT-01: pressed fills reuse existing fill/active families, no new hue', () => {
    expect(rule('.sat-product .sat-press-fill:active:not(:disabled):not([aria-disabled="true"])'))
      .toContain('--sat-staff-fill-active');
    expect(rule('.sat-product .sat-press-fill-accent:active:not(:disabled):not([aria-disabled="true"])'))
      .toContain('--sat-staff-accent-active');
  });

  it('AT-22: the round authoring icon grammar presses too', () => {
    const pressed = rules('.authoring-icon-button:active:not(:disabled)');
    expect(pressed.length).toBeGreaterThan(0);
    expect(pressed.some((body) => /transform:\s*scale\(0\.9[0-9]\)/.test(body))).toBe(true);
    expect(pressed.some((body) => body.includes('transition-duration: 0ms'))).toBe(true);
  });

  it('AT-23: menu items acknowledge the choose while the popup closes', () => {
    expect(rule('.sat-menu-item:active:not(:disabled)')).toContain('--sat-staff-fill-active');
  });

  it('AT-04: reduced motion removes the transform, not the state', () => {
    const reduced = REDUCED_MOTION;
    expect(reduced).toContain('.sat-product .sat-press');
    expect(reduced).toContain('.sat-product .sat-press-row');
    expect(reduced).toMatch(
      /:is\(\.sat-press, \.sat-press-row\):active:not\(:disabled\)\s*\{\s*transform:\s*none\s*!important/,
    );
    expect(reduced).toMatch(/\.authoring-icon-button:active:not\(:disabled\)\s*\{\s*transform:\s*none\s*!important/);
  });

  it('AT-25: pressable rows keep the tap delay away without losing pan/zoom', () => {
    expect(rule('.sat-product .sat-list-row')).toContain('touch-action: manipulation');
    expect(rule('.sat-product .sat-press-row')).toContain('touch-action: manipulation');
  });

  it('AT-05: a selected row keeps its tint while hovered', () => {
    const selectedHover = rule('.sat-product .sat-list-row[aria-current="true"]:hover');
    expect(selectedHover).toContain('--sat-staff-accent-tint');
  });

  it('AT-14: tab panels fade in without translating or changing height', () => {
    const panel = rule('.sat-product .sat-panel-enter');
    expect(panel).toContain('var(--sat-staff-motion-banner)');
    expect(panel).not.toContain('translate');
  });

  it('AT-18/AT-14: the sliding thumbs are one shared element per peer group', () => {
    expect(CSS).toContain('.sat-product .sat-selection-thumb');
    expect(CSS).toContain('.sat-product .sat-tab-indicator');
    const thumb = rule('.sat-product .sat-selection-thumb');
    expect(thumb).toContain('position: absolute');
    expect(thumb).toContain('border-radius: inherit');
  });

  it('AT-02/26: entrances use shared durations without cascading delays', () => {
    const rowEnter = rule('.sat-product .sat-row-enter');
    expect(rowEnter).toContain('var(--sat-staff-motion-row)');
    expect(rowEnter).not.toContain('animation-delay');
    expect(rule('.sat-product .sat-banner-enter')).toContain('var(--sat-staff-motion-banner)');
    expect(rule('.sat-product .sat-route-enter')).toContain('var(--sat-staff-motion-row)');
  });

  it('keeps large rows still while acknowledging a press through fill', () => {
    const pressed = rule('.sat-product .sat-list-row:active:not(:disabled)');
    expect(pressed).not.toContain('transform:');
    expect(pressed).toContain('--sat-staff-fill-active');
    expect(CSS).not.toMatch(/\.sat-(?:list-row|press[^{]*):active[^{]*\{[^}]*translate/);
  });

  it('removes spatial motion from list, editor card, success and dialog entrances', () => {
    for (const name of ['sat-row-enter', 'sat-card-in', 'sat-pop', 'sat-dialog-enter']) {
      const frames = CSS.match(new RegExp(`@keyframes ${name}\\s*\\{([\\s\\S]*?)\\n\\}`))?.[1];
      expect(frames, name).toBeDefined();
      expect(frames, name).not.toMatch(/transform|translate|scale/);
    }
  });

  it('reduces motion on detached dialogs, menus, and tab panels as well as rows', () => {
    for (const selector of ['.sat-dialog-center.sat-product', '.sat-dialog-overlay.sat-product', '.sat-menu[data-sat-menu-animate]', '.sat-product .sat-panel-enter']) {
      expect(REDUCED_MOTION).toContain(selector);
    }
  });
});
