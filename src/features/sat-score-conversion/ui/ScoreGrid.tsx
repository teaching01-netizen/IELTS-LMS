import { useCallback, useEffect, useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent, type MouseEvent } from "react";
import { cellAt, cellText, isRangeCell, parseCellText, tableCols, tableRows, type CellPatch, type DraftTable } from "../model/draft";
import { cellKey } from "../model/quickValidate";
import { parsePaste, selectionTsv } from "../model/tsv";

interface Pos {
  row: number;
  col: number;
}

interface Selection {
  anchor: Pos;
  focus: Pos;
}

export interface GridNotice {
  kind: "error" | "info";
  text: string;
}

export interface ScoreGridProps {
  /** Accessible name of the grid, e.g. "Math, Module 1 plus lower Module 2". */
  label: string;
  table: DraftTable;
  readOnly: boolean;
  /** `row,col` keys edited relative to the base revision. */
  changed: ReadonlySet<string>;
  errors: ReadonlyMap<string, string>;
  warnings: ReadonlyMap<string, string>;
  onEdit: (patches: CellPatch[]) => void;
  onUndo: () => void;
  onRedo: () => void;
  onNotice: (notice: GridNotice | null) => void;
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

function rectOf(sel: Selection) {
  return {
    top: Math.min(sel.anchor.row, sel.focus.row),
    bottom: Math.max(sel.anchor.row, sel.focus.row),
    left: Math.min(sel.anchor.col, sel.focus.col),
    right: Math.max(sel.anchor.col, sel.focus.col),
  };
}

export function ScoreGrid({ label, table, readOnly, changed, errors, warnings, onEdit, onUndo, onRedo, onNotice }: ScoreGridProps) {
  const rows = tableRows(table);
  const cols = tableCols(table);
  const matrix = table.kind === "matrix";
  const rowName = matrix ? "Module 1 correct" : "Raw correct";
  const colName = "Module 2 correct";
  const rootRef = useRef<HTMLDivElement>(null);
  const [selection, setSelection] = useState<Selection>({ anchor: { row: 0, col: 0 }, focus: { row: 0, col: 0 } });
  const [editing, setEditing] = useState<{ pos: Pos; text: string } | null>(null);
  const dragging = useRef(false);
  const focusPending = useRef(false);
  const focus = selection.focus;
  const rect = useMemo(() => rectOf(selection), [selection]);

  // A different table (route/subject switch, resize) must not keep a stale cursor.
  useEffect(() => {
    setSelection({ anchor: { row: 0, col: 0 }, focus: { row: 0, col: 0 } });
    setEditing(null);
  }, [rows, cols, label]);

  const focusCell = useCallback((pos: Pos) => {
    rootRef.current?.querySelector<HTMLElement>(`[data-cell="${pos.row},${pos.col}"]`)?.focus({ preventScroll: false });
  }, []);

  // Move DOM focus after the render that follows a keyboard move.
  useEffect(() => {
    if (focusPending.current && !editing) {
      focusPending.current = false;
      focusCell(focus);
    }
  });

  const moveTo = (pos: Pos, extend: boolean) => {
    const next = { row: clamp(pos.row, 0, rows - 1), col: clamp(pos.col, 0, cols - 1) };
    focusPending.current = true;
    setSelection((current) => ({ anchor: extend ? current.anchor : next, focus: next }));
  };

  const startEditing = (pos: Pos, initial?: string) => {
    if (readOnly) return;
    setEditing({ pos, text: initial ?? cellText(cellAt(table, pos.row, pos.col)) });
  };

  const commitEditing = (move?: Pos) => {
    if (!editing) return;
    const { pos, text } = editing;
    setEditing(null);
    const value = parseCellText(text);
    const current = cellAt(table, pos.row, pos.col);
    const unchanged = isRangeCell(current) ? text === cellText(current) : cellText(current) === text.trim();
    if (!unchanged) onEdit([{ row: pos.row, col: pos.col, value }]);
    if (move) moveTo(move, false);
    else focusPending.current = true;
  };

  const clearSelection = () => {
    if (readOnly) return;
    const patches: CellPatch[] = [];
    for (let row = rect.top; row <= rect.bottom; row += 1) for (let col = rect.left; col <= rect.right; col += 1) patches.push({ row, col, value: null });
    onEdit(patches);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (editing) return; // the cell input owns the keyboard while editing
    const mod = event.metaKey || event.ctrlKey;
    if (mod && event.key.toLowerCase() === "z") {
      event.preventDefault();
      if (event.shiftKey) onRedo();
      else onUndo();
      return;
    }
    if (mod && event.key.toLowerCase() === "y") {
      event.preventDefault();
      onRedo();
      return;
    }
    if (mod && event.key.toLowerCase() === "a") {
      event.preventDefault();
      setSelection({ anchor: { row: 0, col: 0 }, focus: { row: rows - 1, col: cols - 1 } });
      return;
    }
    if (mod) return; // copy / paste / cut are clipboard events
    const extend = event.shiftKey;
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        return moveTo({ row: focus.row + 1, col: focus.col }, extend);
      case "ArrowUp":
        event.preventDefault();
        return moveTo({ row: focus.row - 1, col: focus.col }, extend);
      case "ArrowRight":
        event.preventDefault();
        return moveTo({ row: focus.row, col: focus.col + 1 }, extend);
      case "ArrowLeft":
        event.preventDefault();
        return moveTo({ row: focus.row, col: focus.col - 1 }, extend);
      case "Home":
        event.preventDefault();
        return moveTo({ row: focus.row, col: 0 }, extend);
      case "End":
        event.preventDefault();
        return moveTo({ row: focus.row, col: cols - 1 }, extend);
      case "PageDown":
        event.preventDefault();
        return moveTo({ row: focus.row + 10, col: focus.col }, extend);
      case "PageUp":
        event.preventDefault();
        return moveTo({ row: focus.row - 10, col: focus.col }, extend);
      case "Tab": {
        const forward = !event.shiftKey;
        const next = forward
          ? focus.col + 1 < cols ? { row: focus.row, col: focus.col + 1 } : focus.row + 1 < rows ? { row: focus.row + 1, col: 0 } : null
          : focus.col > 0 ? { row: focus.row, col: focus.col - 1 } : focus.row > 0 ? { row: focus.row - 1, col: cols - 1 } : null;
        if (!next) return; // at either end Tab leaves the grid
        event.preventDefault();
        return moveTo(next, false);
      }
      case "Enter":
      case "F2":
        event.preventDefault();
        return startEditing(focus);
      case "Delete":
      case "Backspace":
        event.preventDefault();
        return clearSelection();
      case "Escape":
        onNotice(null);
        return;
      default:
        if (event.key.length === 1 && !event.altKey && /[0-9]/.test(event.key)) {
          event.preventDefault();
          startEditing(focus, event.key);
        }
    }
  };

