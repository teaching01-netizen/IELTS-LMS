/**
 * Phase 07 — ImportDocument to TipTap JSON conversion.
 *
 * Pure data transform (no editor instance): ImportNode tree -> TipTap doc
 * JSON ({ type: 'doc', content: [...] }) targeting the composer schema
 * (StarterKit H2/H3, TableKit, inlineMath/blockMath { latex }, SatImage).
 * Capability normalization happens FIRST on the ImportDocument (data, not
 * post-edited ProseMirror): blockStyles:false demotes headings + drops
 * dividers; lists:false flattens to paragraphs keeping marks/inline math;
 * equation:false renders latex as code-marked text; image:false keeps alt
 * text; table:false explodes rows to middot-joined paragraphs. Table cells
 * map: multi-inline cells preserved; headerRow only affects row-0 cell TYPE
 * (tableHeader vs tableCell) matching the TableKit toolbar shape.
 */
import type { ImportDocument, ImportNode, InlineNode } from "../domain/importDocument";
import type { RichComposerCapabilities } from "../../RichQuestionComposer";

export interface TipTapJson {
  type: string;
  attrs?: Record<string, unknown> | undefined;
  content?: TipTapJson[] | undefined;
  marks?: Array<{ type: string }> | undefined;
  text?: string | undefined;
}

export interface ConversionOutcome {
  doc: TipTapJson;
  mathCount: number;
  imageCount: number;
  tableCount: number;
  blockCount: number;
}

const MARK_TO_TIPTAP: Readonly<Record<string, string>> = Object.freeze({
  bold: "bold",
  italic: "italic",
  underline: "underline",
  subscript: "subscript",
  superscript: "superscript",
  code: "code",
});

function convertInline(inline: InlineNode, caps: Readonly<RichComposerCapabilities>, counts: { math: number }, blockOk: boolean): TipTapJson | null {
  if (inline.kind === "text") {
    if (!inline.text) return null;
    const marks = inline.marks
      .map((m) => MARK_TO_TIPTAP[m])
      .filter((m): m is string => typeof m === "string")
      .filter((m) => (m === "underline" ? caps.underline : true))
      .map((type) => ({ type }));
    return marks.length > 0 ? { type: "text", text: inline.text, marks } : { type: "text", text: inline.text };
  }
  if (!caps.equation) {
    return { type: "text", text: inline.latex, marks: [{ type: "code" }] };
  }
  counts.math += 1;
  if (inline.kind === "blockMath" && blockOk) {
    return { type: "blockMath", attrs: { latex: inline.latex } };
  }
  return { type: "inlineMath", attrs: { latex: inline.latex } };
}

function convertInlines(inlines: InlineNode[], caps: Readonly<RichComposerCapabilities>, counts: { math: number }, blockOk = false): TipTapJson[] {
  const out: TipTapJson[] = [];
  for (const inline of inlines) {
    const converted = convertInline(inline, caps, counts, blockOk);
    if (converted) out.push(converted);
  }
  return out;
}

function paragraphToBlocks(inlines: InlineNode[], caps: Readonly<RichComposerCapabilities>, counts: { math: number }): TipTapJson[] {
  const blocks: TipTapJson[] = [];
  let current: InlineNode[] = [];
  const flush = (): void => {
    if (current.length === 0) return;
    const content = convertInlines(current, caps, counts);
    if (content.length > 0) blocks.push({ type: "paragraph", content });
    current = [];
  };
  for (const inline of inlines) {
    if (inline.kind === "blockMath" && caps.equation) {
      flush();
      counts.math += 1;
      blocks.push({ type: "blockMath", attrs: { latex: inline.latex } });
    } else {
      current.push(inline);
    }
  }
  flush();
  return blocks;
}

function paragraphFromInlines(inlines: InlineNode[], caps: Readonly<RichComposerCapabilities>, counts: { math: number }): TipTapJson | null {
  const content = convertInlines(inlines, caps, counts);
  if (content.length === 0) return null;
  return { type: "paragraph", content };
}

