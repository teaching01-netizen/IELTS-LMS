import { useEffect, useRef, useState } from 'react';
import { resolveStudentExamViewportPolicy } from './studentExamViewportPolicy';

export interface StudentExamViewportState {
  /** Height (px) the exam shell must keep, or null before the first settle. */
  readonly stableExamHeight: number | null;
  readonly visualViewportHeight: number;
  readonly visualViewportOffsetTop: number;
  readonly keyboardOpen: boolean;
}

const EDITABLE_SELECTOR = 'input, textarea, select, [contenteditable="true"]';

/**
 * A rotation swaps both layout dimensions. A keyboard or Safari chrome change
 * only shrinks one dimension (usually height), so a one-sided change must not
 * be misread as an orientation change.
 */
const ORIENTATION_DIMENSION_CHANGE_PX = 40;

export function isEditableElement(target: Element): boolean {
  return (
    target.matches(EDITABLE_SELECTOR) ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

function readVisualViewport() {
  const visualViewport = window.visualViewport;
  return {
    visualHeight: visualViewport?.height ?? window.innerHeight,
    offsetTop: visualViewport?.offsetTop ?? 0,
    layoutWidth: window.innerWidth,
    layoutHeight: window.innerHeight,
  };
}

/**
 * Observes the browser and converts raw environment events into viewport
 * policy output. The hook never writes geometry itself — it returns state so
 * StudentExamShell can own the `--student-exam-height` CSS variable.
 *
 * The hook only listens to environment events:
 *   visualViewport.resize, visualViewport.scroll, window.resize,
 *   orientationchange, focusin, focusout
 * It never updates during `input`, `keydown`, or individual typed characters.
 */
export function useStudentExamViewport(active: boolean): StudentExamViewportState {
  const [state, setState] = useState<StudentExamViewportState>(() => {
    if (typeof window === 'undefined') {
      return {
        stableExamHeight: null,
        visualViewportHeight: 0,
        visualViewportOffsetTop: 0,
        keyboardOpen: false,
      };
    }
    const { visualHeight, offsetTop } = readVisualViewport();
    return {
      stableExamHeight: null,
      visualViewportHeight: visualHeight,
      visualViewportOffsetTop: offsetTop,
      keyboardOpen: false,
    };
  });

  const refsRef = useRef({
    editableFocused: false,
    previousStableHeight: null as number | null,
    previousOrientation: null as 'portrait' | 'landscape' | null,
    keyboardOpen: false,
    layoutWidth: 0,
    layoutHeight: 0,
  });

  useEffect(() => {
    if (!active || typeof window === 'undefined') {
      return;
    }

    const refs = refsRef.current;

    const evaluate = () => {
      const { visualHeight, offsetTop, layoutWidth, layoutHeight } = readVisualViewport();
      const currentOrientation: 'portrait' | 'landscape' =
        layoutWidth >= layoutHeight ? 'landscape' : 'portrait';
      const widthChanged =
        Math.abs(layoutWidth - refs.layoutWidth) > ORIENTATION_DIMENSION_CHANGE_PX;
      const heightChanged =
        Math.abs(layoutHeight - refs.layoutHeight) > ORIENTATION_DIMENSION_CHANGE_PX;
      const orientation =
        widthChanged && heightChanged
          ? currentOrientation
          : (refs.previousOrientation ?? currentOrientation);
      const output = resolveStudentExamViewportPolicy({
        previousStableHeight: refs.previousStableHeight,
        currentVisualHeight: visualHeight,
        layoutHeight,
        editableFocused: refs.editableFocused,
        orientation,
        previousOrientation: refs.previousOrientation,
        keyboardOpen: refs.keyboardOpen,
      });

      refs.layoutWidth = layoutWidth;
      refs.layoutHeight = layoutHeight;
      refs.previousStableHeight = output.stableExamHeight;
      refs.previousOrientation = orientation;
      refs.keyboardOpen = output.keyboardOpen;

      setState((current) => {
        if (
          current.stableExamHeight === output.stableExamHeight &&
          current.visualViewportHeight === visualHeight &&
          current.visualViewportOffsetTop === offsetTop &&
          current.keyboardOpen === output.keyboardOpen
        ) {
          return current;
        }
        return {
          stableExamHeight: output.stableExamHeight,
          visualViewportHeight: visualHeight,
          visualViewportOffsetTop: offsetTop,
          keyboardOpen: output.keyboardOpen,
        };
      });
    };

    const onFocusIn = (event: FocusEvent) => {
      refs.editableFocused =
        event.target instanceof Element && isEditableElement(event.target);
      evaluate();
    };

    const onFocusOut = (event: FocusEvent) => {
      const nextTarget = event.relatedTarget;
      refs.editableFocused =
        nextTarget instanceof Element && isEditableElement(nextTarget);
      evaluate();
    };

    const visualViewport = window.visualViewport;
    window.addEventListener('resize', evaluate);
    window.addEventListener('orientationchange', evaluate);
    visualViewport?.addEventListener('resize', evaluate);
    visualViewport?.addEventListener('scroll', evaluate);
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('focusout', onFocusOut);

    evaluate();

    return () => {
      window.removeEventListener('resize', evaluate);
      window.removeEventListener('orientationchange', evaluate);
      visualViewport?.removeEventListener('resize', evaluate);
      visualViewport?.removeEventListener('scroll', evaluate);
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('focusout', onFocusOut);
    };
  }, [active]);

  return state;
}