  const onCopy = (event: ClipboardEvent<HTMLDivElement>) => {
    if (editing) return;
    event.preventDefault();
    event.clipboardData.setData("text/plain", selectionTsv(table, rect.top, rect.left, rect.bottom, rect.right));
    onNotice({ kind: "info", text: `Copied ${(rect.bottom - rect.top + 1) * (rect.right - rect.left + 1)} cells.` });
  };

  const onCut = (event: ClipboardEvent<HTMLDivElement>) => {
    if (editing) return;
    onCopy(event);
    clearSelection();
  };

  const onPaste = (event: ClipboardEvent<HTMLDivElement>) => {
    if (editing) return;
    event.preventDefault();
    if (readOnly) {
      onNotice({ kind: "error", text: "This table is read-only. Open or create a draft to edit it." });
      return;
    }
    const result = parsePaste(event.clipboardData.getData("text/plain"), rows, cols, rect.top, rect.left);
    if (!result.ok) {
      onNotice({ kind: "error", text: result.errors.join(" ") });
      return;
    }
    const patches: CellPatch[] = [];
    result.values.forEach((line, r) => line.forEach((text, c) => patches.push({ row: result.row + r, col: result.col + c, value: parseCellText(text) })));
    onEdit(patches);
    onNotice({
      kind: "info",
      text: result.shape === "block" ? `Pasted ${patches.length} cells at row ${result.row}, column ${result.col}.` : `Pasted the whole table (${patches.length} cells).`,
    });
  };

  const onCellMouseDown = (event: MouseEvent, pos: Pos) => {
    if (editing) commitEditing();
    dragging.current = true;
    setSelection((current) => ({ anchor: event.shiftKey ? current.anchor : pos, focus: pos }));
  };

  useEffect(() => {
    const stop = () => {
      dragging.current = false;
    };
    window.addEventListener("mouseup", stop);
    return () => window.removeEventListener("mouseup", stop);
  }, []);

