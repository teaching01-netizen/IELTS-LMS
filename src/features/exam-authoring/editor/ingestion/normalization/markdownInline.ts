import type { ImportMetadata, InlineNode, TextMark } from "../domain/importDocument";

export interface MarkdownInlineOutcome {
  inlines: InlineNode[];
  applied: number;
}
const CODE_DELIMITER = String.fromCharCode(96);

const MAX_MARKDOWN_SCAN_CHARS = 20_000;

function textNode(text: string, marks: TextMark[], meta: ImportMetadata): InlineNode | null {
  return text ? { kind: "text", text, marks: [...marks], meta } : null;
}
function isWord(value: string | undefined): boolean {
  return value !== undefined && /[\p{L}\p{N}]/u.test(value);
}
function escaped(text: string, index: number): boolean {
  let slashes = 0;
  for (let i = index - 1; i >= 0 && text[i] === "\\"; i -= 1) slashes += 1;
  return slashes % 2 === 1;
}
function canOpen(text: string, index: number, length: number): boolean {
  const before = index > 0 ? text[index - 1] : undefined;
  const after = text[index + length];
  return !escaped(text, index) && !isWord(before) && after !== undefined && !/\s/.test(after);
}
function canClose(text: string, index: number): boolean {
  const before = index > 0 ? text[index - 1] : undefined;
  const after = text[index + 1];
  return !escaped(text, index) && before !== undefined && !/\s/.test(before) && !isWord(after);
}
function findClose(text: string, from: number, delimiter: string): number {
  let cursor = from;
  while (cursor < text.length) {
    const found = text.indexOf(delimiter, cursor);
    if (found < 0) return -1;
    if (canClose(text, found)) return found;
    cursor = found + delimiter.length;
  }
  return -1;
}

function hasUnescapedDelimiter(text: string, delimiter: string, from: number): boolean {
  let cursor = from;
  while (cursor < text.length) {
    const found = text.indexOf(delimiter, cursor);
    if (found < 0) return false;
    if (!escaped(text, found)) return true;
    cursor = found + delimiter.length;
  }
  return false;
}
function findMathEnd(text: string, index: number): number | null {
  const pairs: Array<[string, string]> = [
    ["$$", "$$"],
    ["\\(", "\\)"],
    ["\\[", "\\]"],
  ];
  for (const [open, close] of pairs) {
    if (!text.startsWith(open, index)) continue;
    const end = text.indexOf(close, index + open.length);
    if (end < 0 || text.slice(index + open.length, end).trim().length === 0) return null;
    return end + close.length;
  }
  return null;
}

function parseMarkdownText(text: string, marks: TextMark[], meta: ImportMetadata): InlineNode[] {
  const out: InlineNode[] = [];
  let plain = "";
  const flush = (): void => {
    const node = textNode(plain, marks, meta);
    if (node) out.push(node);
    plain = "";
  };
  let index = 0;
  while (index < text.length) {
    const char = text[index];
    if (char === "\\" && index + 1 < text.length && "*_".includes(text[index + 1] ?? "")) {
      plain += text[index + 1];
      index += 2;
      continue;
    }
    if (char === CODE_DELIMITER) {
      const close = findClose(text, index + 1, CODE_DELIMITER);
      if (close >= 0) {
        flush();
        const node = textNode(text.slice(index + 1, close), [...marks, "code"], meta);
        if (node) out.push(node);
        index = close + 1;
        continue;
      }
    }
    const mathEnd = findMathEnd(text, index);
    if (mathEnd !== null) {
      plain += text.slice(index, mathEnd);
      index = mathEnd;
      continue;
    }
    const delimiter = text.startsWith("**", index)
      ? "**"
      : text.startsWith("__", index)
        ? "__"
        : text.startsWith("*", index)
          ? "*"
          : text.startsWith("_", index)
            ? "_"
            : null;
    if (delimiter && canOpen(text, index, delimiter.length)) {
      const close = findClose(text, index + delimiter.length, delimiter);
      if (
        close > index + delimiter.length &&
        hasUnescapedDelimiter(text, delimiter, index + delimiter.length)
      ) {
        flush();
        const mark: TextMark = delimiter.length === 2 ? "bold" : "italic";
        out.push(
          ...parseMarkdownText(text.slice(index + delimiter.length, close), [...marks, mark], meta)
        );
        index = close + delimiter.length;
        continue;
      }
    }
    plain += char;
    index += 1;
  }
  flush();
  return out;
}

function normalizeText(inline: Extract<InlineNode, { kind: "text" }>): InlineNode[] {
  if (inline.marks.includes("code") || inline.text.length > MAX_MARKDOWN_SCAN_CHARS)
    return [inline];
  return parseMarkdownText(inline.text, inline.marks, inline.meta);
}

export function applyMarkdownInlineToInlines(inlines: InlineNode[]): MarkdownInlineOutcome {
  const next: InlineNode[] = [];
  let applied = 0;
  for (const inline of inlines) {
    if (inline.kind !== "text") {
      next.push(inline);
      continue;
    }
    const normalized = normalizeText(inline);
    for (const item of normalized) {
      if (item.kind === "text" && item.marks.length > inline.marks.length) applied += 1;
      next.push(item);
    }
  }
  return { inlines: next, applied };
}

export function markdownInlineApplied(inlines: InlineNode[]): boolean {
  return applyMarkdownInlineToInlines(inlines).applied > 0;
}
