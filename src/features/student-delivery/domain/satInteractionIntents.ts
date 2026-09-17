import { satInteractionCan } from './satInteractionGuards';
import type { SatTextAnchor } from './satResponses';
import type {
  SatInteractionContext,
  SatInteractionEvent,
  SatInteractionFocusTarget,
  SatInteractionState,
} from './satInteractionState';

/**
 * Components send INTENT, not state mutations. The machine decides what an
 * intent means: guard check → conflict resolution → pure transition event(s).
 * Returns null when the intent is refused (gate closed, policy revoked, or an
 * unresolved editor owns the surface).
 */

export type SatInteractionIntent =
  | { type: 'NAVIGATOR_OPEN_REQUESTED'; returnFocus?: SatInteractionFocusTarget }
  | { type: 'DIRECTIONS_OPEN_REQUESTED'; returnFocus?: SatInteractionFocusTarget }
  | { type: 'READING_SETTINGS_OPEN_REQUESTED'; returnFocus?: SatInteractionFocusTarget }
  | { type: 'QUESTION_NOTES_OPEN_REQUESTED'; returnFocus?: SatInteractionFocusTarget }
  | { type: 'MORE_MENU_OPEN_REQUESTED'; returnFocus?: SatInteractionFocusTarget }
  | { type: 'ANNOTATION_NOTE_REQUESTED'; annotationId: string; returnFocus?: SatInteractionFocusTarget }
  | { type: 'QUESTION_NOTE_REQUESTED'; returnFocus?: SatInteractionFocusTarget }
  | { type: 'CALCULATOR_TOGGLE_REQUESTED' }
  | { type: 'REFERENCE_TOGGLE_REQUESTED' }
  | { type: 'SURFACE_CLOSE_REQUESTED' }
  | { type: 'SURFACE_TOGGLE_REQUESTED'; surface: 'navigator' | 'directions' | 'reading-settings' | 'question-notes' | 'more-menu'; returnFocus?: SatInteractionFocusTarget }
  | { type: 'ESCAPE_PRESSED'; lineReaderEnabled?: boolean | undefined }
  | { type: 'QUESTION_NAVIGATION_REQUESTED'; moduleKey: string; questionId: string }
  | { type: 'TEXT_SELECTION_CAPTURED'; anchor: SatTextAnchor }
  | { type: 'TEXT_SELECTION_CLEARED' }
  | { type: 'ANNOTATION_EDITOR_CLOSED' }
  | { type: 'MODULE_SCOPE_CHANGED'; moduleKey: string; questionId: string }
  | { type: 'TOOL_POLICY_CHANGED' }
  | { type: 'TERMINAL_TRANSITION' };

function defaultReturnFocus(
  surface: 'navigator' | 'directions' | 'reading-settings' | 'question-notes' | 'more-menu',
  fallbackQuestionId: string,
): SatInteractionFocusTarget {
  switch (surface) {
    case 'navigator':
      return { type: 'footer', control: 'navigator' };
    case 'directions':
      return { type: 'topbar', control: 'directions' };
    case 'reading-settings':
      return { type: 'topbar', control: 'reading' };
    case 'question-notes':
      return { type: 'topbar', control: 'notes' };
    case 'more-menu':
      return { type: 'topbar', control: 'more' };
    default:
      return { type: 'question', questionId: fallbackQuestionId };
  }
}

/**
 * Conflict matrix (executable policy):
 * - navigator/directions/reading/notes replace each other (exclusive surface)
 * - annotation editor rejects competing surfaces until resolved
 * - text selection is captured with no armed mode; the annotation capability
 *   plus the interaction gate are the only preconditions
 * - calculator/reference are runner-owned independent layers; intents refuse them here and opening a tool never closes the exclusive surface (shell coexistence contract).
 * - question navigation clears transient selection, closes editor+panels+navigator
 * - scope change resets harder (annotation off, tools closed)
 */
