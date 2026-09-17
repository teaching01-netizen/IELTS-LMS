import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * CSS is the interaction model's physical half: where surfaces anchor, how
 * selection reads, and what an unavailable control looks like. These pins keep
 * those decisions deliberate instead of drifting back to generic rich-text
 * chrome.
 */
const css = readFileSync("src/index.css", "utf8");

describe("rich editor surface contract", () => {
  it("positions contextual surfaces against the editor, not the window", () => {
    const editor = css.match(/\.sat-rich-editor \{([^}]*)\}/)?.[1] ?? "";
    expect(editor).toContain("position: relative;");
    expect(editor).toContain("z-index: 0;");
  });
  it("gives a contextual surface one material and a causal entrance", () => {
    const row = css.match(/\.sat-rich-editor__bubble-row \{([^}]*)\}/)?.[1] ?? "";
    expect(row).toContain("animation: sat-surface-in var(--authoring-motion-state) var(--authoring-ease);");
    expect(row).toContain("border: 1px solid var(--color-au-separator);");
    expect(css).toContain("@keyframes sat-surface-in {");
    // The plugin re-inserts the element on show, so one declaration covers
    // every appearance: nothing may hide the surface with display/visibility.
    expect(css).not.toContain(".sat-rich-editor__bubble-row { display: none; }");
  });
  it("states selection on the object itself with a stroke that cannot shift layout", () => {
    expect(css).toContain('.sat-rich-editor [data-image-selected="true"] img,');
    expect(css).toContain('.sat-rich-editor [data-equation-selected="true"] > .sat-rendered-math {');
    const outline =
      css.match(
        /\.sat-rich-editor \[data-image-selected="true"\] img,\n\.sat-rich-editor \[data-equation-selected="true"\] > \.sat-rendered-math \{([^}]*)\}/
      )?.[1] ?? "";
    expect(outline).toContain("outline: 1.5px solid rgba(0, 113, 227, 0.5);");
    expect(outline).not.toContain("border:");
  });
  it("keeps unavailable controls recognisable instead of almost invisible", () => {
    const disabled = css.match(/\.sat-rich-editor__toolbar-button:disabled \{([^}]*)\}/)?.[1] ?? "";
    expect(disabled).toContain("color: var(--color-gray-400);");
    expect(disabled).toContain("opacity: 0.5;");
  });
  it("puts the table strip under the shared row without drawing a second rule", () => {
    expect(css).toContain(".sat-rich-editor__toolbar:has(.sat-rich-editor__table-toolbar) {");
    const strip = css.match(/\.sat-rich-editor__table-toolbar \{([^}]*)\}/)?.[1] ?? "";
    expect(strip).toContain("border-top: 1px solid var(--color-au-separator);");
    // Menus and hover labels open downward out of the strip.
    expect(strip).toContain("overflow: visible;");
  });
  it("reads the style command as text, not as a form field", () => {
    const trigger = css.match(/\.sat-rich-editor__menu-trigger \{([^}]*)\}/)?.[1] ?? "";
    expect(trigger).toContain("background: transparent;");
    expect(trigger).toContain("border: 1px solid transparent;");
    expect(css).toContain(".sat-rich-editor__menu-trigger:hover {");
    expect(css).toContain('.sat-rich-editor__menu-trigger[aria-expanded="true"],');
    // The menu renders each style at the ramp the editor itself applies.
    expect(css).toContain(".sat-rich-editor__style-option--heading {");
    expect(css).toContain(".sat-rich-editor__style-option--subheading {");
  });
  it("holds undoable feedback longer than a plain acknowledgement", () => {
    const feedback = css.match(/\.sat-rich-editor__feedback \{([^}]*)\}/)?.[1] ?? "";
    expect(feedback).toContain("animation: sat-feedback-in var(--authoring-motion-state) var(--authoring-ease);");
    expect(css).toContain(".sat-rich-editor__feedback-undo {");
    expect(css).toContain("@keyframes sat-feedback-in {");
  });
  it("delays hover labels rather than showing them immediately", () => {
    const tooltip = css.match(/\.sat-tooltip \{([^}]*)\}/)?.[1] ?? "";
    expect(tooltip).toContain("z-index: 120;");
    expect(tooltip).toContain("animation: sat-tooltip-in var(--authoring-motion-fast) var(--authoring-ease-standard);");
    expect(css).toContain(".sat-tooltip__shortcut {");
  });
  it("collapses only the Insert word on narrow widths, never a meaning-bearing label", () => {
    const narrow = css.slice(css.indexOf("@media (max-width: 640px)"));
    expect(narrow).toContain(".sat-rich-editor__toolbar-label {");
    expect(narrow).not.toContain(".sat-rich-editor__toolbar-action {");
  });
  it("reaches the touch target floor on coarse pointers for every surface", () => {
    const coarse = css.slice(css.indexOf("@media (pointer: coarse)"));
    for (const selector of [
      ".sat-rich-editor__menu-trigger,",
      ".sat-rich-editor__toolbar-button,",
      ".sat-rich-editor__bubble-label,",
      ".sat-rich-editor__feedback button {",
    ]) {
      expect(coarse).toContain(selector);
    }
  });
  it("collapses the new motion under reduced-motion", () => {
    const reduced = css.slice(css.lastIndexOf("@media (prefers-reduced-motion: reduce)"));
    for (const selector of [
      ".sat-rich-editor__bubble-row,",
      ".sat-rich-editor__bubble-hint,",
      ".sat-rich-editor__feedback,",
      ".sat-tooltip {",
    ]) {
      expect(reduced).toContain(selector);
    }
  });
});
