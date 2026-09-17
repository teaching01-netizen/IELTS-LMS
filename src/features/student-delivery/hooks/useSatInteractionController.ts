import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import { resolveEscapeAction } from '../domain/satInteractionEscape';
import {
  resolveSatInteractionIntent,
  type SatInteractionIntent,
} from '../domain/satInteractionIntents';
import { selectSatInteraction, type SatInteractionView } from '../domain/satInteractionSelectors';
import {
  createSatInteractionState,
  normalizeSatInteractionState,
  satInteractionReducer,
  transitionSatInteraction,
  type SatInteractionContext,
  type SatInteractionFocusTarget,
  type SatInteractionState,
} from '../domain/satInteractionState';
import type { SatTextAnchor } from '../domain/satResponses';

export type { SatInteractionFocusTarget, SatInteractionView };

export interface SatInteractionController {
  state: SatInteractionState;
  view: SatInteractionView;
  can: SatInteractionView['can'];
  is: SatInteractionView['is'];
  gate: SatInteractionView['gate'];
  dispatchIntent: (intent: SatInteractionIntent) => void;
  openNavigator: (returnFocus?: SatInteractionFocusTarget) => void;
  openDirections: (returnFocus?: SatInteractionFocusTarget) => void;
  openReadingSettings: (returnFocus?: SatInteractionFocusTarget) => void;
  openQuestionNotes: (returnFocus?: SatInteractionFocusTarget) => void;
  openMoreMenu: (returnFocus?: SatInteractionFocusTarget) => void;
  openAnnotationNote: (annotationId: string, returnFocus?: SatInteractionFocusTarget) => void;
  /** Write about the question itself, with nothing selected. */
  openQuestionNote: (returnFocus?: SatInteractionFocusTarget) => void;
  toggleSurface: (
    surface: 'navigator' | 'directions' | 'reading-settings' | 'question-notes' | 'more-menu',
    returnFocus?: SatInteractionFocusTarget,
  ) => void;
  closeSurface: () => void;
  toggleCalculator: () => void;
  toggleReference: () => void;
  /**
   * Armed annotation: true while selecting text may raise the tools.
   *
   * Exposed as state (not as "is a selection live") because the whole contract
   * is a mode: the top-bar control reflects THIS value, and OFF must be
   * readable independently of any selection.
   */
  annotationModeEnabled: boolean;
  /** Flip the armed annotation mode (the one meaning of the top-bar control). */
  toggleAnnotationMode: () => void;
  /** Capture the span the toolbar will act on (refused while the mode is off). */
  selectionCaptured: (anchor: SatTextAnchor) => void;
  selectionCleared: () => void;
  questionNavigated: (moduleKey: string, questionId: string) => void;
  moduleScopeChanged: (moduleKey: string, questionId: string) => void;
  handleEscape: (options?: { lineReaderEnabled?: boolean | undefined; onDisableLineReader?: () => void }) => boolean;
}

/**
 * useSatInteractionController — the only public mutation surface for SAT exam
 * UI interaction (spec §V). Components send INTENT; guards + reducer decide.
 *
 * - Reducer stays pure/deterministic; effects (focus restore) live here.
 * - No raw DOM nodes in state: semantic FocusTargets resolve to elements.
 * - Scope/policy normalization is automatic on ctx identity change.
 * - Blocking is derived from ctx every render; the reducer additionally
 *   refuses opens under a non-interactive gate (defense in depth, spec §J).
 */