export function resolveSatInteractionIntent(
  state: SatInteractionState,
  ctx: SatInteractionContext,
  intent: SatInteractionIntent,
): SatInteractionEvent | null {
  switch (intent.type) {
    case 'NAVIGATOR_OPEN_REQUESTED': {
      if (!satInteractionCan.openNavigator(state, ctx)) return null;
      return {
        type: 'NAVIGATOR_OPENED',
        returnFocus: intent.returnFocus ?? defaultReturnFocus('navigator', ctx.questionId),
      };
    }
    case 'DIRECTIONS_OPEN_REQUESTED': {
      if (!satInteractionCan.openDirections(state, ctx)) return null;
      return {
        type: 'DIRECTIONS_OPENED',
        returnFocus: intent.returnFocus ?? defaultReturnFocus('directions', ctx.questionId),
      };
    }
    case 'READING_SETTINGS_OPEN_REQUESTED': {
      if (!satInteractionCan.openReadingSettings(state, ctx)) return null;
      return {
        type: 'READING_SETTINGS_OPENED',
        returnFocus: intent.returnFocus ?? defaultReturnFocus('reading-settings', ctx.questionId),
      };
    }
    case 'QUESTION_NOTES_OPEN_REQUESTED': {
      if (!satInteractionCan.openQuestionNotes(state, ctx)) return null;
      return {
        type: 'QUESTION_NOTES_OPENED',
        returnFocus: intent.returnFocus ?? defaultReturnFocus('question-notes', ctx.questionId),
      };
    }
    case 'MORE_MENU_OPEN_REQUESTED': {
      if (!satInteractionCan.openMoreMenu(state, ctx)) return null;
      return {
        type: 'MORE_MENU_OPENED',
        returnFocus: intent.returnFocus ?? defaultReturnFocus('more-menu', ctx.questionId),
      };
    }
    case 'ANNOTATION_NOTE_REQUESTED': {
      if (!satInteractionCan.annotate(state, ctx)) return null;
      return {
        type: 'ANNOTATION_NOTE_EDITOR_OPENED',
        annotationId: intent.annotationId,
        returnFocus: intent.returnFocus ?? { type: 'question', questionId: ctx.questionId },
      };
    }
    case 'QUESTION_NOTE_REQUESTED': {
      // Writing about the question needs the notes capability, not a selection:
      // a student with nothing marked can still write something down.
      if (!satInteractionCan.annotate(state, ctx)) return null;
      return {
        type: 'QUESTION_NOTE_EDITOR_OPENED',
        returnFocus: intent.returnFocus ?? { type: 'topbar', control: 'notes' },
      };
    }
    // Tool buttons dispatch runner commands directly (activeTools is the
    // single tool truth), so no interaction intent exists for tools. These
    // stale cases stay refused — never resolve — to keep intent→event total
    // for in-flight callers without forking a second truth.
    case 'CALCULATOR_TOGGLE_REQUESTED':
    case 'REFERENCE_TOGGLE_REQUESTED':
      return null;
    case 'SURFACE_CLOSE_REQUESTED': {
      if (state.surface.kind === 'none') return null;
      return state.surface.kind === 'annotation-note-editor'
        ? { type: 'ANNOTATION_NOTE_EDITOR_CLOSED' }
        : { type: 'SURFACE_CLOSED' };
    }
    case 'SURFACE_TOGGLE_REQUESTED': {
      const openKind =
        state.surface.kind === 'navigator' ? 'navigator'
        : state.surface.kind === 'directions' ? 'directions'
        : state.surface.kind === 'reading-settings' ? 'reading-settings'
        : state.surface.kind === 'question-notes' ? 'question-notes'
        : state.surface.kind === 'more-menu' ? 'more-menu'
        : null;
      if (openKind === intent.surface) return { type: 'SURFACE_CLOSED' };
      const returnFocus = intent.returnFocus ?? defaultReturnFocus(intent.surface, ctx.questionId);
      if (intent.surface === 'navigator') {
        if (!satInteractionCan.openNavigator(state, ctx)) return null;
        return { type: 'NAVIGATOR_OPENED', returnFocus };
      }
      if (intent.surface === 'directions') {
        if (!satInteractionCan.openDirections(state, ctx)) return null;
        return { type: 'DIRECTIONS_OPENED', returnFocus };
      }
      if (intent.surface === 'reading-settings') {
        if (!satInteractionCan.openReadingSettings(state, ctx)) return null;
        return { type: 'READING_SETTINGS_OPENED', returnFocus };
      }
      if (intent.surface === 'question-notes') {
        if (!satInteractionCan.openQuestionNotes(state, ctx)) return null;
        return { type: 'QUESTION_NOTES_OPENED', returnFocus };
      }
      if (intent.surface === 'more-menu') {
        if (!satInteractionCan.openMoreMenu(state, ctx)) return null;
        return { type: 'MORE_MENU_OPENED', returnFocus };
      }
      return null;
    }
    case 'ESCAPE_PRESSED':
      // Arbitration needs current state beyond a pure event; the controller
      // resolves via resolveEscapeAction and dispatches the mapped event.
      // Returning the generic handled event keeps intent→event total.
      return { type: 'ESCAPE_HANDLED' };
    case 'QUESTION_NAVIGATION_REQUESTED':
      return {
        type: 'QUESTION_CHANGED',
        moduleKey: intent.moduleKey,
        questionId: intent.questionId,
      };
    case 'TEXT_SELECTION_CAPTURED':
      if (!satInteractionCan.annotate(state, ctx)) return null;
      return { type: 'TEXT_SELECTION_CAPTURED', anchor: intent.anchor };
    case 'TEXT_SELECTION_CLEARED':
      return { type: 'TEXT_SELECTION_CLEARED' };
    case 'ANNOTATION_EDITOR_CLOSED':
      return { type: 'ANNOTATION_NOTE_EDITOR_CLOSED' };
    case 'MODULE_SCOPE_CHANGED':
      return {
        type: 'MODULE_SCOPE_CHANGED',
        moduleKey: intent.moduleKey,
        questionId: intent.questionId,
      };
    case 'TOOL_POLICY_CHANGED':
      return { type: 'TOOL_POLICY_CHANGED' };
    case 'TERMINAL_TRANSITION':
      return { type: 'TERMINAL_TRANSITION' };
    default:
      return null;
  }
}
