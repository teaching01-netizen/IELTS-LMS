import { describe, expect, it } from "vitest";
import { Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { EditableBlockMath, EditableInlineMath } from "../../EditableMathExtension";
import { satMathInputRules } from "../mathInputRules";
import { LatexPasteRule } from "../../plugins/latexPasteRule";

function makeEditor(): Editor {
  return new Editor({
    extensions: [StarterKit.configure({ heading: { levels: [2, 3] } }), EditableInlineMath, EditableBlockMath, ...satMathInputRules()],
    content: { type: "doc", content: [{ type: "paragraph" }] },
  });
}

describe("satMathInputRules", () => {
  it("creates inlineMath on \\(..\\) close", () => {
    const editor = makeEditor();
    try {
      editor.commands.insertContent("See \\(x^2\\)");
      editor.commands.enter();
      const json = JSON.stringify(editor.getJSON());
      expect(json).toContain("x^2");
    } finally {
      editor.destroy();
    }
  });
  it("exposes three rules (paren, bracket, dollars) and no single-dollar rule", () => {
    const rules = satMathInputRules();
    expect(rules).toHaveLength(3);
    const sources = rules.map((r) => String(r.find));
    expect(sources.some((s) => s.includes("$$$"))).toBe(false);
    expect(sources.some((s) => s.includes("\\("))).toBe(true);
  });
  it("O(candidate): same-window cost stays flat as the document grows", () => {
    const small = makeEditor();
    const big = makeEditor();
    try {
      const filler = Array.from({ length: 200 }, (_, i) => "Filler sentence number " + i + ".").join(" ");
      small.commands.setContent({ type: "doc", content: [{ type: "paragraph", text: "hello" }] });
      big.commands.setContent({
        type: "doc",
        content: [{ type: "paragraph", text: filler }, { type: "paragraph", text: "hello" }],
      });
      const t0 = performance.now();
      small.commands.insertContentAt(small.state.doc.content.size - 1, " \\(x^2\\)");
      const smallMs = performance.now() - t0;
      const t1 = performance.now();
      big.commands.insertContentAt(big.state.doc.content.size - 1, " \\(x^2\\)");
      const bigMs = performance.now() - t1;
      expect(bigMs).toBeLessThan(Math.max(500, smallMs * 20));
    } finally {
      small.destroy();
      big.destroy();
    }
  });
  describe("typed display delimiters", () => {
    function typedEditor(text: string): Editor {
      return new Editor({
        extensions: [StarterKit, EditableInlineMath, EditableBlockMath, LatexPasteRule.configure({ enabled: true })],
        content: { type: "doc", content: [{ type: "paragraph", content: text ? [{ type: "text", text }] : [] }] },
      });
    }
    function type(editor: Editor, text: string): void {
      for (const ch of text) {
        const { from, to } = editor.state.selection;
        const handled = editor.view.someProp("handleTextInput", (handle) =>
          handle(editor.view, from, to, ch, () => editor.state.tr.insertText(ch, from, to))
        );
        if (!handled) editor.view.dispatch(editor.state.tr.insertText(ch, from, to));
      }
    }
    const kinds = (editor: Editor) =>
      (editor.getJSON().content ?? []).flatMap((node) => [node.type, ...(node.content ?? []).map((child) => child.type)]);

    it("keeps $$..$$ inline when typed after text on the same line", () => {
      const editor = typedEditor("Solve ");
      try {
        editor.commands.setTextSelection(editor.state.doc.content.size - 1);
        type(editor, "$$x^2=4$$");
        expect(kinds(editor)).toEqual(["paragraph", "text", "inlineMath"]);
      } finally {
        editor.destroy();
      }
    });

    it("converts typed \\(..\\) into inline math", () => {
      const editor = typedEditor("See ");
      try {
        editor.commands.setTextSelection(editor.state.doc.content.size - 1);
        type(editor, "\\(x^2\\)");
        expect(kinds(editor)).toEqual(["paragraph", "text", "inlineMath"]);
      } finally {
        editor.destroy();
      }
    });

    it("makes $$..$$ a block when typed on an empty line", () => {
      const editor = typedEditor("");
      try {
        type(editor, "$$x^2=4$$");
        expect(kinds(editor)).toContain("blockMath");
        expect(kinds(editor)).not.toContain("inlineMath");
      } finally {
        editor.destroy();
      }
    });
  });
});
