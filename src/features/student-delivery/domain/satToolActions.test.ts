import { describe, expect, it, vi } from "vitest";
import { runSatToolAction, type SatToolActionBinding, type SatToolActionId } from "./satToolActions";

const ALL_ACTIONS: readonly SatToolActionId[] = [
  "toggleCalculator",
  "toggleReference",
  "toggleLineReader",
  "toggleHighlights",
  "toggleEliminatorMode",
  "toggleMarkForReview",
  "questionMenu",
  "toggleDirections",
  "toggleNotes",
  "toggleTimerVisibility",
  "openHelp",
  "openShortcuts",
  "openBreakConfirm",
  "nextQuestion",
  "previousQuestion",
  "zoomIn",
  "zoomOut",
  "zoomReset",
];

function binding(): SatToolActionBinding & Record<string, ReturnType<typeof vi.fn>> {
  const fn = () => vi.fn();
  return {
    calculator: fn(),
    reference: fn(),
    lineReader: fn(),
    highlights: fn(),
    eliminatorMode: fn(),
    markForReview: fn(),
    questionMenu: fn(),
    directions: fn(),
    notes: fn(),
    timerVisibility: fn(),
    help: fn(),
    shortcuts: fn(),
    breakConfirm: fn(),
    nextQuestion: fn(),
    previousQuestion: fn(),
    zoomIn: fn(),
    zoomOut: fn(),
    zoomReset: fn(),
  };
}

describe("satToolActions", () => {
  it("converges every action id on exactly one bound command", () => {
    for (const action of ALL_ACTIONS) {
      const b = binding();
      runSatToolAction(b, action);
      const calls = Object.values(b).filter((fn) => (fn as ReturnType<typeof vi.fn>).mock.calls.length > 0);
      expect(calls).toHaveLength(1);
    }
  });

  it("maps representative actions to their commands", () => {
    const b = binding();
    runSatToolAction(b, "toggleCalculator");
    runSatToolAction(b, "openHelp");
    runSatToolAction(b, "nextQuestion");
    runSatToolAction(b, "zoomReset");
    expect(b.calculator).toHaveBeenCalledTimes(1);
    expect(b.help).toHaveBeenCalledTimes(1);
    expect(b.nextQuestion).toHaveBeenCalledTimes(1);
    expect(b.zoomReset).toHaveBeenCalledTimes(1);
    expect(b.reference).not.toHaveBeenCalled();
    expect(b.shortcuts).not.toHaveBeenCalled();
  });
});
