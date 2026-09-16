/**
 * Phase 02 — plain-text + generic-HTML to ImportDocument.
 *
 * Pipeline: detectVendor -> stripVendorChrome -> sanitizeForIngestion ->
 * DOM walk to ImportNodes. Math-looking text ($$, \\(...\\), \\[...\\], raw
 * backslash macros, single-$ currency) is emitted VERBATIM — phase 03 owns
 * all math interpretation. codeBlock/code content is a no-scan zone for
 * phase 03. Unknown elements degrade to text plus import.block.degraded,
 * never silent loss. Links flatten to text (schema has no link node).
 */
import type {
  BlobRef,
  ImportDocument,
  ImportMetadata,
  ImportNode,
  InlineNode,
  TableCell,
  TextMark,
} from "../domain/importDocument";
import type { ImportWarning } from "../domain/importResult";
import { DIAGNOSTIC_MESSAGES } from "../domain/diagnostics";
import type { PipelineContext } from "../application/pipelineContext";
import { sanitizeForIngestion } from "./htmlSanitizePolicy";
import { detectVendor, stripVendorChrome } from "./vendorNormalize";

export type TextHtmlInput = { kind: "text"; text: string } | { kind: "html"; html: string };

export interface TextHtmlContext {
  target: "rich" | "choice";
  sourceHint?: "word" | "gdocs" | "unknown" | undefined;
}

export interface TextHtmlOutcome {
  document: ImportDocument;
  warnings: ImportWarning[];
  transformations: string[];
}

/** Opaque image metadata supplied by the application layer after fetching. */
export interface TextHtmlImageRef {
  refId: string;
  blobRef: BlobRef | null;
  alt: string;
}

export interface TextHtmlOptions {
  imageRefs?: ReadonlyMap<string, TextHtmlImageRef> | undefined;
}

function warn(code: ImportWarning["code"]): ImportWarning {
  return { code, message: DIAGNOSTIC_MESSAGES[code], count: 1 };
}

function metaFor(source: ImportMetadata["source"]): ImportMetadata {
  return { source, confidence: 2, transformations: [] };
}

function textNode(value: string, marks: TextMark[], source: ImportMetadata["source"]): InlineNode {
  return { kind: "text", text: value, marks: [...marks], meta: metaFor(source) };
}

function headingLevel(tag: string): 2 | 3 {
  return tag === "h1" || tag === "h2" ? 2 : 3;
}

const MARK_BY_TAG: Readonly<Record<string, TextMark>> = Object.freeze({
  strong: "bold",
  b: "bold",
  em: "italic",
  i: "italic",
  u: "underline",
  sub: "subscript",
  sup: "superscript",
  code: "code",
});

const BLOCK_TAGS = new Set([
  "p",
  "div",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "pre",
  "ul",
  "ol",
  "table",
  "hr",
]);

export function parseTextHtml(
  input: TextHtmlInput,
  ctx: TextHtmlContext,
  pipelineCtx?: PipelineContext,
  options: TextHtmlOptions = {}
): TextHtmlOutcome {
  void pipelineCtx;
  void ctx.target;
  if (input.kind === "text") return parsePlainText(input.text);
  return parseHtml(input.html, options);
}

function emptyOutcome(): TextHtmlOutcome {
  const meta: ImportMetadata = { source: "text", confidence: 0, transformations: [] };
  return {
    document: { version: 1, nodes: [], sourceMeta: meta },
    warnings: [warn("import.empty")],
    transformations: [],
  };
}

function parsePlainText(text: string): TextHtmlOutcome {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (normalized.trim().length === 0) return emptyOutcome();
  const meta = metaFor("text");
  const runs = normalized.split(/\n{2,}/);
  const nodes: ImportNode[] = [];
  for (const run of runs) {
    const collapsed = run
      .replace(/\n/g, " ")
      .replace(/[^\S\n]+/g, " ")
      .trim();
    if (!collapsed) continue;
    nodes.push({ kind: "paragraph", children: [textNode(collapsed, [], "text")], meta });
  }
  if (nodes.length === 0) return emptyOutcome();
  return {
    document: {
      version: 1,
      nodes,
      sourceMeta: { source: "text", confidence: 2, transformations: ["text.split-paragraphs"] },
    },
    warnings: [],
    transformations: ["text.split-paragraphs"],
  };
}

