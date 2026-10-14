import {
  SECTION_KEYS,
  isStandalone,
  type MatrixTable,
  type Module2Table,
  type Score,
  type ScoreConversionContent,
  type SectionKey,
  type SectionPolicy,
  type Topology,
} from "../contracts/scoreConversion";

/**
 * Editing model. A cell is what the admin typed: an integer, a {low, high}
 * range carried over from a stored 1D table, null (empty), or the raw text of
 * something that is not an integer yet. The text is KEPT so the admin sees what
 * they pasted next to its error; saving is blocked until it is fixed, so
 * nothing is ever silently dropped or rewritten.
 */
export type DraftCell = number | Score | string | null;

export interface DraftMatrix {
  kind: "matrix";
  m1Operational: number;
  m2Operational: number;
  cells: DraftCell[][];
}

export interface DraftModule2 {
  kind: "module2";
  operational: number;
  scores: DraftCell[];
}

export type DraftTable = DraftMatrix | DraftModule2;

export interface DraftSection {
  tables: Record<string, DraftTable>;
  assign: Partial<Record<Topology, string[]>>;
}

export interface DraftContent {
  schemaVersion: 1;
  sections: Record<SectionKey, DraftSection>;
}

export interface CellPatch {
  row: number;
  col: number;
  value: DraftCell;
}

export interface InvalidCell {
  section: SectionKey;
  tableId: string;
  row: number;
  col: number;
  text: string;
}

/**
 * Typed text -> cell: blank is empty, up to nine digits are an integer, anything else
 * stays text. Longer digit runs stay text so they are reported as invalid instead of
 * becoming an imprecise or overflowing number on the wire; whitespace inside the text
 * (a pasted tab or newline) is collapsed so one cell can never break a row on export.
 */
export function parseCellText(text: string): DraftCell {
  const trimmed = text.replace(/\s+/g, " ").trim();
  if (trimmed === "") return null;
  return /^\d{1,9}$/.test(trimmed) ? Number.parseInt(trimmed, 10) : trimmed;
}

export function cellText(cell: DraftCell): string {
  if (cell === null) return "";
  if (typeof cell === "number" || typeof cell === "string") return String(cell);
  return cell.low === cell.high ? String(cell.low) : `${cell.low}–${cell.high}`;
}

/** Ranges come from stored 1D tables; they display but are only replaced, never edited in place. */
export function isRangeCell(cell: DraftCell): cell is Score {
  return typeof cell === "object" && cell !== null;
}

function emptySection(): DraftSection {
  return { tables: {}, assign: {} };
}

export function emptyDraft(): DraftContent {
  return { schemaVersion: 1, sections: { "reading-writing": emptySection(), math: emptySection() } };
}

function toDraftSection(section: SectionPolicy | undefined): DraftSection {
  const out = emptySection();
  if (!section) return out;
  for (const [id, table] of Object.entries(section.tables)) {
    out.tables[id] =
      table.kind === "matrix"
        ? { kind: "matrix", m1Operational: table.m1Operational, m2Operational: table.m2Operational, cells: table.cells.map((row) => [...row]) }
        : { kind: "module2", operational: table.operational, scores: [...table.scores] };
  }
  for (const [topology, ids] of Object.entries(section.assign)) {
    out.assign[topology as Topology] = [...(ids ?? [])];
  }
  return out;
}

export function toDraft(content: ScoreConversionContent | undefined): DraftContent {
  return {
    schemaVersion: 1,
    sections: { "reading-writing": toDraftSection(content?.sections["reading-writing"]), math: toDraftSection(content?.sections.math) },
  };
}

/**
 * Draft -> wire content. Cells that are still text are returned as `invalid`
 * and the content is withheld, so a save can never drop what the admin typed.
 */
export function toContent(draft: DraftContent): { content: ScoreConversionContent | null; invalid: InvalidCell[] } {
  const invalid: InvalidCell[] = [];
  const sections: ScoreConversionContent["sections"] = {};
  for (const section of SECTION_KEYS) {
    const source = draft.sections[section];
    const tables: SectionPolicy["tables"] = {};
    for (const [tableId, table] of Object.entries(source.tables)) {
      const note = (row: number, col: number, cell: DraftCell) => {
        if (typeof cell === "string") invalid.push({ section, tableId, row, col, text: cell });
      };
      if (table.kind === "matrix") {
        table.cells.forEach((cells, row) => cells.forEach((cell, col) => note(row, col, cell)));
        const wire: MatrixTable = {
          kind: "matrix",
          m1Operational: table.m1Operational,
          m2Operational: table.m2Operational,
          cells: table.cells.map((cells) => cells.map((cell) => (typeof cell === "number" ? cell : null))),
        };
        tables[tableId] = wire;
      } else {
        table.scores.forEach((cell, row) => note(row, 0, cell));
        const wire: Module2Table = {
          kind: "module2",
          operational: table.operational,
          scores: table.scores.map((cell) => (typeof cell === "string" ? null : cell)),
        };
        tables[tableId] = wire;
      }
    }
    sections[section] = { tables, assign: Object.fromEntries(Object.entries(source.assign).map(([k, v]) => [k, [...(v ?? [])]])) };
  }
  return { content: invalid.length > 0 ? null : { schemaVersion: 1, sections }, invalid };
}

export function createMatrix(m1Operational: number, m2Operational: number): DraftMatrix {
  return {
    kind: "matrix",
    m1Operational,
    m2Operational,
    cells: Array.from({ length: m1Operational + 1 }, () => Array.from<DraftCell>({ length: m2Operational + 1 }).fill(null)),
  };
}

