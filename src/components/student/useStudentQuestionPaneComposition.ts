import { useLayoutEffect, useState, type RefObject } from 'react';

/**
 * P4 — composition is a function of the question pane's real usable width.
 *
 * The responsive failures this replaces came from deciding layout from the
 * device (`iPad === true`) or from the viewport, while the thing that actually
 * runs out of room is the question pane: a narrow split on a wide desktop, an
 * iPad in split view, and a phone all starve the same column.
 *
 * Contract:
 * - Measures the observed node's USABLE width — the scroll surface's
 *   padding box minus its horizontal padding and scrollbar, i.e. the width the
 *   question text actually gets. ResizeObserver's content box is preferred
 *   (exact, already padding- and scrollbar-excluded); the mount measure derives
 *   the same value from `clientWidth` minus computed padding, with a
 *   border-box rect as the last resort.
 * - Unmeasured (server render, detached node, jsdom) keeps the roomy
 *   composition. The first paint must never guess "narrow" and yank the flag
 *   into a metadata row on a wide screen.
 * - Only band changes commit state, so dragging the splitter across a
 *   threshold re-renders once instead of on every pointer frame.
 * - Deliberately NOT a CSS container query: `container-type` makes an element a
 *   containing block for `position: fixed` descendants, and this pane hosts
 *   inline fixed overlays (image zoom, highlight hint). Measurement keeps their
 *   viewport anchoring intact.
 */

/** Below this usable width the trailing flag column stops paying for itself. */
export const STUDENT_QUESTION_STACKED_FLAG_WIDTH_PX = 520;

export interface StudentQuestionPaneComposition {
  /** True once a real positive width has been measured. */
  readonly measured: boolean;
  /** Flag moves into a metadata row above the prompt; prompt takes full width. */
  readonly stackFlag: boolean;
}

const ROOMY_COMPOSITION: StudentQuestionPaneComposition = {
  measured: false,
  stackFlag: false,
};

function isPositive(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function horizontalPadding(node: HTMLElement): number {
  try {
    const styles = window.getComputedStyle(node);
    const left = Number.parseFloat(styles.paddingLeft);
    const right = Number.parseFloat(styles.paddingRight);
    return (isPositive(left) ? left : 0) + (isPositive(right) ? right : 0);
  } catch {
    return 0;
  }
}

/** Usable content width of a scroll surface, or null when unmeasurable. */
function readUsableWidth(node: HTMLElement | null): number | null {
  if (!node) {
    return null;
  }
  try {
    const clientWidth = node.clientWidth;
    if (isPositive(clientWidth)) {
      const usable = clientWidth - horizontalPadding(node);
      if (usable > 0) {
        return usable;
      }
    }
  } catch {
    /* A hostile DOM must never break the exam; fall through. */
  }
  try {
    // Last resort: border box (over-reports by the padding, but a real number
    // beats no composition signal at all).
    const rect = node.getBoundingClientRect();
    if (isPositive(rect.width)) {
      return rect.width;
    }
  } catch {
    /* A hostile DOM must never break the exam. */
  }
  return null;
}

/** Pure threshold policy, exported so the composition rules are testable. */
export function composeStudentQuestionPane(width: number): StudentQuestionPaneComposition {
  return {
    measured: true,
    stackFlag: width < STUDENT_QUESTION_STACKED_FLAG_WIDTH_PX,
  };
}

function sameComposition(
  left: StudentQuestionPaneComposition,
  right: StudentQuestionPaneComposition,
): boolean {
  return left.measured === right.measured && left.stackFlag === right.stackFlag;
}

export function useStudentQuestionPaneComposition(
  ref: RefObject<HTMLElement | null>,
): StudentQuestionPaneComposition {
  const [composition, setComposition] =
    useState<StudentQuestionPaneComposition>(ROOMY_COMPOSITION);

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) {
      return;
    }

    const commit = (width: number | null) => {
      if (width === null) return;
      const next = composeStudentQuestionPane(width);
      setComposition((previous) => (sameComposition(previous, next) ? previous : next));
    };

    // Sync measure on mount so the first committed frame already reflects the
    // live width instead of waiting for an observer tick.
    commit(readUsableWidth(node));

    if (typeof ResizeObserver === 'undefined') {
      return;
    }
    let disposed = false;
    const observer = new ResizeObserver((entries) => {
      if (disposed) return;
      const contentWidth = entries[0]?.contentRect?.width;
      commit(isPositive(contentWidth) ? contentWidth : readUsableWidth(ref.current ?? node));
    });
    try {
      observer.observe(node);
    } catch {
      observer.disconnect();
      return;
    }
    return () => {
      disposed = true;
      observer.disconnect();
    };
  }, [ref]);

  return composition;
}
