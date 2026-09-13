/**
 * Phase 03 — explicit math delimiter scanner (closed set).
 *
 * display-dollar $$..$$ (block), inline-paren \\(..\\) (inline),
 * display-bracket \\[..\\] (block). Single-$ is NEVER a delimiter
 * (currency guard). Delimiters must pair on the SAME input string;
 * empty/whitespace-only content is not a match; backslash-escaped dollars
 * are literal text. Emits offsets for diagnostics. Pure, DOM-free.
 *
 * NOTE (architecture boundary): this file plus mathConfidence.ts and
 * mathIngest.ts are the ONLY ingestion modules allowed to import katex
 * (validation). See architecture.test.ts allowlist (phase 03 exception).
 */

export type MathDelimiterKind = "display-dollar" | "inline-paren" | "display-bracket";

export interface MathMatch {
  kind: MathDelimiterKind;
  latex: string;
  start: number;
  end: number;
  display: boolean;
}

export interface UnclosedDelimiter {
  kind: MathDelimiterKind;
  start: number;
}

const DOLLAR = "$$";
const PAREN_OPEN = "\\(";
const PAREN_CLOSE = "\\)";
const BRACKET_OPEN = "\\[";
const BRACKET_CLOSE = "\\]";

function isEscapedDollar(text: string, at: number): boolean {
  let backslashes = 0;
  let i = at - 1;
  while (i >= 0 && text[i] === "\\") {
    backslashes += 1;
    i -= 1;
  }
  return backslashes % 2 === 1;
}

export interface ScanOutcome {
  matches: MathMatch[];
  unclosed: UnclosedDelimiter[];
}

export function scanExplicitDelimiters(text: string): MathMatch[] {
  return scanDelimitersWithUnclosed(text).matches;
}

export function scanDelimitersWithUnclosed(text: string): ScanOutcome {
  const matches: MathMatch[] = [];
  const unclosed: UnclosedDelimiter[] = [];
  let i = 0;
  while (i < text.length) {
    let kind: MathDelimiterKind | null = null;
    let openLen = 0;
    let close = "";
    let display = false;
    if (text.startsWith(DOLLAR, i) && !isEscapedDollar(text, i)) {
      kind = "display-dollar";
      openLen = 2;
      close = DOLLAR;
      display = true;
    } else if (text.startsWith(PAREN_OPEN, i)) {
      kind = "inline-paren";
      openLen = 2;
      close = PAREN_CLOSE;
      display = false;
    } else if (text.startsWith(BRACKET_OPEN, i)) {
      kind = "display-bracket";
      openLen = 2;
      close = BRACKET_CLOSE;
      display = true;
    }
    if (!kind) {
      i += 1;
      continue;
    }
    const afterOpen = i + openLen;
    const closeAt = text.indexOf(close, afterOpen);
    if (closeAt < 0) {
      unclosed.push({ kind, start: i });
      break;
    }
    const latex = text.slice(afterOpen, closeAt);
    const end = closeAt + close.length;
    if (latex.trim().length === 0) {
      i = end;
      continue;
    }
    matches.push({ kind, latex, start: i, end, display });
    i = end;
  }
  return { matches, unclosed };
}
