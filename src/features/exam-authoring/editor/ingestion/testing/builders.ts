/**
 * Phase 01 — AST builders for tests (plus one golden sample document).
 */
import type {
  ImportDocument,
  ImportMetadata,
  ImportNode,
  InlineNode,
  TableCell,
  TextMark,
} from "../domain/importDocument";

export function resetBuilderIds(): void {}

export function testMeta(
  overrides: Partial<ImportMetadata> = {},
): ImportMetadata {
  return {
    source: "text",
    confidence: 2,
    transformations: [],
    ...overrides,
  };
}

export function text(
  value: string,
  marks: TextMark[] = [],
  meta: ImportMetadata = testMeta(),
): InlineNode {
  return { kind: "text", text: value, marks: [...marks], meta };
}

export function inlineMath(
  latex: string,
  meta: ImportMetadata = testMeta(),
): InlineNode {
  return { kind: "inlineMath", latex, meta };
}

export function blockMath(
  latex: string,
  meta: ImportMetadata = testMeta(),
): InlineNode {
  return { kind: "blockMath", latex, meta };
}

export function p(
  children: InlineNode[] = [text("hello")],
  meta: ImportMetadata = testMeta(),
): ImportNode {
  return { kind: "paragraph", children, meta };
}

export function heading(
  level: 2 | 3,
  children: InlineNode[] = [text("heading")],
  meta: ImportMetadata = testMeta(),
): ImportNode {
  return { kind: "heading", level, children, meta };
}

export function codeBlock(
  code: string,
  meta: ImportMetadata = testMeta(),
): ImportNode {
  return { kind: "codeBlock", text: code, meta };
}

export function cell(value: string): TableCell {
  return { children: [text(value)] };
}

export function table(
  rows: TableCell[][] = [
    [cell("a"), cell("b")],
    [cell("c"), cell("d")],
  ],
  headerRow = true,
  meta: ImportMetadata = testMeta(),
): ImportNode {
  return { kind: "table", rows, headerRow, meta };
}

export function image(
  overrides: Partial<Extract<ImportNode, { kind: "image" }>> = {},
): ImportNode {
  return {
    kind: "image",
    blobRef: null,
    url: null,
    alt: null,
    caption: null,
    meta: testMeta({ source: "image", confidence: 1 }),
    ...overrides,
  };
}

export function sampleDocument(): ImportDocument {
  return {
    version: 1,
    nodes: [
      p([text("Which value satisfies the equation?")]),
      p([text("Solve for "), inlineMath("x^2 = 4"), text(" in the prompt.")]),
      table(),
    ],
    sourceMeta: testMeta({ transformations: ["adapter-selected:text"] }),
  };
}
