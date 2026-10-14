import { describe, expect, it } from "vitest";
import type { ScoreConversionContent } from "../../contracts/scoreConversion";
import {
  addTable,
  changedCells,
  clearRoute,
  createMatrix,
  createModule2,
  emptyDraft,
  isShared,
  setCells,
  setShared,
  tableFor,
  toContent,
  toDraft,
  type DraftContent,
  type DraftMatrix,
} from "../draft";
import { editorReducer, initialEditorState, isDirty, HISTORY_LIMIT } from "../editorHistory";
import { cellError, quickValidateTable } from "../quickValidate";

function withMatrix(): { draft: DraftContent; id: string } {
  const added = addTable(emptyDraft(), "math", "full_lower", createMatrix(2, 2));
  const { id } = added;
  let { draft } = added;
  const patches = [];
  for (let r = 0; r <= 2; r += 1) for (let c = 0; c <= 2; c += 1) patches.push({ row: r, col: c, value: 200 + 10 * (r + c) });
  draft = setCells(draft, "math", id, patches);
  return { draft, id };
}

describe("draft model", () => {
  it("creates empty tables whose cells are null and sized (ops + 1)", () => {
    const matrix = createMatrix(25, 25);
    expect(matrix.cells).toHaveLength(26);
    expect(matrix.cells[0]).toHaveLength(26);
    expect(matrix.cells[25]![25]).toBeNull();
    expect(createModule2(20).scores).toHaveLength(21);
  });

  it("sets cells without mutating the previous draft", () => {
    const { draft, id } = withMatrix();
    const next = setCells(draft, "math", id, [{ row: 1, col: 1, value: 700 }]);
    expect((draft.sections.math.tables[id] as DraftMatrix).cells[1]![1]).toBe(220);
    expect((next.sections.math.tables[id] as DraftMatrix).cells[1]![1]).toBe(700);
    // Out-of-range patches are ignored rather than growing the table.
    const same = setCells(next, "math", id, [{ row: 9, col: 9, value: 800 }]);
    expect((same.sections.math.tables[id] as DraftMatrix).cells).toHaveLength(3);
  });

  it("shares a matrix between both full routes explicitly, and splits it again into a copy", () => {
    const { draft, id } = withMatrix();
    expect(isShared(draft, "math")).toBe(false);
    const shared = setShared(draft, "math", true);
    expect(isShared(shared, "math")).toBe(true);
    expect(tableFor(shared, "math", "full_higher")?.id).toBe(id);
    const split = setShared(shared, "math", false);
    const higher = tableFor(split, "math", "full_higher");
    expect(isShared(split, "math")).toBe(false);
    expect(higher?.id).not.toBe(id);
    expect(higher?.table).toEqual(tableFor(split, "math", "full_lower")?.table);
    // Editing the copy no longer touches the lower route.
    const edited = setCells(split, "math", higher!.id, [{ row: 0, col: 0, value: 800 }]);
    expect((tableFor(edited, "math", "full_lower")!.table as DraftMatrix).cells[0]![0]).toBe(200);
  });

  it("removes a route and any table nothing references", () => {
    const { draft } = withMatrix();
    const shared = setShared(draft, "math", true);
    const onlyHigher = clearRoute(shared, "math", "full_lower");
    expect(Object.keys(onlyHigher.sections.math.tables)).toHaveLength(1);
    expect(Object.keys(clearRoute(onlyHigher, "math", "full_higher").sections.math.tables)).toHaveLength(0);
  });

  it("marks only changed cells against the base, and everything when the table is new or resized", () => {
    const { draft, id } = withMatrix();
    const edited = setCells(draft, "math", id, [{ row: 2, col: 1, value: 790 }]);
    expect([...changedCells(edited, draft, "math", id)]).toEqual(["2,1"]);
    expect(changedCells(edited, null, "math", id).size).toBe(9);
    const resized = addTable(emptyDraft(), "math", "full_lower", createMatrix(3, 3));
    expect(changedCells(resized.draft, draft, "math", resized.id).size).toBe(16);
  });

  it("round-trips wire content and withholds it while any cell is still text", () => {
    const { draft } = withMatrix();
    const { content, invalid } = toContent(draft);
    expect(invalid).toEqual([]);
    expect(toDraft(content as ScoreConversionContent)).toEqual(draft);
    const id = Object.keys(draft.sections.math.tables)[0]!;
    const broken = setCells(draft, "math", id, [{ row: 1, col: 2, value: "abc" }]);
    const out = toContent(broken);
    expect(out.content).toBeNull();
    expect(out.invalid).toEqual([{ section: "math", tableId: id, row: 1, col: 2, text: "abc" }]);
  });

  it("keeps stored ranges in 1D tables and shows them as points to the wire format", () => {
    const content: ScoreConversionContent = {
      schemaVersion: 1,
      sections: { math: { tables: { s: { kind: "module2", operational: 1, scores: [200, { low: 300, high: 320 }] } }, assign: { m2_lower_only: ["s"] } } },
    };
    expect(toContent(toDraft(content)).content?.sections.math?.tables.s).toEqual(content.sections.math?.tables.s);
  });
});