interface WalkState {
  warnings: ImportWarning[];
  transformations: string[];
  degradedTags: Set<string>;
  headingClamped: boolean;
  linkFlattened: boolean;
  imageRefs: ReadonlyMap<string, TextHtmlImageRef>;
  tableImageFallbacks: number;
}

function parseHtml(html: string, options: TextHtmlOptions): TextHtmlOutcome {
  const signal = detectVendor(html);
  const vendor = stripVendorChrome(html, signal);
  const sanitized = sanitizeForIngestion(vendor.html);
  const state: WalkState = {
    warnings: [...vendor.warnings, ...sanitized.warnings],
    transformations: [...vendor.transformations],
    degradedTags: new Set(),
    headingClamped: false,
    linkFlattened: false,
    imageRefs: options.imageRefs ?? new Map(),
    tableImageFallbacks: 0,
  };
  if (sanitized.cleanHtml.trim().length === 0) {
    const meta: ImportMetadata = {
      source: "html",
      confidence: 0,
      transformations: [...state.transformations],
    };
    return {
      document: { version: 1, nodes: [], sourceMeta: meta },
      warnings: state.warnings,
      transformations: state.transformations,
    };
  }
  let body: HTMLElement;
  try {
    const doc = new DOMParser().parseFromString(sanitized.cleanHtml, "text/html");
    if (!doc.body) throw new Error("no body");
    body = doc.body;
  } catch {
    return parsePlainText(sanitized.cleanHtml.replace(/<[^>]*>/g, " "));
  }
  const nodes: ImportNode[] = [];
  const meta = metaFor("html");
  let current: InlineNode[] = [];
  const flush = (): void => {
    const kept = current.filter((n) => n.kind !== "text" || n.text.length > 0);
    if (kept.length > 0) nodes.push({ kind: "paragraph", children: kept, meta });
    current = [];
  };
  const appendParts = (parts: MixedPart[]): void => {
    for (const part of parts) {
      if (part.kind === "image") {
        flush();
        nodes.push(part);
      } else {
        current.push(part);
      }
    }
  };
  for (const child of Array.from(body.childNodes)) {
    if (child.nodeType === 3) {
      const t = (child.textContent ?? "").replace(/\s+/g, " ");
      if (t.trim()) current.push(textNode(t, [], "html"));
      continue;
    }
    if (child.nodeType !== 1) continue;
    const el = child as Element;
    const tag = el.tagName.toLowerCase();
    if (BLOCK_TAGS.has(tag)) {
      flush();
      nodes.push(...buildBlock(el, state));
    } else if (tag === "br") {
      flush();
    } else {
      appendParts(collectMixed(el, [], state));
    }
  }
  flush();
  if (state.degradedTags.size > 0) {
    state.warnings.push({
      code: "import.block.degraded",
      message: DIAGNOSTIC_MESSAGES["import.block.degraded"],
      count: state.degradedTags.size,
    });
    state.transformations.push(
      "html.unknown-degraded:" + Array.from(state.degradedTags).sort().join(",")
    );
  }
  if (state.headingClamped) {
    state.warnings.push(warn("import.heading.clamped"));
    state.transformations.push("html.heading-clamped");
  }
  if (state.linkFlattened) {
    state.warnings.push({
      code: "import.block.degraded",
      message: DIAGNOSTIC_MESSAGES["import.block.degraded"],
      count: 1,
    });
    state.transformations.push("html.link-flattened");
  }
  if (state.tableImageFallbacks > 0) {
    state.warnings.push({
      code: "import.image.rejected",
      message:
        DIAGNOSTIC_MESSAGES["import.image.rejected"] +
        " (" +
        String(state.tableImageFallbacks) +
        ")",
      count: state.tableImageFallbacks,
    });
    state.transformations.push("html.image-table-alt:" + String(state.tableImageFallbacks));
  }
  state.transformations.push("html.walk-blocks");
  return {
    document: {
      version: 1,
      nodes,
      sourceMeta: { source: "html", confidence: 2, transformations: [...state.transformations] },
    },
    warnings: state.warnings,
    transformations: state.transformations,
  };
}

type ImportImageNode = Extract<ImportNode, { kind: "image" }>;
type MixedPart = InlineNode | ImportImageNode;