  return (
    // Keyboard, clipboard and pointer events of the whole grid are handled once here
    // (APG data-grid pattern); focus lives on the roving-tabindex cells inside.
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions
    <div
      ref={rootRef}
      className="max-h-[62vh] overflow-auto rounded-[var(--sat-staff-radius-card,14px)] border border-[var(--sat-staff-border-hairline,rgba(0,0,0,0.08))] bg-[var(--sat-staff-surface,#fff)]"
      onKeyDown={onKeyDown}
      onCopy={onCopy}
      onCut={onCut}
      onPaste={onPaste}
    >
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-to-interactive-role -- APG data grid: a native table given role="grid" so cells are keyboard-navigable. */}
      <table role="grid" aria-label={label} aria-rowcount={rows + 1} aria-colcount={cols + 1} aria-readonly={readOnly || undefined} className="border-separate border-spacing-0 text-[14px] tabular-nums">
        <caption className="sr-only">
          {label}. Arrow keys move, Enter edits, Delete clears, paste from a spreadsheet fills the selection.
        </caption>
        <thead>
          <tr>
            <th scope="col" className="sticky left-0 top-0 z-20 min-w-[88px] border-b border-r border-[var(--sat-staff-border-hairline,rgba(0,0,0,0.08))] bg-[var(--sat-staff-surface-muted,#f5f5f7)] px-2 py-2 text-left text-[12px] font-semibold text-[var(--sat-staff-text-secondary,#515154)]">
              {matrix ? "M1 ↓ M2 →" : "Raw ↓"}
            </th>
            {Array.from({ length: cols }, (_, col) => (
              <th key={col} scope="col" className="sticky top-0 z-10 min-w-[56px] border-b border-[var(--sat-staff-border-hairline,rgba(0,0,0,0.08))] bg-[var(--sat-staff-surface-muted,#f5f5f7)] px-2 py-2 text-center text-[12px] font-semibold text-[var(--sat-staff-text-secondary,#515154)]">
                {matrix ? col : "Score"}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }, (_, row) => (
            <tr key={row}>
              <th scope="row" className="sticky left-0 z-10 border-b border-r border-[var(--sat-staff-border-hairline,rgba(0,0,0,0.08))] bg-[var(--sat-staff-surface-muted,#f5f5f7)] px-2 py-1 text-left text-[12px] font-semibold text-[var(--sat-staff-text-secondary,#515154)]">
                {row}
              </th>
              {Array.from({ length: cols }, (_, col) => {
                const key = cellKey(row, col);
                const cell = cellAt(table, row, col);
                const error = errors.get(key);
                const warning = warnings.get(key);
                const isChanged = changed.has(key);
                const selected = row >= rect.top && row <= rect.bottom && col >= rect.left && col <= rect.right;
                const isFocus = row === focus.row && col === focus.col;
                const isEditing = editing?.pos.row === row && editing.pos.col === col;
                const text = cellText(cell);
                const description = [isChanged ? "changed from the active version" : null, error ? `error: ${error}` : null, warning ? `warning: ${warning}` : null].filter(Boolean).join(", ");
                return (
                  <td
                    key={col}
                    role="gridcell"
                    data-cell={key}
                    data-state={error ? "error" : warning ? "warning" : isChanged ? "changed" : "idle"}
                    tabIndex={isFocus ? 0 : -1}
                    aria-selected={selected}
                    aria-invalid={error ? true : undefined}
                    aria-label={`${rowName} ${row}${matrix ? `, ${colName} ${col}` : ""}, score ${text === "" ? "empty" : text}${description ? `, ${description}` : ""}`}
                    title={error ?? warning ?? undefined}
                    onMouseDown={(event) => onCellMouseDown(event, { row, col })}
                    onMouseEnter={() => {
                      if (dragging.current) setSelection((current) => ({ ...current, focus: { row, col } }));
                    }}
                    onDoubleClick={() => startEditing({ row, col })}
                    className={
                      "relative h-9 min-w-[56px] cursor-cell border-b border-r border-[var(--sat-staff-border-hairline,rgba(0,0,0,0.06))] p-0 text-center outline-none " +
                      (selected ? "bg-[var(--sat-staff-accent-soft,#e8f0fe)] " : isChanged ? "bg-[var(--sat-staff-warning-soft,#fff6e0)] " : "bg-[var(--sat-staff-surface,#fff)] ") +
                      (isFocus ? "ring-2 ring-inset ring-[var(--sat-staff-accent,#0071e3)] " : "") +
                      (error ? "text-[var(--sat-staff-danger,#b42318)] " : "text-[var(--sat-staff-text-primary,#1d1d1f)] ") +
                      (isChanged ? "font-semibold" : "")
                    }
                  >
                    {isEditing ? (
                      <input
                        // The input is mounted only by an explicit Enter/F2/double-click/typing gesture, so focus must move to it.
                        // eslint-disable-next-line jsx-a11y/no-autofocus
                        autoFocus
                        aria-label={`Edit ${rowName} ${row}${matrix ? `, ${colName} ${col}` : ""}`}
                        inputMode="numeric"
                        value={editing.text}
                        onChange={(event) => setEditing({ pos: editing.pos, text: event.target.value })}
                        onBlur={() => commitEditing()}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            commitEditing({ row: row + 1, col });
                          } else if (event.key === "Tab") {
                            event.preventDefault();
                            commitEditing({ row, col: event.shiftKey ? col - 1 : col + 1 });
                          } else if (event.key === "Escape") {
                            event.preventDefault();
                            event.stopPropagation();
                            setEditing(null);
                            focusPending.current = true;
                          }
                        }}
                        className="h-full w-full bg-transparent px-1 text-center outline-none"
                      />
                    ) : (
                      <span className="block px-1 leading-9">
                        {text}
                        {error ? (
                          <span aria-hidden="true" className="absolute right-0.5 top-0 text-[10px] font-bold text-[var(--sat-staff-danger,#b42318)]">!</span>
                        ) : warning ? (
                          <span aria-hidden="true" className="absolute right-0.5 top-0 text-[10px] font-bold text-[var(--sat-staff-warning,#9a6700)]">▾</span>
                        ) : null}
                      </span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
