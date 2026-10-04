/**
 * Phase 03 — typing-time LaTeX input rules (explicit delimiters only).
 *
 * Paren \\(..\\) -> inlineMath, bracket \\[..\\] + double-dollar $$..$$ ->
 * blockMath when alone on the line, otherwise inlineMath. Each find regex is
 * anchored to the last ~300 chars before the cursor by the InputRule engine
 * (find runs on the current textblock tail):
 * O(candidate window), never O(document). A rule inserts only when
 * validateLatex passes at keystroke time; otherwise it leaves typed text.
 * No single-dollar rule (currency guard).
 *
 * WIRING NOTE (Phase 07 owns composer edits): append satMathInputRules()
 * to RichQuestionComposer baseExtensions/editorExtensions memo AFTER
 * Placeholder (stable memo identity), gated on capabilities.equation.
 * This file exports the rules; NOTHING here touches the composer.
 */
import { InputRule } from "@tiptap/react";
import { validateLatex } from "./mathConfidence";

export const MATH_INPUT_LOOKBEHIND = 300;

function tryLatex(latex: string): boolean {
  const trimmed = latex.trim();
  if (!trimmed || trimmed.length > 5000) return false;
  return validateLatex(trimmed).ok;
}

export interface MathInputRuleOptions {
  /**
   * Called only when a rule actually converted typed text into an equation, so
   * the caller can acknowledge the conversion without re-implementing the
   * confidence check. Absent means no notification, exactly as before.
   */
  onConvert?: ((latex: string, nodeName: "inlineMath" | "blockMath") => void) | undefined;
}

function inlineRule(
  find: RegExp,
  nodeName: "inlineMath" | "blockMath",
  options: MathInputRuleOptions
): InputRule {
  return new InputRule({
    find,
    handler: ({ state, range, match, chain }) => {
      const latex = (match[1] ?? "").trim();
      if (!tryLatex(latex)) return null;
      // Display delimiters make a block only on an otherwise empty line;
      // mid-sentence they stay inline so typing never splits the line.
      const $from = state.doc.resolve(range.from);
      const type =
        nodeName === "blockMath" && (range.from !== $from.start() || range.to !== $from.end())
          ? "inlineMath"
          : nodeName;
      chain()
        .deleteRange(range)
        .insertContentAt(range.from, { type, attrs: { latex } })
        .run();
      options.onConvert?.(latex, type);
      // Not null: Tiptap discards the transaction when a handler returns null.
      return undefined;
    },
  });
}

export function satMathInputRules(options: MathInputRuleOptions = {}): InputRule[] {
  return [
    inlineRule(/\\\(([\s\S]{1,300}?)\\\)$/, "inlineMath", options),
    inlineRule(/\\\[([\s\S]{1,300}?)\\\]$/, "blockMath", options),
    inlineRule(/\$\$([\s\S]{1,300}?)\$\$$/, "blockMath", options),
  ];
}