function isImportImage(part: MixedPart): part is ImportImageNode {
  return part.kind === "image";
}

function markerParts(el: Element, marks: TextMark[], state: WalkState): MixedPart[] | null {
  const refId = el.getAttribute("data-sat-image-ref");
  if (refId === null) return null;
  const ref = state.imageRefs.get(refId);
  if (!ref) {
    state.degradedTags.add("image-marker");
    return [];
  }
  if (!ref.blobRef) {
    return ref.alt.trim() ? [textNode(ref.alt, [...marks], "html")] : [];
  }
  return [
    {
      kind: "image",
      blobRef: ref.blobRef,
      url: null,
      alt: ref.alt,
      caption: null,
      meta: metaFor("html"),
    },
  ];
}

function collectMixed(el: Element, marks: TextMark[], state: WalkState): MixedPart[] {
  const selfMarker = markerParts(el, marks, state);
  if (selfMarker !== null) return selfMarker;
  const elementTag = el.tagName.toLowerCase();
  if (elementTag === "a") state.linkFlattened = true;
  if (
    !BLOCK_TAGS.has(elementTag) &&
    !MARK_BY_TAG[elementTag] &&
    !["a", "span", "img", "li", "td", "th"].includes(elementTag)
  ) {
    state.degradedTags.add(elementTag);
  }
  const out: MixedPart[] = [];
  for (const child of Array.from(el.childNodes)) {
    if (child.nodeType === 3) {
      const raw = child.textContent ?? "";
      const collapsed = raw.replace(/\s+/g, " ");
      if (collapsed.trim().length === 0) continue;
      const leading = /^\s/.test(raw) && out.length > 0 ? " " : "";
      out.push(textNode(leading + collapsed.trimStart(), [...marks], "html"));
      continue;
    }
    if (child.nodeType !== 1) continue;
    const kid = child as Element;
    const marker = markerParts(kid, marks, state);
    if (marker !== null) {
      out.push(...marker);
      continue;
    }
    if (kid.tagName.toLowerCase() === "br") {
      out.push(textNode(" ", [...marks], "html"));
      continue;
    }
    const tag = kid.tagName.toLowerCase();
    if (tag === "a") {
      state.linkFlattened = true;
      out.push(...collectMixed(kid, marks, state));
      continue;
    }
    const mark = MARK_BY_TAG[tag];
    if (mark) {
      out.push(...collectMixed(kid, [...marks, mark], state));
      continue;
    }
    if (tag === "span") {
      const latex = kid.getAttribute("data-sat-latex");
      if (typeof latex === "string") {
        out.push(textNode(kid.textContent ?? "", [...marks], "html"));
      } else {
        out.push(...collectMixed(kid, marks, state));
      }
      continue;
    }
    if (tag === "img") {
      state.degradedTags.add("img");
      const alt = kid.getAttribute("alt") ?? "";
      if (alt.trim()) out.push(textNode(alt, [...marks], "html"));
      continue;
    }
    state.degradedTags.add(tag);
    out.push(...collectMixed(kid, marks, state));
  }
  return out;
}

function mixedBlockParts(
  el: Element,
  state: WalkState,
  kind: "paragraph" | "heading",
  level?: 2 | 3
): ImportNode[] {
  const meta = metaFor("html");
  const blocks: ImportNode[] = [];
  let current: InlineNode[] = [];
  const flush = (): void => {
    const kept = current.filter((n) => n.kind !== "text" || n.text.trim().length > 0);
    if (kept.length > 0) {
      blocks.push(
        kind === "heading"
          ? { kind: "heading", level: level ?? 2, children: kept, meta }
          : { kind: "paragraph", children: kept, meta }
      );
    }
    current = [];
  };
  for (const part of collectMixed(el, [], state)) {
    if (isImportImage(part)) {
      flush();
      blocks.push(part);
    } else {
      current.push(part);
    }
  }
  flush();
  return blocks;
}