function convertBlock(node: ImportNode, caps: Readonly<RichComposerCapabilities>, counts: { math: number; images: number; tables: number }, inCell: boolean): TipTapJson[] {
  switch (node.kind) {
    case "paragraph": {
      return paragraphToBlocks(node.children, caps, counts);
    }
    case "heading": {
      if (!caps.blockStyles) {
        const para = paragraphFromInlines(node.children, caps, counts);
        return para ? [para] : [];
      }
      const content = convertInlines(node.children, caps, counts);
      if (content.length === 0) return [];
      return [{ type: "heading", attrs: { level: node.level }, content }];
    }
    case "bulletList":
    case "orderedList": {
      if (!caps.lists || inCell) {
        const out: TipTapJson[] = [];
        for (const item of node.items) {
          for (const block of item) out.push(...convertBlock(block, caps, counts, inCell));
        }
        return out;
      }
      const items: TipTapJson[] = [];
      for (const item of node.items) {
        const content: TipTapJson[] = [];
        for (const block of item) content.push(...convertBlock(block, caps, counts, false));
        if (content.length > 0) items.push({ type: "listItem", content });
      }
      if (items.length === 0) return [];
      return [{ type: node.kind === "bulletList" ? "bulletList" : "orderedList", content: items }];
    }
    case "codeBlock": {
      if (!node.text.trim()) return [];
      return [{ type: "codeBlock", content: [{ type: "text", text: node.text }] }];
    }
    case "table": {
      if (!caps.table || inCell) {
        const out: TipTapJson[] = [];
        for (const row of node.rows) {
          const joined = row
            .flatMap((cell) => convertInlines(cell.children, caps, counts))
            .filter((n) => n.type === "text" && n.text?.trim());
          if (joined.length > 0) {
            const content: TipTapJson[] = [];
            joined.forEach((inline, i) => {
              if (i > 0) content.push({ type: "text", text: " \u00b7 " });
              content.push(inline);
            });
            out.push({ type: "paragraph", content });
          }
        }
        return out;
      }
      counts.tables += 1;
      const rows: TipTapJson[] = [];
      node.rows.forEach((row, rowIndex) => {
        const cells: TipTapJson[] = [];
        for (const cell of row) {
          const inlines = convertInlines(cell.children, caps, counts);
          const cellType = node.headerRow && rowIndex === 0 ? "tableHeader" : "tableCell";
          cells.push({
            type: cellType,
            content: inlines.length > 0 ? [{ type: "paragraph", content: inlines }] : [{ type: "paragraph" }],
          });
        }
        if (cells.length > 0) rows.push({ type: "tableRow", content: cells });
      });
      if (rows.length === 0) return [];
      return [{ type: "table", content: rows }];
    }
    case "image": {
      if (!caps.image) {
        if (node.alt?.trim()) return [{ type: "paragraph", content: [{ type: "text", text: node.alt }] }];
        return [];
      }
      counts.images += 1;
      return [
        {
          type: "image",
          attrs: {
            src: node.url ?? null,
            assetId: null,
            alt: node.alt ?? "",
            caption: node.caption ?? null,
            uploadId: null,
            uploading: false,
            uploadError: null,
          },
        },
      ];
    }
    case "divider": {
      if (!caps.blockStyles) return [];
      return [{ type: "horizontalRule" }];
    }
  }
}

export function normalizeImportForCapabilities(
  doc: ImportDocument,
  caps: Readonly<RichComposerCapabilities>,
): { doc: ImportDocument; filtered: string[] } {
  void caps;
  return { doc, filtered: [] };
}

export function importAstToRichDocument(
  doc: ImportDocument,
  caps: Readonly<RichComposerCapabilities>,
): ConversionOutcome {
  const counts = { math: 0, images: 0, tables: 0 };
  const content: TipTapJson[] = [];
  for (const node of doc.nodes) content.push(...convertBlock(node, caps, counts, false));
  const safe = content.length > 0 ? content : [{ type: "paragraph" as const }];
  return {
    doc: { type: "doc", content: safe },
    mathCount: counts.math,
    imageCount: counts.images,
    tableCount: counts.tables,
    blockCount: safe.length,
  };
}

export function convertForTableCell(
  doc: ImportDocument,
  caps: Readonly<RichComposerCapabilities>,
): ConversionOutcome {
  const counts = { math: 0, images: 0, tables: 0 };
  const content: TipTapJson[] = [];
  for (const node of doc.nodes) content.push(...convertBlock(node, { ...caps, table: false }, counts, true));
  const inlines = content.flatMap((n) => (n.type === "paragraph" ? (n.content ?? []) : []));
  return {
    doc: { type: "doc", content: [{ type: "paragraph", content: inlines.length > 0 ? inlines : undefined }] },
    mathCount: counts.math,
    imageCount: 0,
    tableCount: 0,
    blockCount: 1,
  };
}
