/**
 * One tool action map for the SAT exam surface (Phase 0 foundation).
 *
 * Every trigger — TopBar button, More-menu row, keyboard shortcut — calls
 * the same action. There is deliberately no mouse version / keyboard version
 * / accessibility version split: click calculator and Ctrl+Alt+C converge on
 * the same application action.
 *
 * Actions are intent descriptors, not dispatchers: the shell/runner binds
 * them to real commands (runner dispatch, prefs update, modal open). This
 * keeps the domain pure and testable without React.
 */

export type SatToolActionId =
  | "toggleCalculator"
  | "toggleReference"
  | "toggleLineReader"
  | "toggleHighlights"
  | "toggleEliminatorMode"
  | "toggleMarkForReview"
  | "questionMenu"
  | "toggleDirections"
  | "toggleNotes"
  | "toggleTimerVisibility"
  | "openHelp"
  | "openShortcuts"
  | "openBreakConfirm"
  | "nextQuestion"
  | "previousQuestion"
  | "zoomIn"
  | "zoomOut"
  | "zoomReset";

export interface SatToolActionBinding {
  calculator: () => void;
  reference: () => void;
  lineReader: () => void;
  highlights: () => void;
  eliminatorMode: () => void;
  markForReview: () => void;
  questionMenu: () => void;
  directions: () => void;
  notes: () => void;
  timerVisibility: () => void;
  help: () => void;
  shortcuts: () => void;
  breakConfirm: () => void;
  nextQuestion: () => void;
  previousQuestion: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  zoomReset: () => void;
}

/**
 * Resolve an action id to its bound command. Single convergence point.
 *
 * The Record type is the exhaustiveness guard: adding an action id without
 * an arm fails compilation instead of silently no-op-ing at exam runtime.
 */
export function runSatToolAction(binding: SatToolActionBinding, action: SatToolActionId): void {
  const exhaustive: Record<SatToolActionId, () => void> = {
    toggleCalculator: binding.calculator,
    toggleReference: binding.reference,
    toggleLineReader: binding.lineReader,
    toggleHighlights: binding.highlights,
    toggleEliminatorMode: binding.eliminatorMode,
    toggleMarkForReview: binding.markForReview,
    questionMenu: binding.questionMenu,
    toggleDirections: binding.directions,
    toggleNotes: binding.notes,
    toggleTimerVisibility: binding.timerVisibility,
    openHelp: binding.help,
    openShortcuts: binding.shortcuts,
    openBreakConfirm: binding.breakConfirm,
    nextQuestion: binding.nextQuestion,
    previousQuestion: binding.previousQuestion,
    zoomIn: binding.zoomIn,
    zoomOut: binding.zoomOut,
    zoomReset: binding.zoomReset,
  };
  exhaustive[action]();
}


