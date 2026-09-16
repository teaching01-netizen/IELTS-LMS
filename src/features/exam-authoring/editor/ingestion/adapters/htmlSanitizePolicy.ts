/**
 * Phase 02 — ingestion-owned HTML sanitizer (fail-closed DOMPurify wrapper).
 *
 * Narrow structural allowlist shaped to the TipTap schema (paragraphs,
 * headings, marks, lists, tables, code, divider). Nothing unsanitized ever
 * reaches block construction. Math-looking text ($$, \\(...\\), \\[...\\],
 * raw backslash macros) passes through VERBATIM — phase 03 owns math.
 * Placeholder spans carrying data-sat-latex are opaque to the generic walk.
 *
 * Lives in adapters/ (not domain/): DOMPurify needs host DOM access, which
 * the architecture boundary forbids in domain/application/security.
 */
import DOMPurify from "dompurify";
import type { DiagnosticCode } from "../domain/importResult";
import { DIAGNOSTIC_MESSAGES } from "../domain/diagnostics";
import type { ImportWarning } from "../domain/importResult";

const ALLOWED_TAGS: readonly string[] = Object.freeze([
  "p",
  "div",
  "br",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "strong",
  "b",
  "em",
  "i",
  "u",
  "sub",
  "sup",
  "code",
  "pre",
  "ul",
  "ol",
  "li",
  "table",
  "thead",
  "tbody",
  "tfoot",
  "tr",
  "td",
  "th",
  "hr",
  "span",
  "a",
]);

export interface SanitizeOutcome {
  cleanHtml: string;
  warnings: ImportWarning[];
}

function warn(code: DiagnosticCode): ImportWarning {
  return { code, message: DIAGNOSTIC_MESSAGES[code], count: 1 };
}

const RESIDUE_RE =
  /<\s*(script|iframe|object|embed|form|input|button|link|meta|svg|math)[\s>]|\son\w+\s*=|javascript\s*:|vbscript\s*:|data\s*:\s*text\/html/i;

/**
 * Sanitize untrusted pasted HTML. Fail-closed: when executable residue is
 * detected after the DOMPurify pass, returns an empty string plus an
 * import.script.stripped warning rather than risking partial payloads.
 */
export function sanitizeForIngestion(dirtyHtml: string): SanitizeOutcome {
  if (dirtyHtml.trim().length === 0) {
    return { cleanHtml: "", warnings: [] };
  }
  const warnings: ImportWarning[] = [];
  let clean: string;
  try {
    clean = DOMPurify.sanitize(dirtyHtml, {
      ALLOWED_TAGS: [...ALLOWED_TAGS],
      ALLOWED_ATTR: [
        "colspan",
        "rowspan",
        "data-sat-latex",
        "data-sat-display",
        "data-sat-image-ref",
      ],
      FORBID_TAGS: [
        "script",
        "style",
        "iframe",
        "object",
        "embed",
        "form",
        "input",
        "button",
        "link",
        "meta",
        "svg",
        "math",
      ],
      FORBID_ATTR: ["style", "class", "id", "on*"],
      ALLOW_DATA_ATTR: false,
    }) as unknown as string;
  } catch {
    warnings.push(warn("import.script.stripped"));
    return { cleanHtml: "", warnings };
  }
  if (RESIDUE_RE.test(clean)) {
    warnings.push(warn("import.script.stripped"));
    return { cleanHtml: "", warnings };
  }
  if (clean.length !== dirtyHtml.length) {
    warnings.push(warn("import.style.stripped"));
  }
  return { cleanHtml: clean, warnings };
}
