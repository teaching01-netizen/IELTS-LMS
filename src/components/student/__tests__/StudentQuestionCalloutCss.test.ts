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

describe('student exam content selection CSS', () => {
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

  it('turns native selection and the platform callout off across the locked exam', () => {
    // The menu is attached to the selection, so the disable has to BE the
    // selection — scoped to the class `useStudentExamPageLock` only ever
    // applies while an exam is running.
    const disable = rules.find(
      (rule) => rule.selectors.replace(/\s+/g, ' ') === 'html.student-exam-active, html.student-exam-active *',
    );
    expect(disable).toBeDefined();
    expect(disable!.body).toContain('-webkit-user-select: none');
    expect(disable!.body).toMatch(/;\s*user-select: none/);
    expect(disable!.body).toContain('-webkit-touch-callout: none');

    // Every exam-scoped rule that hands text selection back to a prose root
    // must be an editable carve-out or the armed-highlight marker — never a
    // default. A reintroduced "unarmed roots stay selectable" rule fails here.
    const proseText = rules.filter(
      (rule) =>
        (rule.selectors.includes('.student-exam-active [data-sat-selection-protected="true"]')
          || rule.selectors.includes('.student-exam-active [data-student-highlightable="true"]'))
        && rule.body.includes('-webkit-user-select: text'),
    );
    expect(proseText.length).toBeGreaterThan(0);
    for (const rule of proseText) {
      expect(rule.selectors).toMatch(/input|textarea|select|\[contenteditable\]|data-student-owned-touch-selection/);
    }

    // Editable controls stay typable — and keep the edit menu they need for
    // selecting and fixing their own answer text.
    const editable = rules.find(
      (rule) => rule.selectors.includes('html.student-exam-active input') && rule.body.includes('-webkit-user-select: text'),
    );
    expect(editable).toBeDefined();
    expect(editable!.body).toContain('-webkit-touch-callout: default');
  });

  it('preserves the existing IELTS callout guard', () => {
    const highlightable = rulesWith(
      '.student-exam-active [data-student-highlightable="true"]',
      '-webkit-touch-callout: none',
    ).find((rule) => !rule.selectors.includes('data-student-selection-owner'));

    expect(highlightable).toBeDefined();
    expect(highlightable!.selectors).toContain('.student-exam-active [data-student-highlightable="true"] *');
  });

  it('suppresses the platform callout on SAT protected text whether or not annotation mode is armed', () => {
    // The long-press menu must not depend on `data-student-selection-owner`:
    // that marker only exists while Highlights & Notes is armed, and the iPad
    // regression was exactly the unarmed window — Safari handing back Look Up /
    // Copy / Translate over a passage the student was simply reading.
    const guard = rulesWith(
      '.student-exam-active [data-sat-selection-protected="true"]',
      '-webkit-touch-callout: none',
    ).find((rule) => !rule.selectors.includes('data-student-selection-owner'));

    expect(guard).toBeDefined();
    expect(guard!.selectors).toContain('.student-exam-active [data-sat-selection-protected="true"] *');
    expect(guard!.selectors.split(',').every((selector) => selector.trim().startsWith('.student-exam-active'))).toBe(true);
    expect(guard!.selectors).not.toMatch(/\b(?:input|textarea|select|button|contenteditable)\b/);
    // The guard removes the menu only. Selection policy belongs to the
    // exam-wide disable, so this rule must not re-declare either value.
    expect(guard!.body).not.toContain('user-select');
  });

  it('gives text selection back only while the highlight tool is armed', () => {
    const restore = rules.filter(
      (rule) =>
        rule.selectors.includes('[data-student-highlightable="true"][data-student-owned-touch-selection="true"]')
        && rule.body.includes('user-select: text'),
    );

    expect(restore).toHaveLength(1);
    expect(restore[0]!.selectors.replace(/\s+/g, ' ')).toBe(
      'html.student-exam-active [data-student-highlightable="true"][data-student-owned-touch-selection="true"],'
      + ' html.student-exam-active [data-student-highlightable="true"][data-student-owned-touch-selection="true"] *',
    );
    // The menu stays suppressed even while selection is available: the restore
    // touches user-select and nothing else.
    expect(restore[0]!.body).not.toContain('touch-callout');
    // SAT roots are owned by the owner rule, never by this marker.
    expect(restore[0]!.selectors).not.toContain('data-sat-selection-protected');
  });

  it('scopes the IELTS callout guard to an active exam and away from form controls', () => {
    const highlightable = rulesWith('.student-exam-active [data-student-highlightable="true"]', '-webkit-touch-callout: none')
      .find((rule) => !rule.selectors.includes('data-student-selection-owner'));
    expect(highlightable!.selectors.split(',').every((selector) => selector.trim().startsWith('.student-exam-active'))).toBe(true);
    expect(highlightable!.selectors).not.toMatch(/\b(?:input|textarea|select|button|contenteditable)\b/);
  });

  it('stops exam images and links from becoming drag sources', () => {
    expect(rulesWith('.student-exam-active img', '-webkit-user-drag: none')).toHaveLength(1);
    expect(rulesWith('.student-exam-active a', '-webkit-user-drag: none')).toHaveLength(1);
  });
});

/** The bodies of every `@media (<query>)` block, brace-counted. */
function mediaBlocks(css: string, query: string): string[] {
  const blocks: string[] = [];
  const marker = `@media ${query}`;
  let index = css.indexOf(marker);
  while (index !== -1) {
    const open = css.indexOf('{', index);
    let depth = 1;
    let cursor = open + 1;
    while (cursor < css.length && depth > 0) {
      if (css[cursor] === '{') depth += 1;
      else if (css[cursor] === '}') depth -= 1;
      cursor += 1;
    }
    blocks.push(css.slice(open + 1, cursor - 1));
    index = css.indexOf(marker, cursor);
  }
  return blocks;
}

