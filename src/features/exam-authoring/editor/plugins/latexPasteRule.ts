/**
 * Phase 07 — typed-math wiring for satMathInputRules (Phase 03).
 *
 * Thin TipTap extension wrapper: satMathInputRules() exports raw InputRules
 * (O(300-char window), explicit delimiters only, no single-dollar); this
 * extension mounts them gated on capabilities.equation. No parsing here.
 */
import { Extension } from "@tiptap/react";
import { satMathInputRules } from "../ingestion/mathInputRules";

export interface LatexPasteRuleOptions {
  enabled: boolean;
}

export const LatexPasteRule = Extension.create<LatexPasteRuleOptions>({
  name: "latexPasteRule",
  addInputRules() {
    if (!this.options.enabled) return [];
    return satMathInputRules();
  },
});

export const INLINE_DOLLAR_RE = /\\\(([\s\S]{1,300}?)\\\)$/;
export const DISPLAY_DOLLAR_RE = /\$\$([\s\S]{1,300}?)\$\$$/;
