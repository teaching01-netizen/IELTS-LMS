import { useState } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createMatrix, setCells, emptyDraft, addTable, type CellPatch, type DraftMatrix } from "../../model/draft";
import { ScoreGrid, type GridNotice } from "../ScoreGrid";

function matrix(m1 = 2, m2 = 2): DraftMatrix {
  const added = addTable(emptyDraft(), "math", "full_lower", createMatrix(m1, m2));
  const patches: CellPatch[] = [];
  for (let r = 0; r <= m1; r += 1) for (let c = 0; c <= m2; c += 1) patches.push({ row: r, col: c, value: 200 + 10 * (r + c) });
  return setCells(added.draft, "math", added.id, patches).sections.math.tables[added.id] as DraftMatrix;
}

function setup(overrides: Partial<Parameters<typeof ScoreGrid>[0]> = {}) {
  const onEdit = vi.fn();
  const onUndo = vi.fn();
  const onRedo = vi.fn();
  const onNotice = vi.fn<(notice: GridNotice | null) => void>();
  render(
    <ScoreGrid
      label="Math, lower route"
      table={matrix()}
      readOnly={false}
      changed={new Set(["1,1"])}
      errors={new Map([["2,2", "Scores must be multiples of 10."]])}
      warnings={new Map([["0,2", "lower than a neighbour"]])}
      onEdit={onEdit}
      onUndo={onUndo}
      onRedo={onRedo}
      onNotice={onNotice}
      {...overrides}
    />,
  );
  const cell = (row: number, col: number) => document.querySelector<HTMLElement>(`[data-cell="${row},${col}"]`)!;
  return { onEdit, onUndo, onRedo, onNotice, cell };
}

const paste = (el: Element, text: string) => fireEvent.paste(el, { clipboardData: { getData: () => text } });

