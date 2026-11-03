import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import postcss, { type AtRule, type Container, type Declaration, type Rule } from 'postcss';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(__dirname, '../sat-session-room.css'), 'utf8');
const root = postcss.parse(css);

function atRule(params: string): AtRule {
  const found = root.nodes.find((node): node is AtRule => node.type === 'atrule' && node.name === 'media' && node.params === params);
  if (!found) throw new Error(`Missing @media ${params}`);
  return found;
}

function rule(container: Container, selector: string): Rule {
  let found: Rule | undefined;
  container.walkRules((candidate) => {
    if (candidate.selectors.some((item) => item.trim() === selector)) found ??= candidate;
  });
  if (!found) throw new Error(`Missing CSS rule ${selector}`);
  return found;
}

function declarations(node: Container): Declaration[] {
  const found: Declaration[] = [];
  node.walkDecls((declaration) => found.push(declaration));
  return found;
}

function value(container: Container, selector: string, property: string): string | undefined {
  return declarations(rule(container, selector)).find((declaration) => declaration.prop === property)?.value;
}

function declaration(container: Container, selector: string, property: string): Declaration | undefined {
  return declarations(rule(container, selector)).find((candidate) => candidate.prop === property);
}

function keyframe(name: string, selector: string): Rule {
  const frames = root.nodes.find(
    (node): node is AtRule => node.type === 'atrule' && node.name === 'keyframes' && node.params === name,
  );
  if (!frames) throw new Error(`Missing @keyframes ${name}`);
  return rule(frames, selector);
}

describe('session room layout contracts', () => {
  it('keeps the tablet inspector opaque while it slides into view', () => {
    expect(declarations(keyframe('sat-inspector-enter', 'from')).some((item) => item.prop === 'opacity')).toBe(false);
    expect(declarations(keyframe('sat-inspector-enter', 'to')).some((item) => item.prop === 'opacity')).toBe(false);
  });

  it('keeps student details in place when the selected student changes', () => {
    for (const frame of ['from', 'to']) {
      expect(declarations(keyframe('sat-student-detail-enter', frame)).some((item) => item.prop === 'transform')).toBe(false);
    }
  });

  it('respects reduced motion and distinguishes state in forced colors', () => {
    const reducedMotion = atRule('(prefers-reduced-motion: reduce)');
    expect(declaration(reducedMotion, '.sat-room__inspector-panel', 'animation')).toMatchObject({ value: 'none', important: true });
    expect(declaration(reducedMotion, '.sat-room__student-detail', 'animation')).toMatchObject({ value: 'none', important: true });

    const forcedColors = atRule('(forced-colors: active)');
    expect(value(forcedColors, '.sat-room__row[aria-selected="true"]', 'border')).toBe('2px solid Highlight');
    expect(value(forcedColors, '.sat-run-sheet__row.is-current', 'outline')).toBe('2px solid Highlight');
  });

  it('lets narrow rows wrap without forcing a horizontal run-sheet scroller', () => {
    expect(value(root, '.sat-run-sheet__row-main', 'grid-template-columns')).toBe('minmax(0, 1fr) auto');
    expect(declarations(root).some((declaration) => declaration.prop === 'min-width' && declaration.value === '610px')).toBe(false);
  });

  it('fades score updates with opacity only and honors reduced motion', () => {
    for (const frame of ['from', 'to']) {
      const props = declarations(keyframe('sat-room-score-fade', frame)).map((item) => item.prop);
      expect(props).toContain('opacity');
      expect(props).not.toContain('transform');
    }
    expect(value(root, '.sat-room__score-fade', 'animation')).toContain('sat-room-score-fade');
    const reducedMotion = atRule('(prefers-reduced-motion: reduce)');
    expect(declaration(reducedMotion, '.sat-room__score-fade', 'animation')).toMatchObject({ value: 'none', important: true });
  });

  it('holds a static-geometry skeleton for the score slot', () => {
    expect(value(root, '.sat-room__row-score-skeleton', 'display')).toBe('block');
    expect(value(root, '.sat-room__row-score-skeleton', 'height')).toBe('12px');
    expect(value(root, '.sat-room__row-score-skeleton', 'width')).toBe('7.5rem');
    const forcedColors = atRule('(forced-colors: active)');
    expect(value(forcedColors, '.sat-room__row-score-skeleton', 'background')).toBe('GrayText');
  });
});
