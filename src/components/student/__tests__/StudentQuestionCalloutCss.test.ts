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

  it('suppresses the callout on SAT selection roots and highlightable exam text, in one rule', () => {
    const prose = rulesWith('.student-exam-active [data-sat-selection-protected="true"]', '-webkit-touch-callout: none');
    const highlightable = rulesWith(
      '.student-exam-active [data-student-highlightable="true"]',
      '-webkit-touch-callout: none',
    );

    expect(prose).toHaveLength(1);
    expect(highlightable).toEqual(prose);
    expect(prose[0]!.selectors).toContain('[data-sat-selection-protected="true"] *');
    expect(prose[0]!.selectors).toContain('[data-student-highlightable="true"] *');
  });

  it('keeps text selection available outside the coarse-pointer owned-selection rule', () => {
    const [guard] = rulesWith('.student-exam-active [data-sat-selection-protected="true"]', '-webkit-touch-callout: none');

    expect(guard!.body).toContain('-webkit-user-select: text');
    expect(guard!.body).toContain('user-select: text');
    // The one declaration that would delete the feature this guard protects.
    expect(guard!.body).not.toContain('user-select: none');
  });

  it('scopes the guard to an active exam, and away from form controls', () => {
    const [guard] = rulesWith('.student-exam-active [data-sat-selection-protected="true"]', '-webkit-touch-callout: none');
    const selectors = guard!.selectors.split(',').map((selector) => selector.trim());

    expect(selectors).toHaveLength(4);
    for (const selector of selectors) {
      expect(selector.startsWith('.student-exam-active')).toBe(true);
    }
    expect(guard!.selectors).not.toMatch(/\b(?:input|textarea|select|button|contenteditable)\b/);
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

describe('owned touch selection CSS', () => {
  // The selection itself is what iOS and Android attach their Copy / Look Up /
  // Share bar to, so on a coarse pointer the exam removes the platform's
  // selection and supplies its own (`useStudentSelectionGesture`). These
  // assertions pin the half that cannot be tested in jsdom: which devices get
  // it, which surfaces it covers, and what it must never touch.
  const css = readFileSync(resolve(__dirname, '../../../index.css'), 'utf8').replace(
    /\/\*[\s\S]*?\*\//g,
    '',
  );
  const coarseBlocks = mediaBlocks(css, '(pointer: coarse)');
  const owned = coarseBlocks.filter((block) => block.includes('[data-sat-selection-protected="true"]'));

  it('removes native selection from both exam content surfaces, and only there', () => {
    expect(owned).toHaveLength(1);
    expect(owned[0]).toContain('html.student-exam-active [data-sat-selection-protected="true"]');
    expect(owned[0]).toContain('html.student-exam-active [data-sat-selection-protected="true"] *');
    // IELTS passages and transcripts, whose capture path now takes an owned
    // range too. A selector here without a gesture behind it would delete
    // highlighting rather than protect it, so the pairing is asserted, not
    // assumed.
    expect(owned[0]).toContain('html.student-exam-active [data-student-highlightable="true"]');
    expect(owned[0]).toContain('html.student-exam-active [data-student-highlightable="true"] *');
    expect(owned[0]).toContain('-webkit-user-select: none');
    expect(owned[0]).toMatch(/;\s*user-select: none/);
  });

  it('reaches no answer control, and no surface without an owned gesture behind it', () => {
    // Selectors only: `user-select` is a declaration here, and reading the raw
    // block would match the word "select" inside it.
    const guarded = [...owned.join('\n').matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .map(([, selectors = '']) => selectors.trim())
      .join(',\n');

    expect(guarded).toContain('html.student-exam-active [data-sat-selection-protected="true"]');
    expect(guarded).toContain('data-student-highlightable');
    expect(guarded).not.toMatch(/\b(?:input|textarea|select|button|contenteditable)\b/);
    expect(guarded).not.toContain('student-exam-active img');
  });

  it('wins on specificity, so no other rule can put the platform selection back', () => {
    // The translation guard's rule (`.student-translation-guard-active
    // [data-student-highlightable="true"] { user-select: text }`) is applied to
    // `html` during the same session, and it used to TIE with this rule — a tie
    // decided by file order, and the losing side is an iPad showing Copy / Look
    // Up over the passage. `html.` makes this strictly more specific than
    // anything else scoped to these surfaces, which is the property that has to
    // hold rather than the position of a block in the sheet.
    const selectors = owned
      .join('\n')
      .matchAll(/([^{}]+)\{([^{}]*)\}/g);
    const classAndAttribute = /^html\.student-exam-active\s+(?:\[data-sat-selection-protected="true"\]|\[data-student-highlightable="true"\])/;

    for (const [, selectorText = ''] of selectors) {
      for (const selector of selectorText.split(',').map((part) => part.trim()).filter(Boolean)) {
        expect(selector).toMatch(classAndAttribute);
      }
    }
  });

  it('is scoped to the primary pointer, not to any touch-capable screen', () => {
    expect(css).not.toContain('any-pointer: coarse');
  });

  it('takes the drag away from the browser while the exam owns the selection', () => {
    // Removing the platform's selection is only half of it. `user-select: none`
    // stops the browser MAKING a selection; it does not stop it from reading the
    // first pixels of a drag as a pan and cancelling the touch, which threw away
    // the selection the exam had just built. `touch-action: none` is the only
    // declaration that settles that before the finger lands, and it is applied to
    // the marker the hook sets — so JS ownership and CSS ownership cannot
    // disagree about whether this gesture is the app's.
    const ownership = coarseBlocks.filter((block) =>
      block.includes('[data-student-owned-touch-selection="true"]'),
    );

    expect(ownership).toHaveLength(1);
    expect(ownership[0]).toContain('html.student-exam-active');
    expect(ownership[0]).toMatch(/touch-action:\s*none/);
  });

  it('never takes the drag away outside a coarse-pointer exam', () => {
    // The marker is the hook's to set, and the exam class is the stylesheet's to
    // insist on, so a marker left on a lobby or preview surface is inert. It also
    // has to outrank `.student-reading-passage-pane { touch-action: auto }`,
    // which is what the `html.student-exam-active` prefix does (0,2,1 against
    // 0,1,0) — a tie here would be decided by file order, exactly like the
    // selection rule.
    const depthAt = (index: number) => {
      let depth = 0;
      for (let cursor = 0; cursor < index; cursor += 1) {
        if (css[cursor] === '{') depth += 1;
        else if (css[cursor] === '}') depth -= 1;
      }
      return depth;
    };
    const owners = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .map((match) => ({
        selectors: (match[1] ?? '').trim(),
        body: (match[2] ?? '').trim(),
        index: match.index ?? 0,
      }))
      .filter(
        (rule) =>
          rule.selectors.includes('data-student-owned-touch-selection') &&
          /touch-action:\s*none/.test(rule.body),
      );

    expect(owners).toHaveLength(1);
    expect(owners[0]!.selectors.startsWith('html.student-exam-active')).toBe(true);
    expect(depthAt(owners[0]!.index)).toBeGreaterThan(0);
  });

  it('makes a highlightable surface selectable by default, and removes it only on a coarse pointer', () => {
    const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({
      selectors: (match[1] ?? '').trim(),
      body: (match[2] ?? '').trim(),
      index: match.index ?? 0,
    }));

    // The default is the stylesheet's own, un-scoped declaration: every surface
    // that is not a locked exam keeps the selection behavior it always had, and
    // no component has to carry an inline rule that could outrank the exam's.
    const base = rules.find((rule) => rule.selectors === '[data-student-highlightable="true"]');
    expect(base).toBeDefined();
    expect(base!.body).toContain('-webkit-user-select: text');
    expect(base!.body).toContain('user-select: text');
    expect(css.indexOf('@media (pointer: coarse)')).toBeGreaterThan(base!.index);

    // Exam content may lose that selection ONLY inside the coarse-pointer block,
    // which is what keeps a desktop exam, authoring, and previews selectable.
    // Depth is brace-counted: a rule nested inside the media block is within it,
    // and a rule at depth zero is not.
    const depthAt = (index: number) => {
      let depth = 0;
      for (let cursor = 0; cursor < index; cursor += 1) {
        if (css[cursor] === '{') depth += 1;
        else if (css[cursor] === '}') depth -= 1;
      }
      return depth;
    };
    const removers = rules.filter(
      (rule) =>
        /data-student-highlightable|data-sat-selection-protected/.test(rule.selectors) &&
        /user-select:\s*none/.test(rule.body),
    );

    expect(removers.length).toBeGreaterThan(0);
    for (const rule of removers) {
      expect(rule.selectors).toContain('student-exam-active');
      expect(depthAt(rule.index)).toBeGreaterThan(0);
    }
  });
});
