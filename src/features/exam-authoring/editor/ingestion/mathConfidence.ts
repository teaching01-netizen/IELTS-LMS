/**
 * Phase 03 — raw-LaTeX confidence detector + KaTeX validation gate.
 *
 * judgeRawLatex scores UNdelimited spans against the SUPPORTED_MACROS
 * allowlist (unknown macro -> null, silent text). Score >= 0.75 returns a
 * verdict; below stays text with no diagnostic. validateLatex is KaTeX
 * throwOnError:true — the single source of truth for validity (mirrors the
 * composer math dialog; runtime renders non-throwing). Currency-adjacent
 * single dollars ($5, $19.99, US$10) force below-threshold.
 */
import katex from "katex";

export const SUPPORTED_MACROS: ReadonlySet<string> = Object.freeze(
  new Set([
    "frac",
    "dfrac",
    "sqrt",
    "text",
    "mathrm",
    "mathbf",
    "mathit",
    "pi",
    "le",
    "ge",
    "ne",
    "pm",
    "times",
    "cdot",
    "div",
    "circ",
    "lvert",
    "rvert",
    "left",
    "right",
    "sum",
    "prod",
    "int",
    "lim",
    "log",
    "sin",
    "cos",
    "tan",
    "binom",
  ]),
);

export interface ConfidenceVerdict {
  latex: string;
  score: number;
  reasons: string[];
  macros: string[];
}

export type LatexValidation = { ok: true } | { ok: false; error: string };

export const MATH_CONFIDENCE_THRESHOLD = 0.75;

const CURRENCY_RE = /(\d\s*\$|\$\s*\d|US\$|\$\s*[A-Za-z])/;
const FILE_PATH_RE = /^[A-Za-z]:\\|\.((js|ts|tsx|py|md|txt|json|csv)(\s|$))|\\n/;
const ENGLISH_WORDS = new Set([
  "the",
  "and",
  "with",
  "from",
  "that",
  "this",
  "question",
  "answer",
  "because",
  "which",
  "their",
  "there",
  "about",
  "would",
  "should",
]);

export function validateLatex(latex: string): LatexValidation {
  try {
    katex.renderToString(latex, { throwOnError: true, strict: false, displayMode: false });
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid equation.";
    return { ok: false, error: message.replace(/^KaTeX parse error:\s*/i, "").slice(0, 120) };
  }
}

export function judgeRawLatex(candidate: string): ConfidenceVerdict | null {
  const text = candidate.trim();
  if (!text || text.length > 5000) return null;
  if (CURRENCY_RE.test(text)) return null;
  if (FILE_PATH_RE.test(text)) return null;
  const macros = Array.from(text.matchAll(/\\([a-zA-Z]+)/g)).map((m) => m[1] ?? "");
  if (macros.length === 0) return null;
  if (macros.some((m) => !SUPPORTED_MACROS.has(m))) return null;
  const reasons: string[] = [];
  const macroDensity = Math.min(1, macros.length / Math.max(1, text.split(/\s+/).length / 2));
  reasons.push("allowlisted-macros:" + macros.slice(0, 5).join(","));
  let opens = 0;
  let closes = 0;
  for (const ch of text) {
    if (ch === "{") opens += 1;
    if (ch === "}") closes += 1;
  }
  const braceBalance = opens === closes && opens > 0 ? 1 : opens === 0 ? 0.3 : -1;
  if (braceBalance < 0) return null;
  reasons.push("braces:" + opens + "/" + closes);
  let structure = 0;
  if (/\\(frac|dfrac|sqrt|binom)\b/.test(text)) structure += 0.5;
  if (/[\^_]\s*[{\w]/.test(text)) structure += 0.3;
  if (/\\(left|right)\b/.test(text)) structure += 0.2;
  if (/\\(sum|prod|int|lim)\b/.test(text)) structure += 0.2;
  const words = text.toLowerCase().split(/[^a-z]+/).filter(Boolean);
  const englishHits = words.filter((w) => ENGLISH_WORDS.has(w)).length;
  const englishPenalty = Math.min(0.5, englishHits * 0.15);
  if (englishHits > 0) reasons.push("english-words:" + englishHits);
  const score = 0.4 * macroDensity + 0.3 * braceBalance + 0.3 * Math.min(1, structure) - englishPenalty;
  if (score < MATH_CONFIDENCE_THRESHOLD) return null;
  return { latex: text, score: Math.min(1, score), reasons, macros };
}
