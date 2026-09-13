/**
 * Phase 01 — executable-content policy (pure, AST-level second net).
 *
 * Phase-02's HTML sanitizer strips markup before the AST exists; this module
 * re-checks the AST itself: images with javascript: URLs degrade to
 * placeholders, and any text payload smuggling executable markers is cut.
 * Emits import.script.stripped / import.object.stripped / import.style.stripped.
 */
import type { ImportDocument, ImportNode, InlineNode } from "../domain/importDocument";
import type { DiagnosticCode, ImportWarning } from "../domain/importResult";
import { DIAGNOSTIC_MESSAGES } from "../domain/diagnostics";

export interface StripExecutablesOutcome {
  doc: ImportDocument;
  warnings: ImportWarning[];
  transformations: string[];
  truncated: boolean;
}

export const BLOCKED_URL_SCHEMES: readonly string[] = Object.freeze([
  "javascript:",
  "data:",
  "blob:",
  "vbscript:",
]);

export const BLOCKED_INLINE_PATTERNS: readonly string[] = Object.freeze([
  "<script",
  "</script>",
  "<object",
  "<embed",
  "<form",
  "<style",
  "onload=",
  "onerror=",
  "onclick=",
]);

function warn(
  warnings: ImportWarning[],
  code: DiagnosticCode,
  count: number,
): void {
  warnings.push({ code, message: DIAGNOSTIC_MESSAGES[code], count });
}

function pushTransformation(
  transformations: string[],
  note: string,
): void {
  if (!transformations.includes(note)) transformations.push(note);
}

function hasBlockedUrl(value: string | null): boolean {
  if (!value) return false;
  const lower = value.trim().toLowerCase();
  return BLOCKED_URL_SCHEMES.some((scheme) => lower.startsWith(scheme));
}

function hasBlockedPattern(value: string): boolean {
  const lower = value.toLowerCase();
  return BLOCKED_INLINE_PATTERNS.some((pattern) => lower.includes(pattern));
}

function isScriptLike(value: string): boolean {
  const lower = value.toLowerCase();
  return lower.includes("<script") || lower.includes("javascript:");
}

function isObjectLike(value: string): boolean {
  const lower = value.toLowerCase();
  return (
    lower.includes("<object") || lower.includes("<embed") || lower.includes("<form")
  );
}

function isStyleLike(value: string): boolean {
  const lower = value.toLowerCase();
  return lower.includes("<style");
}

/**
 * Scan one text payload, classify the first executable marker found, and
 * return the code to record. Content itself never enters the message.
 */
function classifyPayload(value: string): DiagnosticCode | null {
  if (isScriptLike(value)) return "import.script.stripped";
  if (isObjectLike(value)) return "import.object.stripped";
  if (isStyleLike(value)) return "import.style.stripped";
  if (hasBlockedPattern(value)) return "import.script.stripped";
  return null;
}

/**
 * Drop executable traces from the AST. Never throws; unknown shapes pass
 * through untouched for the no-silent-loss net downstream.
 */
export function stripExecutables(doc: ImportDocument): StripExecutablesOutcome {
  const warnings: ImportWarning[] = [];
  const transformations: string[] = [];
  const counts = new Map<DiagnosticCode, number>();

  const record = (code: DiagnosticCode): void => {
    counts.set(code, (counts.get(code) ?? 0) + 1);
    pushTransformation(transformations, "strip:" + code);
  };

  const cleanInlineText = (value: string): string | null => {
    const code = classifyPayload(value);
    if (!code) return value;
    record(code);
    return null;
  };

  const cleanNode = (node: ImportNode): ImportNode | null => {
    switch (node.kind) {
      case "paragraph":
      case "heading": {
        const children: InlineNode[] = [];
        for (const inline of node.children) {
          if (inline.kind !== "text") {
            children.push(inline);
            continue;
          }
          const cleaned = cleanInlineText(inline.text);
          if (cleaned === null) continue;
          children.push({ ...inline, text: cleaned });
        }
        if (children.length === 0) return null;
        if (node.kind === "paragraph") return { ...node, children };
        return { ...node, children };
      }
      case "codeBlock": {
        const code = classifyPayload(node.text);
        if (code) {
          record(code);
          return null;
        }
        return node;
      }
      case "image": {
        if (hasBlockedUrl(node.url)) {
          record("import.script.stripped");
          return {
            ...node,
            blobRef: null,
            url: null,
            alt: node.alt,
            caption: node.caption,
          };
        }
        return node;
      }
      case "table":
      case "bulletList":
      case "orderedList":
      case "divider":
        return node;
      default:
        return node;
    }
  };

  const nodes: ImportNode[] = [];
  for (const node of doc.nodes) {
    const cleaned = cleanNode(node);
    if (cleaned) nodes.push(cleaned);
  }
  for (const [code, count] of counts) {
    warn(warnings, code, count);
  }
  return { doc: { ...doc, nodes }, warnings, transformations, truncated: false };
}
