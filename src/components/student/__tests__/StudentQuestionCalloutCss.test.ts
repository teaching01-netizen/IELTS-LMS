import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('student question touch-callout CSS', () => {
  const css = readFileSync(resolve(__dirname, '../../../index.css'), 'utf8');

  it('suppresses the callout on marked question copy while preserving selection', () => {
    expect(css).toMatch(
      /\[data-student-question-callout-protected=["']true["']\],\s*\[data-student-question-callout-protected=["']true["']\] \*\s*\{[^}]*-webkit-touch-callout:\s*none[^}]*-webkit-user-select:\s*text[^}]*user-select:\s*text[^}]*\}/s,
    );
  });

  it('does not include answer controls in the protection selector', () => {
    const selector = css.match(
      /([^{}]*data-student-question-callout-protected[^{}]*)\{/,
    )?.[1] ?? '';

    expect(selector).not.toMatch(/input|textarea|select|button|contenteditable/);
  });
});

describe('student exam content callout guard CSS', () => {
  // Comments are stripped before the rules are read: this guard's own rationale
  // talks about inputs and selections, and prose is not a selector.
  const rules = [
    ...readFileSync(resolve(__dirname, '../../../index.css'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .matchAll(/([^{}]+)\{([^{}]*)\}/g),
  ].map(([, selectors = '', body = '']) => ({ selectors: selectors.trim(), body: body.trim() }));

  const rulesWith = (fragment: string, declaration: string) =>
    rules.filter(
      (rule) => rule.selectors.includes(fragment) && rule.body.includes(declaration),
    );

  it('suppresses the callout on SAT prose and on highlightable exam text, in one rule', () => {
    const prose = rulesWith('.student-exam-active .sat-exam-prose', '-webkit-touch-callout: none');
    const highlightable = rulesWith(
      '.student-exam-active [data-student-highlightable="true"]',
      '-webkit-touch-callout: none',
    );

    expect(prose).toHaveLength(1);
    expect(highlightable).toEqual(prose);
    expect(prose[0]!.selectors).toContain('.sat-exam-prose *');
    expect(prose[0]!.selectors).toContain('[data-student-highlightable="true"] *');
  });

  it('keeps text selection available, because the highlights are built on it', () => {
    const [guard] = rulesWith('.student-exam-active .sat-exam-prose', '-webkit-touch-callout: none');

    expect(guard!.body).toContain('-webkit-user-select: text');
    expect(guard!.body).toContain('user-select: text');
    // The one declaration that would delete the feature this guard protects.
    expect(guard!.body).not.toContain('user-select: none');
  });

  it('scopes the guard to an active exam, and away from form controls', () => {
    const [guard] = rulesWith('.student-exam-active .sat-exam-prose', '-webkit-touch-callout: none');
    const selectors = guard!.selectors.split(',').map((selector) => selector.trim());

    expect(selectors).toHaveLength(4);
    for (const selector of selectors) {
      expect(selector.startsWith('.student-exam-active')).toBe(true);
    }
    expect(guard!.selectors).not.toMatch(/input|textarea|select|button|contenteditable/);
  });

  it('stops exam images and links from becoming drag sources', () => {
    expect(rulesWith('.student-exam-active img', '-webkit-user-drag: none')).toHaveLength(1);
    expect(rulesWith('.student-exam-active a', '-webkit-user-drag: none')).toHaveLength(1);
  });
});
