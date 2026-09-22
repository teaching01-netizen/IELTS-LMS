import type { SatExamFitPane } from "../../domain/satExamFit";

/**
 * What the auto-fit hook measures, as a port.
 *
 * The fit decision is a domain question ("does this rendering overflow?"), and
 * the answer can only come from the browser. Keeping the reading behind an
 * interface lets the walk be tested deterministically — jsdom lays nothing out,
 * so its panes are always unmeasurable — without teaching the hook about
 * layout, and keeps the DOM's business in one file.
 */
export interface SatExamFitProbe {
  /**
   * Every pane whose overflow decides the fit, in the pane's own coordinate
   * space. Empty when nothing on screen can be measured yet.
   */
  readPanes(root: Element | null): readonly SatExamFitPane[];
}

/**
 * The panes that can force a scroll. The Notes column is deliberately absent:
 * the fit runs when the module opens, with the column closed — and a pane that
 * is not part of the opening layout must not decide the opening zoom.
 */
const SAT_EXAM_FIT_PANE_SELECTORS = [
  "[data-sat-passage-scroll]",
  "[data-sat-question-scroll]",
] as const;

function readHeight(pane: Element, property: "scrollHeight" | "clientHeight"): number | null {
  const value = (pane as HTMLElement)[property];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function createSatExamFitProbe(): SatExamFitProbe {
  return {
    readPanes(root) {
      if (!root || typeof root.querySelectorAll !== "function") return [];
      const panes: SatExamFitPane[] = [];
      for (const selector of SAT_EXAM_FIT_PANE_SELECTORS) {
        for (const pane of root.querySelectorAll(selector)) {
          const scrollHeight = readHeight(pane, "scrollHeight");
          const clientHeight = readHeight(pane, "clientHeight");
          // A pane that reports no number is left out rather than reported as
          // zero: the domain reads the panes it was given, and a fabricated 0
          // would read as an overflow.
          if (scrollHeight === null || clientHeight === null) continue;
          panes.push({ scrollHeight, clientHeight });
        }
      }
      return panes;
    },
  };
}
