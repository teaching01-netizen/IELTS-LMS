import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createSatReadingPreferences, type SatReadingPreferences } from '../../domain/satReadingPreferences';
import {
  resolveSatReadingLayout,
  type SatReadingLayoutDecision,
  type SatReadingPresentation,
} from '../../domain/satReadingLayout';

/**
 * The one measured layout truth for the SAT reading surface.
 *
 * The rule this exists to enforce:
 *
 *     Measure the real workspace once → make one layout decision →
 *     Workspace, Notes, Display, and auto-fit consume that same decision.
 *
 * Everything responsive about the exam used to be derived separately: the
 * workspace asked a 767px media query, the notes host asked 767/1024, Display
 * asked its own height rule, and the auto-fit asked the workspace's query
 * again. Four answers to one question is four ways to disagree, and under screen
 * zoom they genuinely do — a media query reads the physical viewport while the
 * panes are laid out in the scaled logical plane.
 *
 * So this provider owns exactly two things: the browser measurement of the
 * workspace the reading layout registered, and the split-drag latch (below).
 * The decision itself is `resolveSatReadingLayout`, a pure function.
 */

export interface SatReadingLayoutContextValue {
  /** True once a workspace has registered and reported a usable box. */
  measured: boolean;
  /** The workspace's logical layout width (never a visual/scaled width). */
  width: number;
  /** The workspace's logical layout height. */
  height: number;
  /**
   * What the reading layout should be. While the student is dragging the divider
   * this holds the presentation that was on screen when the drag started (see
   * `setSplitInteractionActive`); every other field still reports the
   * measurement.
   */
  decision: SatReadingLayoutDecision;
  /** Registers the workspace whose box the decision is measured from. */
  registerWorkspace: (element: HTMLElement | null, hasStimulus: boolean) => void;
  /** Latches the current presentation for the duration of a pointer drag. */
  setSplitInteractionActive: (active: boolean) => void;
}

/**
 * The box used before any workspace has registered.
 *
 * A workspace that has not been measured yet keeps the classic two-pane
 * arrangement rather than guessing a mode from nothing; the measurement lands in
 * the same commit (the ref callback fires during it), so this is a first-frame
 * value and not a mode anybody sees in a real browser. Rendering a layout
 * outside the provider — a unit test, a harness — gets the same baseline.
 */
const SAT_READING_BASELINE_WIDTH = 1024;
const SAT_READING_BASELINE_HEIGHT = 768;

/**
 * The box assumed before a workspace has registered: the document viewport,
 * because that is what the exam fills, and the classic desktop box where there
 * is no document at all. It is a first-frame value — the workspace reports its
 * real box in the same commit it mounts — and using the viewport means a phone
 * does not paint two panes for one frame before stacking them.
 */
export function satReadingBaselineBox(): { width: number; height: number } {
  if (typeof window !== 'undefined' && window.innerWidth > 0 && window.innerHeight > 0) {
    return { width: window.innerWidth, height: window.innerHeight };
  }
  return { width: SAT_READING_BASELINE_WIDTH, height: SAT_READING_BASELINE_HEIGHT };
}

function satReadingBaselineDecision(
  preferences: Pick<SatReadingPreferences, 'textScale' | 'splitRatio'>,
  box: { width: number; height: number },
): SatReadingLayoutDecision {
  return resolveSatReadingLayout({
    workspaceWidth: box.width,
    workspaceHeight: box.height,
    hasStimulus: true,
    textScale: preferences.textScale,
    splitRatio: preferences.splitRatio,
  });
}

const DEFAULT_CONTEXT: SatReadingLayoutContextValue = {
  measured: false,
  width: SAT_READING_BASELINE_WIDTH,
  height: SAT_READING_BASELINE_HEIGHT,
  decision: satReadingBaselineDecision(
    createSatReadingPreferences(),
    satReadingBaselineBox(),
  ),
  registerWorkspace: () => undefined,
  setSplitInteractionActive: () => undefined,
};

const SatReadingLayoutContext = createContext<SatReadingLayoutContextValue>(DEFAULT_CONTEXT);

export function useSatReadingLayout(): SatReadingLayoutContextValue {
  return useContext(SatReadingLayoutContext);
}

/**
 * The logical content box of one observer entry.
 *
 * `contentBoxSize` is the box the browser laid out, in the same logical space
 * CSS uses. `contentRect` is the legacy spelling of the same value for engines
 * that do not report the newer field.
 */
function satReadingEntryBox(
  entry: ResizeObserverEntry,
): { width: number; height: number } | null {
  const boxes = entry.contentBoxSize as ResizeObserverSize[] | ResizeObserverSize | undefined;
  const first = Array.isArray(boxes) ? boxes[0] : boxes;
  const width = first?.inlineSize ?? entry.contentRect?.width;
  const height = first?.blockSize ?? entry.contentRect?.height;
  if (width == null || height == null) return null;
  if (!(width > 0) || !(height > 0)) return null;
  return { width, height };
}

export interface SatReadingLayoutProviderProps {
  /** Text size and split ratio change the decision; nothing else does. */
  preferences: Pick<SatReadingPreferences, 'textScale' | 'splitRatio'>;
  /**
   * Test seam: the workspace's box, instead of reading it off the DOM. A
   * non-layout environment (jsdom) reports every element as 0×0, so the
   * measurement under test is supplied directly.
   */
  measure?: ((element: HTMLElement | null) => { width: number; height: number } | null) | undefined;
  children: ReactNode;
}

