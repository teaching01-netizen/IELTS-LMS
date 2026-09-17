import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync('src/features/exam-authoring/ui/spine/spine.css', 'utf8');
describe('authoring-local foundation', () => {
  it('pins measures without imposing a minimum canvas width', () => {
    for (const [token, value] of Object.entries({measure:1180,'measure-compact':720,'measure-wide':920,'measure-prose':760,'rail-width':340,'rail-min':288,'rail-max':420,'inspector-width':304})) {
      expect(css).toContain('--spine-' + token + ': ' + value + 'px;');
    }
    expect(css).toContain('--spine-document: 840px;');
  });
  it('optically centres the document in a three-track grid', () => {
    // Left gutter flexes from 32px; the right track is deliberately larger so
    // the document sits right of mathematical centre, and the footer inks from
    // the same axis.
    expect(css).toContain('--spine-grid: minmax(var(--spine-gutter-min), 1fr) minmax(0, var(--spine-document)) minmax(48px, 1.22fr);');
    expect(css).toContain('.sat-spine__column {\n  display: grid;\n  grid-template-columns: var(--spine-grid);');
    expect(css).toContain('.sat-spine__column > * {\n  grid-column: 2;\n  min-width: 0;\n}');
    expect(css).toContain('.sat-spine__save-footer {\n  position: sticky;\n  bottom: 0;');
    expect(css).not.toContain('margin-inline: calc(var(--spine-space-12) * -1)');
  });
  it('caps prose below the document measure', () => {
    expect(css).toContain('.sat-spine__prose {\n  max-width: 760px;\n}');
  });
  it('defines the six-level type scale only inside authoring', () => {
    const scope = css.slice(css.indexOf('.sat-spine {'), css.indexOf('}', css.indexOf('.sat-spine {')));
    for (const token of ['display','title','label','body','helper','meta']) expect(scope).toContain('--spine-text-' + token);
    expect(scope).toContain('--spine-space-16: 64px');
    expect(scope).toContain('--spine-radius-2xl: 16px');
  });
  it('keeps exam content above the UI chrome scale', () => {
    const scope = css.slice(css.indexOf('.sat-spine {'), css.indexOf('}', css.indexOf('.sat-spine {')));
    const value = (token: string) => Number(scope.match(new RegExp('--spine-text-' + token + ': ([\\d.]+)rem'))?.[1] ?? '0');
    expect(value('body')).toBeGreaterThan(value('label'));
    expect(value('label')).toBeGreaterThan(value('meta'));
    expect(value('body')).toBeGreaterThanOrEqual(1.0625);
  });
  it('never boxes the workspace column', () => {
    // The column is the surface; only overlays and summaries elevate.
    const column = css.slice(css.indexOf('.sat-spine__column {'), css.indexOf('}', css.indexOf('.sat-spine__column {')));
    expect(column).not.toContain('box-shadow');
    expect(column).not.toContain('border-radius');
    // Depth comes from one light source over a cool canvas: a top wash, a
    // cool ambient tint, and a ground gradient — with the white rail and white
    // editing surfaces layered on top.
    expect(css).toContain('.sat-spine__main {\n  background:\n    radial-gradient(900px 520px at 52% -40px,');
    expect(css).toContain('    linear-gradient(180deg, #f8fafc 0%, #f4f7fa 52%, #f1f4f8 100%);\n  border-left: 1px solid var(--color-border);\n}');
  });
  it('models light consistently: top-edge highlight, downward-only shadow', () => {
    // A lit top edge on the editing surface, and no shadow that travels up.
    const editor = css.match(/\.sat-spine \.sat-rich-editor \{([^}]*)\}/)?.[1] ?? '';
    expect(editor).toContain('inset 0 1px 0 rgba(255, 255, 255, 0.95)');
    expect(editor).toContain('0 8px 30px rgba(20, 40, 70, 0.018)');
    // Shadows travel down; only an inset shade may sit on the bottom edge.
    expect(editor).not.toContain(' 0 -8px');
    expect(editor).not.toContain(' 0 -12px');
  });
  it('raises the focused field into the light instead of only recolouring it', () => {
    const focused = css.match(/\.sat-spine \.sat-rich-editor:focus-within \{([^}]*)\}/)?.[1] ?? '';
    expect(focused).toContain('0 0 0 3px rgba(0, 113, 227, 0.055)');
    expect(focused).toContain('0 10px 34px rgba(25, 65, 120, 0.055)');
    expect(focused).toContain('inset 0 1px 0 rgba(255, 255, 255, 1)');
  });
  it('keeps the primary-action gloss clear of the label', () => {
    // The gloss is clipped to the top of the control (38%), never over the
    // x-height of the text, and it is disabled along with the button.
    const gloss = css.match(/\.sat-spine \.spine-next::before \{([^}]*)\}/)?.[1] ?? '';
    expect(gloss).toContain('height: 38%');
    expect(gloss).toContain('inset: 1px 10% auto');
    expect(css).toContain('.sat-spine .spine-next:disabled::before {\n  background: none;\n}');
  });
  it('makes every answer a normal white editing surface, without nesting boxes', () => {
    // Answers use the same material as the question and explanation fields.
    const row = css.match(/\.answer-choice \{([^}]*)\}/)?.[1] ?? '';
    expect(row).toContain('background: linear-gradient(180deg, #ffffff 0%, #fefeff 100%);');
    expect(row).toContain('border: 1px solid rgba(26, 34, 46, 0.075);');
    expect(row).not.toContain('background: transparent');
    // The editor inside the row removes its own box so nothing nests.
    const inner = css.match(/\.answer-choice \.sat-rich-editor \{([^}]*)\}/)?.[1] ?? '';
    expect(inner).toContain('border: 0;');
    expect(inner).toContain('background: transparent;');
    expect(inner).toContain('box-shadow: none;');
  });
  it('gives every rich editor the same gradient tool strip, answers included', () => {
    // The shared contract owns the band, the hairline, and the strip height.
    const shared = css.match(/\.sat-spine \.sat-rich-editor__toolbar \{([^}]*)\}/)?.[1] ?? '';
    expect(shared).toContain('background: linear-gradient(180deg, rgba(255, 255, 255, 0.98), rgba(248, 250, 253, 0.94));');
    expect(shared).toContain('border-bottom-color: rgba(25, 35, 48, 0.055);');
    const strip = css.match(/\.sat-spine \.answer-choice \.sat-rich-editor__toolbar \{([^}]*)\}/)?.[1] ?? '';
    expect(strip).toContain('opacity: 1;');
    expect(strip).not.toContain('background: transparent;');
    expect(strip).not.toContain('border-bottom-color: transparent;');
    // The strip must span the choice edge to edge: it reaches past the letter
    // column and the key slot, then pads those tracks back so the controls do
    // not move.
    expect(strip).toContain('margin-inline: -64px -144px;');
    expect(strip).toContain('padding-inline: 64px 144px;');
    // No answer-scoped row override may cap the strip below the shared height.
    expect(css).not.toContain('.sat-spine .answer-choice .sat-rich-editor__toolbar-row');
  });
  it('keeps the rest-state hairline nearly invisible', () => {
    // Border is discovered on interaction, not constantly announced.
    expect(css).toContain('--color-border: rgba(24, 32, 42, 0.065);');
    expect(css).toContain('--color-border-strong: rgba(24, 32, 42, 0.105);');
  });
  it('reserves scroll room under the document for the sticky action bar', () => {
    expect(css).toContain('padding-bottom: calc(112px + env(safe-area-inset-bottom, 0px));');
  });
  it('gives accents a direction instead of a flat fill', () => {
    expect(css).toContain('linear-gradient(90deg, #1590ff, #0071e3)');
    expect(css).toContain('linear-gradient(180deg, #1684ed 0%, #0877e4 46%, #006bd8 100%)');
  });
  it('never fades a toolbar out entirely', () => {
    // Toolbars stay present at all times; they recede by contrast only, in
    // three steps: rest, under the pointer, and focused.
    const toolbar = css.match(/\.sat-spine \.sat-rich-editor__toolbar \{([^}]*)\}/)?.[1] ?? '';
    expect(toolbar).toContain('opacity: 0.65');
    expect(toolbar).not.toContain('opacity: 0;');
    expect(css).toContain('.sat-spine .sat-rich-editor:hover .sat-rich-editor__toolbar {\n  opacity: 0.82;\n}');
    expect(css).toContain('.sat-spine .sat-rich-editor:focus-within .sat-rich-editor__toolbar {\n  opacity: 1;\n}');
  });
  it('hands the accent to whichever surface has focus, so only one cue shows', () => {
    // The field's own focus treatment is pinned above; these rules only step it
    // aside while the author is driving a control surface instead of the text.
    expect(css).toContain('.sat-spine .sat-rich-editor:has(.sat-rich-editor__toolbar:focus-within),');
    expect(css).toContain('.sat-spine .sat-rich-editor:has(.sat-rich-editor__bubble:focus-within) {');
    expect(css).not.toContain('.sat-spine .sat-rich-editor:focus-within,');
  });
  it('keeps keyboard focus visible inside the editor without a second accent ring', () => {
    expect(css).toContain('.sat-spine .sat-rich-editor__toolbar-button:focus-visible,');
    expect(css).toContain('.sat-spine .sat-rich-editor__menu-trigger:focus-visible,');
    expect(css).toContain('.sat-spine .sat-rich-editor__bubble-label:focus-visible,');
    const rule = css.match(/\.sat-spine \.sat-rich-editor__toolbar-button:focus-visible,[\s\S]*?\{([^}]*)\}/)?.[1] ?? '';
    expect(rule).toContain('outline: none;');
    expect(rule).toContain('box-shadow: inset 0 0 0 1px var(--color-au-separator-strong);');
  });
  it('sizes editor menu triggers on the control row, not as standalone menus', () => {
    const rule = css.match(/\.sat-spine \.sat-rich-editor__toolbar \.sat-spine__menu button,\n\.sat-spine \.sat-rich-editor__bubble \.sat-spine__menu button \{([^}]*)\}/)?.[1] ?? '';
    expect(rule).toContain('min-width: 0;');
    expect(rule).toContain('min-height: 30px;');
  });
  it('lets a table strip reach the answer row edges like the shared strip', () => {
    const strip = css.match(/\.sat-spine \.answer-choice \.sat-rich-editor__table-toolbar \{([^}]*)\}/)?.[1] ?? '';
    expect(strip).toContain('margin-inline: -64px -144px;');
    expect(strip).toContain('padding-inline: 64px 144px;');
    expect(strip).not.toContain('background: transparent;');
  });
  it('gives validation a quiet text treatment instead of a banner', () => {
    const rule = css.match(/\.sat-spine__field-error \{([^}]*)\}/)?.[1] ?? '';
    expect(rule).toContain('padding: 0;');
    expect(rule).not.toContain('background:');
    expect(css).not.toContain('--color-destructive) 7%');
  });
});