function buildBlock(el: Element, state: WalkState): ImportNode[] {
  const meta = metaFor("html");
  const tag = el.tagName.toLowerCase();
  if (tag === "p" || tag === "div") {
    return mixedBlockParts(el, state, "paragraph");
  }
  if (tag >= "h1" && tag <= "h6") {
    const level = headingLevel(tag);
    if (tag === "h1" || tag === "h4" || tag === "h5" || tag === "h6") state.headingClamped = true;
    return mixedBlockParts(el, state, "heading", level);
  }
  if (tag === "pre") {
    const code = (el.textContent ?? "").replace(/\n+$/, "");
    if (code.trim().length === 0) return [];
    return [{ kind: "codeBlock", text: code, meta }];
  }
  if (tag === "ul" || tag === "ol") return [buildList(el, tag === "ol", state)];
  if (tag === "table") return buildTable(el, state);
  if (tag === "hr") return [{ kind: "divider", meta }];
  state.degradedTags.add(tag);
  return mixedBlockParts(el, state, "paragraph");
}

function buildList(el: Element, ordered: boolean, state: WalkState): ImportNode {
  const meta = metaFor("html");
  const items: ImportNode[][] = [];
  for (const child of Array.from(el.children)) {
    if (child.tagName.toLowerCase() !== "li") {
      state.degradedTags.add(child.tagName.toLowerCase());
      continue;
    }
    const blocks = buildListItem(child as Element, state);
    if (blocks.length > 0) items.push(blocks);
  }
  if (ordered) return { kind: "orderedList", items, ordered: true, meta };
  return { kind: "bulletList", items, ordered: false, meta };
}

function buildListItem(li: Element, state: WalkState): ImportNode[] {
  const meta = metaFor("html");
  const inline: InlineNode[] = [];
  const blocks: ImportNode[] = [];
  const flush = (): void => {
    const kept = inline.filter((n) => n.kind !== "text" || n.text.trim().length > 0);
    if (kept.length > 0) blocks.push({ kind: "paragraph", children: [...kept], meta });
    inline.length = 0;
  };
  for (const child of Array.from(li.childNodes)) {
    if (child.nodeType === 3) {
      const t = (child.textContent ?? "").replace(/\s+/g, " ");
      if (t.trim()) inline.push(textNode(t.trim(), [], "html"));
      continue;
    }
    if (child.nodeType !== 1) continue;
    const kid = child as Element;
    const tag = kid.tagName.toLowerCase();
    if (tag === "ul" || tag === "ol") {
      flush();
      blocks.push(buildList(kid, tag === "ol", state));
    } else if (BLOCK_TAGS.has(tag)) {
      flush();
      blocks.push(...buildBlock(kid, state));
    } else {
      for (const part of collectMixed(kid, [], state)) {
        if (isImportImage(part)) {
          flush();
          blocks.push(part);
        } else {
          inline.push(part);
        }
      }
    }
  }
  flush();
  return blocks;
}

function buildTable(el: Element, state: WalkState): ImportNode[] {
  const meta = metaFor("html");
  const rows: TableCell[][] = [];
  let headerRow = false;
  const rowEls = Array.from(el.querySelectorAll("tr")).filter((tr) => tr.closest("table") === el);
  rowEls.forEach((tr, rowIndex) => {
    const cells: TableCell[] = [];
    const cellEls = Array.from(tr.children).filter((c) => {
      const t = (c as Element).tagName.toLowerCase();
      return t === "td" || t === "th";
    });
    cellEls.forEach((cellEl) => {
      const c = cellEl as Element;
      if (c.tagName.toLowerCase() === "th" && rowIndex === 0) headerRow = true;
      const nested = c.querySelector("table");
      if (nested) {
        state.degradedTags.add("table-nested");
        cells.push({
          children: [textNode((c.textContent ?? "").replace(/\s+/g, " ").trim(), [], "html")],
        });
        return;
      }
      const inlines: InlineNode[] = [];
      for (const part of collectMixed(c, [], state)) {
        if (isImportImage(part)) {
          state.tableImageFallbacks += 1;
          if (part.alt?.trim()) inlines.push(textNode(part.alt, [], "html"));
        } else {
          inlines.push(part);
        }
      }
      const kept = inlines.filter((n) => n.kind !== "text" || n.text.trim().length > 0);
      cells.push({ children: kept.length > 0 ? kept : [textNode("", [], "html")] });
    });
    if (cells.length > 0) rows.push(cells);
  });
  if (rows.length === 0) {
    state.degradedTags.add("table-empty");
    return [];
  }
  return [{ kind: "table", rows, headerRow, meta }];
}