export function SatReadingLayoutProvider({
  preferences,
  measure,
  children,
}: SatReadingLayoutProviderProps) {
  const [box, setBox] = useState<{ width: number; height: number } | null>(null);
  // Read once: a rotation before the workspace registers is the registration's
  // business, not this value's.
  const [baseline] = useState(satReadingBaselineBox);
  // Until a workspace registers, the classic arrangement is assumed: a question
  // with a passage beside it. The workspace reports the truth in the same commit
  // it mounts, so this is a first-frame value — and the first frame should look
  // like the exam did before any of this existed, not like a guess.
  const [hasStimulus, setHasStimulus] = useState(true);
  const [latch, setLatch] = useState<SatReadingPresentation | null>(null);
  const observerRef = useRef<ResizeObserver | null>(null);
  const elementRef = useRef<HTMLElement | null>(null);
  const measureRef = useRef(measure);
  measureRef.current = measure;
  const previousRef = useRef<SatReadingPresentation | null>(null);

  /**
   * The workspace's logical box.
   *
   * `clientWidth`/`clientHeight` (and the observer's content box) are the
   * LOGICAL layout box; `getBoundingClientRect()` is deliberately NOT used here.
   * The exam renders inside `SatExamZoomPlane`, which applies
   * `transform: scale(...)` — the rect reports the scaled visual geometry, while
   * CSS lays the panes out against the logical one. The split handle still reads
   * the rect, because pointer coordinates are physical: that is a different
   * question with a different answer.
   *
   * A workspace with no box at all (unmounted, hidden, or a non-layout test
   * environment) cannot answer the question, so the document viewport's box
   * stands in — the exam does fill the viewport, and that is a far better answer
   * than resolving a 0px workspace to "stacked".
   */
  const readBox = useCallback(
    (
      element: HTMLElement | null,
      entry?: ResizeObserverEntry,
    ): { width: number; height: number } | null => {
      const injected = measureRef.current;
      if (injected) return injected(element);
      const fromEntry = entry ? satReadingEntryBox(entry) : null;
      if (fromEntry) return fromEntry;
      if (element && element.clientWidth > 0 && element.clientHeight > 0) {
        return { width: element.clientWidth, height: element.clientHeight };
      }
      if (typeof window === 'undefined' || !(window.innerWidth > 0)) return null;
      return { width: window.innerWidth, height: window.innerHeight };
    },
    [],
  );

  const applyBox = useCallback((next: { width: number; height: number } | null) => {
    setBox((current) => {
      if (current === next) return current;
      if (current && next && current.width === next.width && current.height === next.height) return current;
      return next;
    });
  }, []);

  /**
   * The workspace registers itself: the box measured is the pane area the
   * exam actually lays out, never a random outer viewport that happens to be
   * nearby.
   *
   * Stable by contract — it is used as a React ref callback, and an identity
   * that changed every render would tear the observer down and rebuild it on
   * every commit.
   */
  const registerWorkspace = useCallback(
    (element: HTMLElement | null, nextHasStimulus: boolean) => {
      observerRef.current?.disconnect();
      observerRef.current = null;
      elementRef.current = element;
      setHasStimulus(nextHasStimulus);
      applyBox(readBox(element));
      if (!element || typeof ResizeObserver !== 'function') return;
      const observer = new ResizeObserver((entries) => {
        const entry = entries[entries.length - 1];
        applyBox(readBox((entry?.target as HTMLElement | undefined) ?? element, entry));
      });
      observer.observe(element);
      observerRef.current = observer;
    },
    [applyBox, readBox],
  );

  /**
   * Re-read an injected measurement when the injection changes.
   *
   * In a real browser the observer reports every change on its own; a
   * non-layout environment (jsdom) has no such signal, so a test that hands in
   * a new box is asking for a new measurement. Nothing here runs in production,
   * where there is no injection to change.
   */
  useEffect(() => {
    if (!measure) return;
    applyBox(readBox(elementRef.current));
  }, [applyBox, measure, readBox]);

  useEffect(
    () => () => {
      observerRef.current?.disconnect();
      observerRef.current = null;
      elementRef.current = null;
    },
    [],
  );

  const decision = useMemo(
    () =>
      resolveSatReadingLayout({
        workspaceWidth: box?.width ?? baseline.width,
        workspaceHeight: box?.height ?? baseline.height,
        hasStimulus,
        textScale: preferences.textScale,
        splitRatio: preferences.splitRatio,
        previousPresentation: latch ?? previousRef.current ?? undefined,
      }),
    [baseline, box, hasStimulus, latch, preferences.splitRatio, preferences.textScale],
  );

  // Record what was on screen, so the next measurement is compared against the
  // mode the student is actually looking at (hysteresis anchors to it).
  useEffect(() => {
    previousRef.current = decision.presentation;
  }, [decision.presentation]);

  const decisionRef = useRef(decision);
  decisionRef.current = decision;

  /**
   * Hold the presentation still for the whole of a pointer drag.
   *
   * The divider can move the panes across the readability threshold, and if the
   * resolver were allowed to answer mid-gesture the element holding pointer
   * capture would be unmounted under the student's finger. Discrete changes
   * (keyboard Home/End/Arrow) are not latched: they are single intentions, and
   * the layout is free to answer each one immediately.
   */
  const setSplitInteractionActive = useCallback((active: boolean) => {
    setLatch((current) => (active ? (current ?? decisionRef.current.presentation) : null));
  }, []);

  const value = useMemo<SatReadingLayoutContextValue>(() => {
    const held = latch !== null && latch !== decision.presentation;
    return {
      measured: box !== null,
      width: box?.width ?? baseline.width,
      height: box?.height ?? baseline.height,
      decision: held ? { ...decision, presentation: latch } : decision,
      registerWorkspace,
      setSplitInteractionActive,
    };
  }, [baseline, box, decision, latch, registerWorkspace, setSplitInteractionActive]);

  return (
    <SatReadingLayoutContext.Provider value={value}>{children}</SatReadingLayoutContext.Provider>
  );
}
