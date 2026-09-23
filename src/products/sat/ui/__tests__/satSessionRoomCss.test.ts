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
  it('uses roster, workspace, and inspector columns on large desktop', () => {
    const desktop = atRule('(min-width: 1440px)');
    expect(value(desktop, '.sat-room__body', 'grid-template-columns')).toBe(
      'minmax(260px, 290px) minmax(0, 1fr) minmax(320px, 370px)',
    );
    expect(value(desktop, '.sat-room__body', 'grid-template-areas')).toBe('"roster workspace inspector"');
    expect(value(desktop, '.sat-room__inspector-panel', 'padding')).toBe('20px 16px 32px');
  });

  it('uses a two-column tablet workspace with a viewport inspector dialog', () => {
    const tablet = atRule('(min-width: 1024px) and (max-width: 1439px)');
    expect(value(atRule('(min-width: 1024px)'), '.sat-room__body', 'grid-template-columns')).toBe(
      'minmax(260px, 290px) minmax(0, 1fr)',
    );
    expect(value(root, '.sat-room__inspector-dialog', 'position')).toBe('fixed');
    expect(value(root, '.sat-room__inspector-dialog', 'right')).toBe('0');
    expect(value(root, '.sat-room__inspector-dialog-overlay', 'position')).toBe('fixed');
    expect(value(root, '.sat-room__inspector-dialog-overlay', 'inset')).toBe('0');
    expect(declarations(rule(tablet, '.sat-room__inspector-panel')).some((item) => item.prop === 'padding')).toBe(true);
  });

  it('keeps the tablet inspector opaque while it slides into view', () => {
    expect(declarations(keyframe('sat-inspector-enter', 'from')).some((item) => item.prop === 'opacity')).toBe(false);
    expect(declarations(keyframe('sat-inspector-enter', 'to')).some((item) => item.prop === 'opacity')).toBe(false);
  });

  it('keeps desktop timeline scrolling in one workspace without a split pane', () => {
    const desktop = atRule('(min-width: 1024px)');
    expect(value(desktop, '.sat-room__workspace', 'overflow-y')).toBe('auto');
    expect(value(desktop, '.sat-room__body', 'grid-template-rows')).toBe('minmax(0, 1fr)');
    expect(rule(root, '.sat-room__workspace')).toBeDefined();
    expect(root.nodes.some((node) => node.type === 'rule' && node.selector === '.sat-run-sheet__table-scroll')).toBe(false);
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
});