export function useSatInteractionController(ctx: SatInteractionContext): SatInteractionController {
  // React's useReducer invokes reducer(state, action) with TWO args, but our
  // pure reducer is T(S, C, E) with THREE. Bridge via a live ctx ref so the
  // stored reducer always sees authoritative context without re-binding.
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;
  const [state, dispatch] = useReducer(
    (current: SatInteractionState, event: Parameters<typeof satInteractionReducer>[1]) =>
      satInteractionReducer(current, event, ctxRef.current),
    undefined,
    () => createSatInteractionState(),
  );

  // Keep scope identity in sync with authoritative navigation. Question moves
  // clear the live annotation selection + close surfaces; module moves reset
  // the same regions from scratch (explicit transition contracts).
  const scopeKey = `${ctx.moduleKey}::${ctx.questionId}`;
  const scopeKeyRef = useRef(scopeKey);
  const moduleKeyRef = useRef(ctx.moduleKey);
  useEffect(() => {
    if (scopeKeyRef.current === scopeKey) return;
    const moduleChanged = moduleKeyRef.current !== ctx.moduleKey;
    scopeKeyRef.current = scopeKey;
    moduleKeyRef.current = ctx.moduleKey;
    dispatch(
      moduleChanged
        ? { type: 'MODULE_SCOPE_CHANGED', moduleKey: ctx.moduleKey, questionId: ctx.questionId }
        : { type: 'QUESTION_CHANGED', moduleKey: ctx.moduleKey, questionId: ctx.questionId },
    );
  }, [scopeKey, ctx.moduleKey, ctx.questionId]);

  // Tool-policy revocation normalizes centrally (spec §Q): a Math tool can
  // never linger open after entering R&W for more than one transition.
  const policyRef = useRef(ctx.toolPolicy);
  useEffect(() => {
    if (policyRef.current === ctx.toolPolicy) return;
    policyRef.current = ctx.toolPolicy;
    dispatch({ type: 'TOOL_POLICY_CHANGED' });
  }, [ctx.toolPolicy]);

  // Termination discards all interaction (spec §G conflict matrix).
  const terminatedRef = useRef(ctx.terminated);
  useEffect(() => {
    if (terminatedRef.current === ctx.terminated) return;
    terminatedRef.current = ctx.terminated;
    if (ctx.terminated) dispatch({ type: 'TERMINAL_TRANSITION' });
  }, [ctx.terminated]);

  // Live-state mirror: useReducer dispatch takes ACTIONS, not updaters, so
  // arbitration (Escape) and intent resolution read the ref instead.
  const stateRef = useRef(state);
  stateRef.current = state;

  const dispatchEvent = useCallback(
    (event: Parameters<typeof transitionSatInteraction>[1]) => {
      const next = transitionSatInteraction(stateRef.current, event, ctx);
      if (next !== stateRef.current) dispatch(event);
    },
    [ctx],
  );

  const dispatchIntent = useCallback(
    (intent: SatInteractionIntent) => {
      const current = stateRef.current;
      // Escape needs arbitration against live state: resolve here so exactly
      // one semantic action occurs per press (spec §K).
      if (intent.type === 'ESCAPE_PRESSED') {
        const action = resolveEscapeAction(current, ctx, {
          lineReaderEnabled: intent.lineReaderEnabled,
        });
        switch (action.type) {
          case 'IGNORE':
          case 'NOOP':
            return;
          case 'CLOSE_ANNOTATION_EDITOR':
            dispatchEvent({ type: 'ANNOTATION_NOTE_EDITOR_CLOSED' });
            return;
          case 'CLOSE_SURFACE':
            dispatchEvent(
              current.surface.kind === 'annotation-note-editor'
                ? { type: 'ANNOTATION_NOTE_EDITOR_CLOSED' }
                : { type: 'SURFACE_CLOSED' },
            );
            return;
          case 'CLEAR_SELECTION':
            dispatchEvent({ type: 'TEXT_SELECTION_CLEARED' });
            return;
          case 'DISABLE_LINE_READER':
            // Line-reader preference state lives outside this machine; the
            // shell disables it. Nothing to transition here.
            return;
          default:
            return;
        }
      }
      const event = resolveSatInteractionIntent(current, ctx, intent);
      if (!event) return;
      dispatchEvent(event);
    },
    [ctx, dispatchEvent],
  );

  // Semantic focus restoration: closing a surface focuses its recorded
  // returnFocus target (spec §L). Raw nodes never enter the reducer.
  const surfaceKind = state.surface.kind;
  const returnFocus = state.surface.kind !== 'none' ? state.surface.returnFocus : null;
  useEffect(() => {
    if (surfaceKind !== 'none') return;
    if (!returnFocus) return;
    const selector = selectorForFocusTarget(returnFocus);
    if (!selector) return;
    const frame = window.requestAnimationFrame(() => {
      document.querySelector<HTMLElement>(selector)?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
    // Fire only on surface-close transitions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [surfaceKind]);

  const view = useMemo(() => selectSatInteraction(state, ctx), [state, ctx]);

  const openNavigator = useCallback(
    (focus?: SatInteractionFocusTarget) =>
      dispatchIntent(focus ? { type: 'NAVIGATOR_OPEN_REQUESTED', returnFocus: focus } : { type: 'NAVIGATOR_OPEN_REQUESTED' }),
    [dispatchIntent],
  );
  const openDirections = useCallback(
    (focus?: SatInteractionFocusTarget) =>
      dispatchIntent(focus ? { type: 'DIRECTIONS_OPEN_REQUESTED', returnFocus: focus } : { type: 'DIRECTIONS_OPEN_REQUESTED' }),
    [dispatchIntent],
  );
  const openReadingSettings = useCallback(
    (focus?: SatInteractionFocusTarget) =>
      dispatchIntent(
        focus ? { type: 'READING_SETTINGS_OPEN_REQUESTED', returnFocus: focus } : { type: 'READING_SETTINGS_OPEN_REQUESTED' },
      ),
    [dispatchIntent],
  );
  const openQuestionNotes = useCallback(
    (focus?: SatInteractionFocusTarget) =>
      dispatchIntent(
        focus ? { type: 'QUESTION_NOTES_OPEN_REQUESTED', returnFocus: focus } : { type: 'QUESTION_NOTES_OPEN_REQUESTED' },
      ),
    [dispatchIntent],
  );
  const openAnnotationNote = useCallback(
    (annotationId: string, focus?: SatInteractionFocusTarget) =>
      dispatchIntent(
        focus
          ? { type: 'ANNOTATION_NOTE_REQUESTED', annotationId, returnFocus: focus }
          : { type: 'ANNOTATION_NOTE_REQUESTED', annotationId },
      ),
    [dispatchIntent],
  );
  const openQuestionNote = useCallback(
    (focus?: SatInteractionFocusTarget) =>
      dispatchIntent(
        focus ? { type: 'QUESTION_NOTE_REQUESTED', returnFocus: focus } : { type: 'QUESTION_NOTE_REQUESTED' },
      ),
    [dispatchIntent],
  );
  const openMoreMenu = useCallback(
    (focus?: SatInteractionFocusTarget) =>
      dispatchIntent(focus ? { type: 'MORE_MENU_OPEN_REQUESTED', returnFocus: focus } : { type: 'MORE_MENU_OPEN_REQUESTED' }),
    [dispatchIntent],
  );
  const toggleSurface = useCallback(
    (
      surface: 'navigator' | 'directions' | 'reading-settings' | 'question-notes' | 'more-menu',
      focus?: SatInteractionFocusTarget,
    ) =>
      dispatchIntent(
        focus ? { type: 'SURFACE_TOGGLE_REQUESTED', surface, returnFocus: focus } : { type: 'SURFACE_TOGGLE_REQUESTED', surface },
      ),
    [dispatchIntent],
  );
  const closeSurface = useCallback(() => dispatchIntent({ type: 'SURFACE_CLOSE_REQUESTED' }), [dispatchIntent]);
  // Tool buttons dispatch runner commands directly (activeTools is the
  // single tool truth) — these callbacks stay only so committed consumers
  // keep compiling; they are refused no-ops by the intent layer.
  const toggleCalculator = useCallback(() => dispatchIntent({ type: 'CALCULATOR_TOGGLE_REQUESTED' }), [dispatchIntent]);
  const toggleReference = useCallback(() => dispatchIntent({ type: 'REFERENCE_TOGGLE_REQUESTED' }), [dispatchIntent]);
  const toggleAnnotationMode = useCallback(
    () => dispatchIntent({ type: 'ANNOTATION_MODE_TOGGLE_REQUESTED' }),
    [dispatchIntent],
  );
  const selectionCaptured = useCallback(
    (anchor: SatTextAnchor) => dispatchIntent({ type: 'TEXT_SELECTION_CAPTURED', anchor }),
    [dispatchIntent],
  );
  const selectionCleared = useCallback(() => dispatchIntent({ type: 'TEXT_SELECTION_CLEARED' }), [dispatchIntent]);
  const questionNavigated = useCallback(
    (moduleKey: string, questionId: string) =>
      dispatchIntent({ type: 'QUESTION_NAVIGATION_REQUESTED', moduleKey, questionId }),
    [dispatchIntent],
  );
  const moduleScopeChanged = useCallback(
    (moduleKey: string, questionId: string) =>
      dispatchIntent({ type: 'MODULE_SCOPE_CHANGED', moduleKey, questionId }),
    [dispatchIntent],
  );
  const handleEscape = useCallback(
    (options: { lineReaderEnabled?: boolean | undefined; onDisableLineReader?: () => void } = {}) => {
      const current = stateRef.current;
      const action = resolveEscapeAction(current, ctx, {
        lineReaderEnabled: options.lineReaderEnabled,
      });
      if (action.type === 'IGNORE' || action.type === 'NOOP') return false;
      if (action.type === 'DISABLE_LINE_READER') {
        options.onDisableLineReader?.();
        return true;
      }
      if (action.type === 'CLOSE_ANNOTATION_EDITOR') {
        dispatchEvent({ type: 'ANNOTATION_NOTE_EDITOR_CLOSED' });
        return true;
      }
      if (action.type === 'CLEAR_SELECTION') {
        dispatchEvent({ type: 'TEXT_SELECTION_CLEARED' });
        return true;
      }
      dispatchEvent(
        current.surface.kind === 'annotation-note-editor'
          ? { type: 'ANNOTATION_NOTE_EDITOR_CLOSED' }
          : { type: 'SURFACE_CLOSED' },
      );
      return true;
    },
    [ctx, dispatchEvent],
  );

  return {
    state,
    view,
    can: view.can,
    is: view.is,
    gate: view.gate,
    dispatchIntent,
    openNavigator,
    openDirections,
    openReadingSettings,
    openQuestionNotes,
    openMoreMenu,
    openAnnotationNote,
    openQuestionNote,
    toggleSurface,
    closeSurface,
    toggleCalculator,
    toggleReference,
    annotationModeEnabled: state.annotation.modeEnabled,
    toggleAnnotationMode,
    selectionCaptured,
    selectionCleared,
    questionNavigated,
    moduleScopeChanged,
    handleEscape,
  };
}

function selectorForFocusTarget(target: SatInteractionFocusTarget): string | null {
  switch (target.type) {
    case 'footer':
      return '[data-sat-focus="footer-navigator"]';
    case 'topbar':
      return `[data-sat-focus="topbar-${target.control}"]`;
    case 'question':
      return `[data-sat-question-id="${CSS.escape(target.questionId)}"]`;
    case 'answer':
      return `[data-sat-answer-id="${CSS.escape(target.answerId)}"]`;
    case 'annotation':
      return `[data-sat-annotation-id="${CSS.escape(target.annotationId)}"]`;
    default:
      return null;
  }
}

/** Test hook: normalize without a controller (policy-revocation convergence). */
export function normalizeForTest(state: SatInteractionState, ctx: SatInteractionContext) {
  return normalizeSatInteractionState(state, ctx);
}
