/**
 * Phase 01 — resource guards (pure).
 *
 * enforceLimits() is the outer-bounds net: document caps on nodes, depth,
 * per-node characters, tables, and equations. Tables cap rows then columns,
 * then total cells so downstream adapters can rely on shape. No input is
 * ever thrown away silently: every cut records a static diagnostic plus a
 * named transformation.
 */
import type {
  ImportDocument,
  ImportMetadata,
  ImportNode,
  InlineNode,
  TableCell,
} from "../domain/importDocument";
import type { DiagnosticCode, ImportWarning } from "../domain/importResult";
import { DIAGNOSTIC_MESSAGES } from "../domain/diagnostics";
import { INGESTION_LIMITS } from "../domain/limits";

export interface EnforceLimitsOutcome {
  doc: ImportDocument;
  warnings: ImportWarning[];
  transformations: string[];
  truncated: boolean;
}

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

function truncateText(value: string, limit: number): string {
  return value.length > limit ? value.slice(0, limit) : value;
}

function capInline(
  inline: InlineNode,
  source: ImportMetadata["source"],
): { inline: InlineNode; codes: DiagnosticCode[]; notes: string[] } {
  const codes: DiagnosticCode[] = [];
  const notes: string[] = [];
  if (inline.kind === "text") {
    if (inline.text.length > INGESTION_LIMITS.textNodeChars) {
      codes.push("import.truncated.text");
      notes.push(
        "text capped chars " +
          inline.text.length +
          "->" +
          INGESTION_LIMITS.textNodeChars,
      );
      return {
        inline: {
          ...inline,
          text: truncateText(inline.text, INGESTION_LIMITS.textNodeChars),
        },
        codes,
        notes,
      };
    }
    return { inline, codes, notes };
  }
  if (inline.kind === "inlineMath" || inline.kind === "blockMath") {
    void source;
    if (inline.latex.length === 0) {
      codes.push("import.latex.empty");
      return {
        inline: { kind: "text", text: "", marks: [], meta: inline.meta },
        codes,
        notes,
      };
    }
    if (inline.latex.length > INGESTION_LIMITS.latexChars) {
      codes.push("import.truncated.text");
      codes.push("import.latex.invalid");
      notes.push(
        "latex capped chars " +
          inline.latex.length +
          "->" +
          INGESTION_LIMITS.latexChars,
      );
      return {
        inline: {
          kind: "text",
          text: truncateText(inline.latex, INGESTION_LIMITS.latexChars),
          marks: [],
          meta: inline.meta,
        },
        codes,
        notes,
      };
    }
    return { inline, codes, notes };
  }
  return { inline, codes, notes };
}

function capInlineList(
  items: InlineNode[],
  source: ImportMetadata["source"],
): { items: InlineNode[]; codes: DiagnosticCode[]; notes: string[] } {
  const codes: DiagnosticCode[] = [];
  const notes: string[] = [];
  const out: InlineNode[] = [];
  for (const inline of items) {
    const capped = capInline(inline, source);
    codes.push(...capped.codes);
    notes.push(...capped.notes);
    out.push(capped.inline);
  }
  return { items: out, codes, notes };
}

/**
 * Cap one table: rows, then per-row columns, then total cell budget.
 * Emits import.truncated.rows / .cols / .cells with counts on warnings.
 */
export function capTable(node: Extract<ImportNode, { kind: "table" }>): {
  node: ImportNode;
  codes: DiagnosticCode[];
  notes: string[];
  droppedRows: number;
  droppedCols: number;
  droppedCells: number;
} {
  const codes: DiagnosticCode[] = [];
  const notes: string[] = [];
  let droppedRows = 0;
  let droppedCols = 0;
  let droppedCells = 0;

  let rows = node.rows;
  if (rows.length > INGESTION_LIMITS.tableRows) {
    droppedRows = rows.length - INGESTION_LIMITS.tableRows;
    codes.push("import.truncated.rows");
    notes.push(
      "table capped rows " + node.rows.length + "->" + INGESTION_LIMITS.tableRows,
    );
    rows = rows.slice(0, INGESTION_LIMITS.tableRows);
  }
  const colCapped: TableCell[][] = rows.map((row) => {
    if (row.length > INGESTION_LIMITS.tableCols) {
      droppedCols += row.length - INGESTION_LIMITS.tableCols;
      if (!codes.includes("import.truncated.cols")) {
        codes.push("import.truncated.cols");
      }
      notes.push(
        "table capped cols " + row.length + "->" + INGESTION_LIMITS.tableCols,
      );
      return row.slice(0, INGESTION_LIMITS.tableCols);
    }
    return row;
  });
  let kept: TableCell[][] = colCapped;
  const totalCells = colCapped.reduce((sum, row) => sum + row.length, 0);
  if (totalCells > INGESTION_LIMITS.tableCells) {
    let remaining: number = INGESTION_LIMITS.tableCells;
    kept = [];
    for (const row of colCapped) {
      if (remaining <= 0) {
        droppedCells += row.length;
        continue;
      }
      if (row.length <= remaining) {
        kept.push(row);
        remaining -= row.length;
      } else {
        droppedCells += row.length - remaining;
        kept.push(row.slice(0, remaining));
        remaining = 0;
      }
    }
    if (!codes.includes("import.truncated.cells")) {
      codes.push("import.truncated.cells");
    }
    notes.push("table capped cells ->" + INGESTION_LIMITS.tableCells);
  }
  return {
    node: { ...node, rows: kept },
    codes: [...new Set(codes)],
    notes,
    droppedRows,
    droppedCols,
    droppedCells,
  };
}