export function createModule2(operational: number): DraftModule2 {
  return { kind: "module2", operational, scores: Array.from<DraftCell>({ length: operational + 1 }).fill(null) };
}

export function tableRows(table: DraftTable): number {
  return table.kind === "matrix" ? table.m1Operational + 1 : table.operational + 1;
}

export function tableCols(table: DraftTable): number {
  return table.kind === "matrix" ? table.m2Operational + 1 : 1;
}

export function cellAt(table: DraftTable, row: number, col: number): DraftCell {
  return table.kind === "matrix" ? (table.cells[row]?.[col] ?? null) : (table.scores[row] ?? null);
}

/** The table a route resolves through (its first assigned table). */
export function tableFor(draft: DraftContent, section: SectionKey, topology: Topology): { id: string; table: DraftTable } | null {
  const sectionPolicy = draft.sections[section];
  const id = sectionPolicy.assign[topology]?.[0];
  const table = id ? sectionPolicy.tables[id] : undefined;
  return id && table ? { id, table } : null;
}

function freshId(section: DraftSection, prefix: string): string {
  let n = Object.keys(section.tables).length + 1;
  while (section.tables[`${prefix}-${n}`]) n += 1;
  return `${prefix}-${n}`;
}

function cloneTable(table: DraftTable): DraftTable {
  return table.kind === "matrix"
    ? { ...table, cells: table.cells.map((row) => [...row]) }
    : { ...table, scores: [...table.scores] };
}

function updateSection(draft: DraftContent, section: SectionKey, change: (s: DraftSection) => DraftSection): DraftContent {
  return { ...draft, sections: { ...draft.sections, [section]: change(draft.sections[section]) } };
}

/** Adds `table` and assigns it to `topology` (replacing that route's assignment). */
export function addTable(draft: DraftContent, section: SectionKey, topology: Topology, table: DraftTable): { draft: DraftContent; id: string } {
  const id = freshId(draft.sections[section], isStandalone(topology) ? "m2" : "matrix");
  return {
    id,
    draft: updateSection(draft, section, (s) => ({
      tables: { ...s.tables, [id]: table },
      assign: { ...s.assign, [topology]: [id] },
    })),
  };
}

/** Explicit shared assignment: both full routes read the same matrix. */
export function isShared(draft: DraftContent, section: SectionKey): boolean {
  const { assign } = draft.sections[section];
  const lower = assign.full_lower?.[0];
  return lower !== undefined && lower === assign.full_higher?.[0];
}

/** Turns sharing on (higher route reads the lower route's matrix) or off (higher gets its own copy). */
export function setShared(draft: DraftContent, section: SectionKey, shared: boolean): DraftContent {
  const current = draft.sections[section];
  const lowerId = current.assign.full_lower?.[0];
  if (shared) {
    if (!lowerId) return draft;
    return updateSection(draft, section, (s) => ({ ...s, assign: { ...s.assign, full_higher: [lowerId] } }));
  }
  const sharedId = current.assign.full_higher?.[0];
  const table = sharedId ? current.tables[sharedId] : undefined;
  if (!sharedId || !table || sharedId !== lowerId) return draft;
  const id = freshId(current, "matrix");
  return updateSection(draft, section, (s) => ({
    tables: { ...s.tables, [id]: cloneTable(table) },
    assign: { ...s.assign, full_higher: [id] },
  }));
}

/** Removes a route's assignment and any table nothing references any more. */
export function clearRoute(draft: DraftContent, section: SectionKey, topology: Topology): DraftContent {
  return updateSection(draft, section, (s) => {
    const assign = { ...s.assign };
    delete assign[topology];
    const used = new Set(Object.values(assign).flatMap((ids) => ids ?? []));
    const tables = Object.fromEntries(Object.entries(s.tables).filter(([id]) => used.has(id)));
    return { tables, assign };
  });
}

export function setCells(draft: DraftContent, section: SectionKey, tableId: string, patches: CellPatch[]): DraftContent {
  return updateSection(draft, section, (s) => {
    const table = s.tables[tableId];
    if (!table || patches.length === 0) return s;
    const next = cloneTable(table);
    for (const { row, col, value } of patches) {
      if (next.kind === "matrix") {
        const target = next.cells[row];
        if (target && col >= 0 && col < target.length) target[col] = value;
      } else if (col === 0 && row >= 0 && row < next.scores.length) {
        next.scores[row] = value;
      }
    }
    return { ...s, tables: { ...s.tables, [tableId]: next } };
  });
}

function sameCell(a: DraftCell, b: DraftCell): boolean {
  if (typeof a === "object" && a !== null && typeof b === "object" && b !== null) return a.low === b.low && a.high === b.high;
  return a === b;
}

/** `row,col` keys of cells that differ from the same table in `base`; all of them when the table is new or resized. */
export function changedCells(draft: DraftContent, base: DraftContent | null, section: SectionKey, tableId: string): Set<string> {
  const out = new Set<string>();
  const table = draft.sections[section].tables[tableId];
  if (!table) return out;
  const baseTable = base?.sections[section].tables[tableId];
  const sameShape = baseTable && baseTable.kind === table.kind && tableRows(baseTable) === tableRows(table) && tableCols(baseTable) === tableCols(table);
  for (let row = 0; row < tableRows(table); row += 1) {
    for (let col = 0; col < tableCols(table); col += 1) {
      if (!sameShape || !sameCell(cellAt(table, row, col), cellAt(baseTable, row, col))) out.add(`${row},${col}`);
    }
  }
  return out;
}

export function sameDraft(a: DraftContent, b: DraftContent): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