describe("quick validation", () => {
  it("accepts 200-800 multiples of 10 and flags everything else with a reason", () => {
    for (const ok of [200, 210, 800]) expect(cellError(ok)).toBeNull();
    expect(cellError(null)).toBe("No score entered.");
    expect(cellError("abc")).toContain("not a whole number");
    expect(cellError(190)).toContain("between 200 and 800");
    expect(cellError(810)).toContain("between 200 and 800");
    expect(cellError(205)).toContain("multiples of 10");
  });

  it("warns, but never errors, on a score lower than its neighbours", () => {
    const { draft, id } = withMatrix();
    const edited = setCells(draft, "math", id, [{ row: 1, col: 1, value: 200 }]);
    const feedback = quickValidateTable(edited.sections.math.tables[id]!);
    expect(feedback.errors.size).toBe(0);
    expect(feedback.warnings.get("1,1")).toContain("lower than the previous Module 2 value");
  });
});

describe("editor history", () => {
  it("undoes, redoes and clears redo on a new edit", () => {
    const { draft, id } = withMatrix();
    let state = initialEditorState(draft);
    const v1 = setCells(state.draft, "math", id, [{ row: 0, col: 0, value: 300 }]);
    const v2 = setCells(v1, "math", id, [{ row: 0, col: 0, value: 400 }]);
    state = editorReducer(editorReducer(state, { type: "edit", next: v1 }), { type: "edit", next: v2 });
    expect(isDirty(state)).toBe(true);
    state = editorReducer(state, { type: "undo" });
    expect(state.draft).toEqual(v1);
    state = editorReducer(state, { type: "redo" });
    expect(state.draft).toEqual(v2);
    state = editorReducer(editorReducer(state, { type: "undo" }), { type: "edit", next: setCells(v1, "math", id, [{ row: 0, col: 0, value: 500 }]) });
    expect(state.future).toHaveLength(0);
    expect(editorReducer(state, { type: "redo" })).toBe(state);
  });

  it("ignores an edit that changes nothing, tracks saves, and restarts on reset", () => {
    const { draft, id } = withMatrix();
    let state = initialEditorState(draft);
    expect(editorReducer(state, { type: "edit", next: structuredClone(draft) })).toBe(state);
    state = editorReducer(state, { type: "edit", next: setCells(draft, "math", id, [{ row: 0, col: 0, value: 300 }]) });
    state = editorReducer(state, { type: "saved", content: state.draft });
    expect(isDirty(state)).toBe(false);
    expect(state.past).toHaveLength(1);
    expect(editorReducer(state, { type: "reset", content: draft })).toEqual(initialEditorState(draft));
  });

  it("bounds the undo history", () => {
    const { draft, id } = withMatrix();
    let state = initialEditorState(draft);
    for (let i = 0; i < HISTORY_LIMIT + 20; i += 1) {
      state = editorReducer(state, { type: "edit", next: setCells(state.draft, "math", id, [{ row: 0, col: 0, value: 200 + 10 * ((i % 50) + 1) }]) });
    }
    expect(state.past).toHaveLength(HISTORY_LIMIT);
  });
});
