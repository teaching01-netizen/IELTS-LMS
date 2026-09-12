import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync('src/features/exam-authoring/ui/spine/spine.css', 'utf8');
describe('authoring-local foundation', () => {
  it('pins measures without imposing a minimum canvas width', () => {
    for (const [token, value] of Object.entries({measure:840,'measure-compact':720,'measure-wide':920,'rail-width':392,'rail-min':340,'rail-max':460,'inspector-width':304})) {
      expect(css).toContain('--spine-' + token + ': ' + value + 'px;');
    }
    expect(css).toContain('max-width: clamp(var(--spine-measure-compact)');
    expect(css).toContain('width: calc(100% - 2rem)');
  });
  it('defines the six-level type scale only inside authoring', () => {
    const scope = css.slice(css.indexOf('.sat-spine {'), css.indexOf('}', css.indexOf('.sat-spine {')));
    for (const token of ['display','title','label','body','helper','meta']) expect(scope).toContain('--spine-text-' + token);
    expect(scope).toContain('--spine-space-16: 64px');
    expect(scope).toContain('--spine-radius-2xl: 16px');
  });
});