describe("ScoreGrid", () => {
  it("is a labelled grid whose cells say what they are, whether they changed and what is wrong", () => {
    const { cell } = setup();
    expect(screen.getByRole("grid", { name: "Math, lower route" })).toBeInTheDocument();
    expect(cell(0, 0)).toHaveAccessibleName("Module 1 correct 0, Module 2 correct 0, score 200");
    expect(cell(1, 1)).toHaveAccessibleName(expect.stringContaining("changed from the active version"));
    expect(cell(2, 2)).toHaveAttribute("aria-invalid", "true");
    expect(cell(2, 2)).toHaveAccessibleName(expect.stringContaining("error: Scores must be multiples of 10."));
    expect(cell(0, 2)).toHaveAccessibleName(expect.stringContaining("warning: lower than a neighbour"));
    // Roving tabindex: exactly one tab stop.
    expect(document.querySelectorAll('[role="gridcell"][tabindex="0"]')).toHaveLength(1);
  });

  it("moves with the arrow keys and Tab, and lets Tab leave at the last cell", () => {
    const { cell } = setup();
    fireEvent.mouseDown(cell(0, 0));
    fireEvent.keyDown(cell(0, 0), { key: "ArrowRight" });
    expect(cell(0, 1)).toHaveAttribute("tabindex", "0");
    expect(cell(0, 1)).toHaveFocus();
    fireEvent.keyDown(cell(0, 1), { key: "ArrowDown" });
    expect(cell(1, 1)).toHaveFocus();
    fireEvent.keyDown(cell(1, 1), { key: "ArrowLeft" });
    fireEvent.keyDown(cell(1, 0), { key: "ArrowLeft" }); // clamps at the edge
    expect(cell(1, 0)).toHaveFocus();
    fireEvent.keyDown(cell(1, 0), { key: "Tab" });
    expect(cell(1, 1)).toHaveFocus();
    fireEvent.mouseDown(cell(2, 2));
    const leave = fireEvent.keyDown(cell(2, 2), { key: "Tab" });
    expect(leave).toBe(true); // not prevented: focus is allowed to leave
  });

  it("types over a cell and commits with Enter, moving down; Escape cancels", () => {
    const { cell, onEdit } = setup();
    fireEvent.mouseDown(cell(0, 0));
    fireEvent.keyDown(cell(0, 0), { key: "7" });
    const input = screen.getByRole("textbox", { name: "Edit Module 1 correct 0, Module 2 correct 0" });
    expect(input).toHaveValue("7");
    fireEvent.change(input, { target: { value: "790" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onEdit).toHaveBeenCalledWith([{ row: 0, col: 0, value: 790 }]);
    expect(cell(1, 0)).toHaveFocus();

    onEdit.mockClear();
    fireEvent.keyDown(cell(1, 0), { key: "Enter" });
    const second = screen.getByRole("textbox");
    expect(second).toHaveValue("210");
    fireEvent.change(second, { target: { value: "999" } });
    fireEvent.keyDown(second, { key: "Escape" });
    expect(onEdit).not.toHaveBeenCalled();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("keeps non-numeric text so the error stays visible, and does not report an unchanged cell", () => {
    const { cell, onEdit } = setup();
    fireEvent.doubleClick(cell(0, 1));
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "abc" } });
    fireEvent.blur(input);
    expect(onEdit).toHaveBeenCalledWith([{ row: 0, col: 1, value: "abc" }]);
    onEdit.mockClear();
    fireEvent.doubleClick(cell(0, 0));
    fireEvent.blur(screen.getByRole("textbox"));
    expect(onEdit).not.toHaveBeenCalled();
  });

  it("clears the selected rectangle with Delete", () => {
    const { cell, onEdit } = setup();
    fireEvent.mouseDown(cell(0, 0));
    fireEvent.keyDown(cell(0, 0), { key: "ArrowDown", shiftKey: true });
    fireEvent.keyDown(cell(1, 0), { key: "ArrowRight", shiftKey: true });
    fireEvent.keyDown(cell(1, 1), { key: "Delete" });
    expect(onEdit).toHaveBeenCalledWith([
      { row: 0, col: 0, value: null },
      { row: 0, col: 1, value: null },
      { row: 1, col: 0, value: null },
      { row: 1, col: 1, value: null },
    ]);
  });

  it("pastes a whole table with headers (blank top-left, CRLF) over every cell", () => {
    const { cell, onEdit, onNotice } = setup();
    const text = ["\t0\t1\t2", "0\t300\t310\t320", "1\t310\t320\t330", "2\t320\t330\t340", ""].join("\r\n");
    paste(cell(0, 0), text);
    const patches = onEdit.mock.calls[0]![0] as CellPatch[];
    expect(patches).toHaveLength(9);
    expect(patches[0]).toEqual({ row: 0, col: 0, value: 300 });
    expect(patches[8]).toEqual({ row: 2, col: 2, value: 340 });
    expect(onNotice).toHaveBeenLastCalledWith({ kind: "info", text: "Pasted the whole table (9 cells)." });
  });

  it("pastes a partial rectangle only where the selection is, and refuses one that does not fit", () => {
    const { cell, onEdit, onNotice } = setup();
    fireEvent.mouseDown(cell(1, 1));
    paste(cell(1, 1), "500\t510\n510\t520");
    expect(onEdit).toHaveBeenCalledWith([
      { row: 1, col: 1, value: 500 },
      { row: 1, col: 2, value: 510 },
      { row: 2, col: 1, value: 510 },
      { row: 2, col: 2, value: 520 },
    ]);
    onEdit.mockClear();
    fireEvent.mouseDown(cell(2, 2));
    paste(cell(2, 2), "500\t510\n510\t520");
    expect(onEdit).not.toHaveBeenCalled();
    expect(onNotice).toHaveBeenLastCalledWith(expect.objectContaining({ kind: "error", text: expect.stringContaining("does not fit") }));
  });

  it("copies the selection as TSV", () => {
    const { cell } = setup();
    fireEvent.mouseDown(cell(0, 0));
    fireEvent.keyDown(cell(0, 0), { key: "ArrowRight", shiftKey: true });
    const setData = vi.fn();
    fireEvent.copy(cell(0, 1), { clipboardData: { setData } });
    expect(setData).toHaveBeenCalledWith("text/plain", "200\t210");
  });

  it("undoes and redoes from the keyboard", () => {
    const { cell, onUndo, onRedo } = setup();
    fireEvent.keyDown(cell(0, 0), { key: "z", ctrlKey: true });
    fireEvent.keyDown(cell(0, 0), { key: "z", metaKey: true, shiftKey: true });
    fireEvent.keyDown(cell(0, 0), { key: "y", ctrlKey: true });
    expect(onUndo).toHaveBeenCalledTimes(1);
    expect(onRedo).toHaveBeenCalledTimes(2);
  });

  it("is read-only: no editing, no clearing, and a pasted table is refused with an explanation", () => {
    const { cell, onEdit, onNotice } = setup({ readOnly: true });
    expect(screen.getByRole("grid")).toHaveAttribute("aria-readonly", "true");
    fireEvent.mouseDown(cell(0, 0));
    fireEvent.keyDown(cell(0, 0), { key: "7" });
    fireEvent.keyDown(cell(0, 0), { key: "Enter" });
    fireEvent.keyDown(cell(0, 0), { key: "Delete" });
    fireEvent.doubleClick(cell(0, 0));
    paste(cell(0, 0), "1");
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(onEdit).not.toHaveBeenCalled();
    expect(onNotice).toHaveBeenLastCalledWith(expect.objectContaining({ kind: "error", text: expect.stringContaining("read-only") }));
  });

  it("renders a 1D table as one column of raw scores", () => {
    const table = { kind: "module2" as const, operational: 2, scores: [200, 300, { low: 400, high: 450 }] };
    setup({ table, label: "Standalone", errors: new Map(), warnings: new Map(), changed: new Set() });
    const grid = screen.getByRole("grid");
    expect(within(grid).getAllByRole("gridcell")).toHaveLength(3);
    expect(document.querySelector('[data-cell="2,0"]')).toHaveTextContent("400–450");
    expect(document.querySelector('[data-cell="2,0"]')).toHaveAccessibleName("Raw correct 2, score 400–450");
  });

  it("works as a controlled editor end to end", () => {
    function Harness() {
      const [table, setTable] = useState(matrix());
      return (
        <ScoreGrid
          label="Harness"
          table={table}
          readOnly={false}
          changed={new Set()}
          errors={new Map()}
          warnings={new Map()}
          onEdit={(patches) => setTable((current) => ({ ...current, cells: current.cells.map((row, r) => row.map((value, c) => patches.find((p) => p.row === r && p.col === c)?.value ?? value)) }))}
          onUndo={() => undefined}
          onRedo={() => undefined}
          onNotice={() => undefined}
        />
      );
    }
    render(<Harness />);
    const first = document.querySelector<HTMLElement>('[data-cell="0,0"]')!;
    fireEvent.mouseDown(first);
    paste(first, "800");
    expect(first).toHaveTextContent("800");
  });
});