interface DepthWalk {
  nodes: ImportNode[];
  flattened: number;
}

function listDepth(node: ImportNode, current: number): number {
  if (node.kind !== "bulletList" && node.kind !== "orderedList") return current;
  let max = current + 1;
  for (const item of node.items) {
    for (const child of item) {
      max = Math.max(max, listDepth(child, current + 1));
    }
  }
  return max;
}

function flattenDeepLists(nodes: ImportNode[], depth: number): DepthWalk {
  let flattened = 0;
  const out: ImportNode[] = [];
  for (const node of nodes) {
    if (node.kind === "bulletList" || node.kind === "orderedList") {
      if (depth + 1 > INGESTION_LIMITS.htmlDepth) {
        for (const item of node.items) {
          for (const child of item) {
            flattened += 1;
            if (child.kind === "bulletList" || child.kind === "orderedList") {
              const inner = flattenDeepLists([child], depth);
              flattened += inner.flattened;
              out.push(...inner.nodes);
            } else {
              out.push(child);
            }
          }
        }
        continue;
      }
      const items: ImportNode[][] = node.items.map((item) => {
        const walked = flattenDeepLists(item, depth + 1);
        flattened += walked.flattened;
        return walked.nodes;
      });
      if (node.kind === "bulletList") { out.push({ ...node, items }); } else { out.push({ kind: "orderedList", items, ordered: true, meta: node.meta }); }
    } else {
      out.push(node);
    }
  }
  return { nodes: out, flattened };
}

/**
 * Enforce document-level limits. Never throws for over-limit input;
 * truncates plus records diagnostics. Deterministic for fixed input.
 */
export function enforceLimits(doc: ImportDocument): EnforceLimitsOutcome {
  const warnings: ImportWarning[] = [];
  const transformations: string[] = [];
  let truncated = false;

  let nodes: ImportNode[] = [];
  for (const node of doc.nodes) {
    if (node.kind === "paragraph" || node.kind === "heading") {
      const capped = capInlineList(node.children, doc.sourceMeta.source);
      for (const code of new Set(capped.codes)) {
        warn(warnings, code, 1);
        truncated = true;
      }
      for (const note of capped.notes) pushTransformation(transformations, note);
      if (node.kind === "paragraph") { nodes.push({ ...node, children: capped.items }); } else { nodes.push({ kind: "heading", level: node.level, children: capped.items, meta: node.meta }); }
    } else if (node.kind === "codeBlock") {
      if (node.text.length > INGESTION_LIMITS.textNodeChars) {
        warn(warnings, "import.truncated.text", 1);
        pushTransformation(
          transformations,
          "codeBlock capped chars " +
            node.text.length +
            "->" +
            INGESTION_LIMITS.textNodeChars,
        );
        truncated = true;
        nodes.push({
          ...node,
          text: truncateText(node.text, INGESTION_LIMITS.textNodeChars),
        });
      } else {
        nodes.push(node);
      }
    } else if (node.kind === "table") {
      const capped = capTable(node);
      const inlineCappedRows: TableCell[][] = capped.node.kind === "table"
        ? (capped.node.rows as TableCell[][]).map((row) =>
            row.map((cell) => {
              const inner = capInlineList(cell.children, doc.sourceMeta.source);
              for (const code of new Set(inner.codes)) {
                warn(warnings, code, 1);
                truncated = true;
              }
              for (const note of inner.notes) {
                pushTransformation(transformations, note);
              }
              return { children: inner.items };
            }),
          )
        : [];
      if (capped.droppedRows > 0) {
        warn(warnings, "import.truncated.rows", capped.droppedRows);
        truncated = true;
      }
      if (capped.droppedCols > 0) {
        warn(warnings, "import.truncated.cols", capped.droppedCols);
        truncated = true;
      }
      if (capped.droppedCells > 0) {
        warn(warnings, "import.truncated.cells", capped.droppedCells);
        truncated = true;
      }
      for (const note of capped.notes) pushTransformation(transformations, note);
      if (capped.node.kind === "table") { nodes.push({ ...capped.node, rows: inlineCappedRows }); }
    } else if (node.kind === "bulletList" || node.kind === "orderedList") {
      const depth = listDepth(node, 0);
      if (depth > INGESTION_LIMITS.htmlDepth) {
        const walked = flattenDeepLists([node], 0);
        warn(warnings, "import.truncated.depth", 1);
        warn(warnings, "import.list.flattened", walked.flattened);
        pushTransformation(transformations, "list flattened depth " + depth);
        truncated = true;
        nodes.push(...walked.nodes);
      } else {
        nodes.push(node);
      }
    } else {
      nodes.push(node);
    }
  }

  if (nodes.length > INGESTION_LIMITS.nodeCount) {
    const dropped = nodes.length - INGESTION_LIMITS.nodeCount;
    warn(warnings, "import.truncated.nodes", dropped);
    pushTransformation(
      transformations,
      "nodes capped " + doc.nodes.length + "->" + INGESTION_LIMITS.nodeCount,
    );
    truncated = true;
    nodes = nodes.slice(0, INGESTION_LIMITS.nodeCount);
  }

  return {
    doc: { ...doc, nodes },
    warnings,
    transformations,
    truncated,
  };
}