describe('app-owned exam selection CSS', () => {
  // SAT ownership is declared by annotation mode, before input. These rules
  // must therefore be independent of pointer media queries; pointer type only
  // changes the gesture presentation.
  const css = readFileSync(resolve(__dirname, '../../../index.css'), 'utf8').replace(
    /\/\*[\s\S]*?\*\//g,
    '',
  );
  const coarseBlocks = mediaBlocks(css, '(pointer: coarse)');
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({
    selectors: (match[1] ?? '').trim(),
    body: (match[2] ?? '').trim(),
    index: match.index ?? 0,
  }));
  const ownerRules = rules.filter((rule) =>
    rule.selectors.includes('[data-sat-selection-protected="true"][data-student-selection-owner="app"]')
    && /user-select:\s*none/.test(rule.body),
  );

  it('removes native selection on explicitly owned SAT and IELTS roots', () => {
    expect(ownerRules).toHaveLength(1);
    expect(ownerRules[0]!.selectors).toContain('html.student-exam-active [data-sat-selection-protected="true"][data-student-selection-owner="app"]');
    expect(ownerRules[0]!.selectors).toContain('html.student-exam-active [data-sat-selection-protected="true"][data-student-selection-owner="app"] *');
    expect(ownerRules[0]!.selectors).toContain('html.student-exam-active [data-student-highlightable="true"][data-student-selection-owner="app"]');
    expect(ownerRules[0]!.selectors).toContain('html.student-exam-active [data-student-highlightable="true"][data-student-selection-owner="app"] *');
    expect(ownerRules[0]!.body).toContain('-webkit-user-select: none');
    expect(ownerRules[0]!.body).toMatch(/;\s*user-select: none/);
    expect(ownerRules[0]!.body).toContain('-webkit-touch-callout: none');
    expect(coarseBlocks.some((block) => block.includes('data-student-selection-owner="app"'))).toBe(false);
  });

  it('restores text selection inside editable descendants', () => {
    const editable = rules.find((rule) =>
      rule.selectors.includes('[data-sat-selection-protected="true"][data-student-selection-owner="app"] input')
      && /user-select:\s*text/.test(rule.body),
    );
    expect(editable).toBeDefined();
    expect(editable!.selectors).toContain('textarea');
    expect(editable!.selectors).toContain('select');
    expect(editable!.selectors).toContain('[contenteditable]:not([contenteditable="false"])');
    expect(editable!.body).toContain('-webkit-user-select: text');
    expect(editable!.body).toContain('-webkit-touch-callout: default');
  });

  it('wins on specificity and applies before pointer contact', () => {
    // The translation guard's rule (`.student-translation-guard-active
    // [data-student-highlightable="true"] { user-select: text }`) is applied to
    // `html` during the same session, and it used to TIE with this rule — a tie
    // decided by file order, and the losing side is an iPad showing Copy / Look
    // Up over the passage. `html.` makes this strictly more specific than
    // anything else scoped to these surfaces, which is the property that has to
    // hold rather than the position of a block in the sheet.
    const classAndAttribute = /^html\.student-exam-active\s+(?:\[data-sat-selection-protected="true"\]|\[data-student-highlightable="true"\])/;

    for (const selector of ownerRules[0]!.selectors.split(',').map((part) => part.trim()).filter(Boolean)) {
      expect(selector).toMatch(classAndAttribute);
    }
    expect(ownerRules[0]!.index).toBeGreaterThan(0);
    expect(coarseBlocks.some((block) => block.includes('[data-sat-selection-protected="true"]'))).toBe(false);
  });

  it('takes the drag away from the browser while the exam owns the selection', () => {
    // Removing the platform's selection is only half of it. `user-select: none`
    // stops the browser MAKING a selection; it does not stop it from reading the
    // first pixels of a drag as a pan and cancelling the touch, which threw away
    // the selection the exam had just built. `touch-action: none` is the only
    // declaration that settles that before the finger lands, and it is applied to
    // the marker the hook sets — so JS ownership and CSS ownership cannot
    // disagree about whether this gesture is the app's.
    const ownership = rules.filter((rule) =>
      rule.selectors.includes('[data-student-owned-touch-selection="true"]')
      && /touch-action:\s*none/.test(rule.body),
    );

    expect(ownership).toHaveLength(1);
    expect(ownership[0]!.selectors).toContain('html.student-exam-active');
    expect(coarseBlocks.some((block) => block.includes('[data-student-owned-touch-selection="true"]'))).toBe(false);
  });

  it('keeps native text selection on a highlightable surface unless its owner marker is set', () => {
    // The default is the stylesheet's own, un-scoped declaration: every surface
    // that is not a locked exam keeps the selection behavior it always had, and
    // no component has to carry an inline rule that could outrank the exam's.
    const base = rules.find((rule) => rule.selectors === '[data-student-highlightable="true"]');
    expect(base).toBeDefined();
    expect(base!.body).toContain('-webkit-user-select: text');
    expect(base!.body).toContain('user-select: text');
    expect(css.indexOf('@media (pointer: coarse)')).toBeGreaterThan(base!.index);
    expect(ownerRules[0]!.selectors).toContain('[data-student-highlightable="true"][data-student-selection-owner="app"]');
    expect(ownerRules[0]!.selectors).toContain('[data-sat-selection-protected="true"][data-student-selection-owner="app"]');
  });
});
