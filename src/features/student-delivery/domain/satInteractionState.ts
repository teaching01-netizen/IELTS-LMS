import type { SatRunnerState } from '../application/satRunnerReducer';
import type { SatSectionKey } from '../application/satRunnerReducer';
import type { SatExamToolPolicy } from './satToolPolicy';

/**
 * Central SAT interaction state machine — ephemeral UI interaction only.
 *
 * The exam/domain machine (satRunnerReducer: directions → module ⇄ review →
 * break → complete) remains authoritative for exam truth. This machine answers
 * a different question: given authoritative context, what can the student
 * interact with right now, which surface owns interaction, and what wins when
 * interactions compete.
 *
 * Parallel regions (never one giant union — no combinatorial explosion):
 *   - surface:    exactly one exclusive surface (structural impossibility of two)
 *   - annotation: persistent mode (off/highlight/underline/note/erase) + transient selection
 *   - scope:      module/question identity for explicit transition contracts
 *
 * Tool visibility is NOT a region here: the runner `activeTools`
 * (satRunnerReducer + satTools.toggleSatActiveTool) is the single tool
 * truth — the shell delegates tool buttons straight to runner commands.
 *
 * Deliberately NOT here (better owners exist): paused, terminated,
 * isSubmitting, phase, toolPolicy, responses, timer, save state, split ratio,
 * reading scale, tool geometry.
 */

export type SatInteractionPhase = 'loading' | 'directions' | 'module' | 'review' | 'submitting' | 'break' | 'complete';

export type SatInteractionFocusTarget =
  | { type: 'topbar'; control: 'calculator' | 'reference' | 'reading' | 'notes' | 'directions' | 'more' }
  | { type: 'footer'; control: 'navigator' }
  | { type: 'question'; questionId: string }
  | { type: 'answer'; questionId: string; answerId: string }
  | { type: 'annotation'; annotationId: string };

export type SatExclusiveSurface =
  | { kind: 'none' }
  | { kind: 'navigator'; returnFocus: SatInteractionFocusTarget }
  | { kind: 'directions'; returnFocus: SatInteractionFocusTarget }
  | { kind: 'reading-settings'; returnFocus: SatInteractionFocusTarget }
  | { kind: 'question-notes'; returnFocus: SatInteractionFocusTarget }
  | { kind: 'more-menu'; returnFocus: SatInteractionFocusTarget }
  | { kind: 'annotation-note-editor'; annotationId: string; returnFocus: SatInteractionFocusTarget };

export type SatAnnotationInteractionMode = 'off' | 'highlight' | 'underline' | 'note' | 'erase';
export type SatTextSelectionPhase = 'idle' | 'selecting' | 'captured';

/** Authoritative exam truth, passed IN — never stored as interaction state. */
export interface SatInteractionContext {
  phase: SatInteractionPhase;
  paused: boolean;
  terminated: boolean;
  isSubmitting: boolean;
  persistenceBlocked: boolean;
  toolPolicy: SatExamToolPolicy;
  sectionKey: SatSectionKey;
  moduleKey: string;
  questionId: string;
}

export interface SatInteractionState {
  surface: SatExclusiveSurface;
  annotation: {
    mode: SatAnnotationInteractionMode;
    textSelection: SatTextSelectionPhase;
  };
  scope: {
    moduleKey: string;
    questionId: string;
  };
}

/**
 * Intent events. Components describe what the student intended; the machine
 * decides what that means (conflict resolution, guards, normalization).
 * *_OPENED/*_CHANGED are post-guard transitions; *_REQUESTED are raw intents
 * resolved by resolveSatInteractionIntent().
 */
export type SatInteractionEvent =
  | { type: 'NAVIGATOR_OPENED'; returnFocus: SatInteractionFocusTarget }
  | { type: 'DIRECTIONS_OPENED'; returnFocus: SatInteractionFocusTarget }
  | { type: 'READING_SETTINGS_OPENED'; returnFocus: SatInteractionFocusTarget }
  | { type: 'QUESTION_NOTES_OPENED'; returnFocus: SatInteractionFocusTarget }
  | { type: 'MORE_MENU_OPENED'; returnFocus: SatInteractionFocusTarget }
  | { type: 'ANNOTATION_NOTE_EDITOR_OPENED'; annotationId: string; returnFocus: SatInteractionFocusTarget }
  | { type: 'ANNOTATION_NOTE_EDITOR_CLOSED' }
  | { type: 'SURFACE_CLOSED' }
  | { type: 'CALCULATOR_OPENED' }
  | { type: 'CALCULATOR_CLOSED' }
  | { type: 'CALCULATOR_TOGGLED' }
  | { type: 'REFERENCE_OPENED' }
  | { type: 'REFERENCE_CLOSED' }
  | { type: 'REFERENCE_TOGGLED' }
  | { type: 'ANNOTATION_MODE_CHANGED'; mode: SatAnnotationInteractionMode }
  | { type: 'TEXT_SELECTION_STARTED' }
  | { type: 'TEXT_SELECTION_CAPTURED' }
  | { type: 'TEXT_SELECTION_CLEARED' }
  | { type: 'ESCAPE_HANDLED' }
  | { type: 'QUESTION_CHANGED'; moduleKey: string; questionId: string }
  | { type: 'MODULE_SCOPE_CHANGED'; moduleKey: string; questionId: string }
  | { type: 'TOOL_POLICY_CHANGED' }
  | { type: 'TERMINAL_TRANSITION' };

export type SatInteractionGate = 'interactive' | 'blocked' | 'terminal';

/**
 * Blocking is an external priority layer ABOVE the interaction machine.
 * Terminal (terminated) outranks blocked (paused/submitting), which outranks
 * interactive. Derived from authoritative context every call — never stored.
 */
export function resolveInteractionGate(ctx: SatInteractionContext): SatInteractionGate {
  if (ctx.terminated) return 'terminal';
  if (ctx.paused || ctx.isSubmitting) return 'blocked';
  return 'interactive';
}

export function createSatInteractionState(
  scope: { moduleKey?: string; questionId?: string } = {},
): SatInteractionState {
  return {
    surface: { kind: 'none' },
    annotation: { mode: 'off', textSelection: 'idle' },
    scope: { moduleKey: scope.moduleKey ?? '', questionId: scope.questionId ?? '' },
  };
}

export function isAnnotationModeAllowed(
  mode: SatAnnotationInteractionMode,
  toolPolicy: SatExamToolPolicy,
): boolean {
  if (mode === 'off') return true;
  if (mode === 'highlight') return toolPolicy.highlight;
  if (mode === 'underline') return toolPolicy.underline;
  if (mode === 'erase') return toolPolicy.highlight || toolPolicy.underline || toolPolicy.notes;
  return toolPolicy.notes;
}

/**
 * Central normalization: modes revoked by policy can never linger armed for
 * more than one transition. Tool visibility is runner-owned (activeTools)
 * and never normalized here. Called after every guarded transition and on
 * TOOL_POLICY_CHANGED.
 */
export function normalizeSatInteractionState(
  state: SatInteractionState,
  ctx: SatInteractionContext,
): SatInteractionState {
  const mode = isAnnotationModeAllowed(state.annotation.mode, ctx.toolPolicy)
    ? state.annotation.mode
    : 'off';
  // Annotation data regions (stimulus/prompt) only exist in R&W; leaving the
  // capability also drops a dangling transient selection.
  const textSelection =
    mode === 'off' ? ('idle' as const)
    : state.annotation.mode !== mode ? ('idle' as const)
    : state.annotation.textSelection;
  if (mode === state.annotation.mode && textSelection === state.annotation.textSelection) {
    return state;
  }
  return {
    ...state,
    annotation: { mode, textSelection },
  };
}

function resetScope(
  state: SatInteractionState,
  moduleKey: string,
  questionId: string,
): SatInteractionState {
  return {
    ...state,
    surface: { kind: 'none' },
    annotation: { ...state.annotation, textSelection: 'idle' },
    scope: { moduleKey, questionId },
  };
}

/**
 * Boring-by-design pure reducer: T(S, C, E) → S'. Guards live in
 * satInteractionGuards, arbitration in satInteractionIntents, intelligence in
 * selectors/invariants — not here.
 */
export function satInteractionReducer(
  state: SatInteractionState,
  event: SatInteractionEvent,
  ctx: SatInteractionContext,
): SatInteractionState {
  // Defense in depth (spec §J): the reducer enforces the interaction gate
  // itself, so a surface/tool/mode open can never land while blocked or
  // terminal even if a controller/intent layer lets it through. Closes,
  // selection clearing, scope changes, and terminal transitions always apply.
  const gate: SatInteractionGate =
    ctx.terminated ? 'terminal' : ctx.paused || ctx.isSubmitting ? 'blocked' : 'interactive';
  const opensRefused = gate !== 'interactive';
  let next: SatInteractionState = state;
  switch (event.type) {
    case 'NAVIGATOR_OPENED':
      if (opensRefused) return state;
      // The annotation note editor must resolve before navigation affordances.
      if (state.surface.kind === 'annotation-note-editor') return state;
      next = {
        ...state,
        surface: { kind: 'navigator', returnFocus: event.returnFocus },
        annotation: { ...state.annotation, textSelection: 'idle' },
      };
      break;
    case 'DIRECTIONS_OPENED':
      if (opensRefused) return state;
      if (state.surface.kind === 'annotation-note-editor') return state;
      next = {
        ...state,
        surface: { kind: 'directions', returnFocus: event.returnFocus },
        annotation: { ...state.annotation, textSelection: 'idle' },
      };
      break;
    case 'READING_SETTINGS_OPENED':
      if (opensRefused) return state;
      if (state.surface.kind === 'annotation-note-editor') return state;
      next = {
        ...state,
        surface: { kind: 'reading-settings', returnFocus: event.returnFocus },
        annotation: { ...state.annotation, textSelection: 'idle' },
      };
      break;
    case 'QUESTION_NOTES_OPENED':
      if (opensRefused) return state;
      if (state.surface.kind === 'annotation-note-editor') return state;
      next = {
        ...state,
        surface: { kind: 'question-notes', returnFocus: event.returnFocus },
        annotation: { ...state.annotation, textSelection: 'idle' },
      };
      break;
    case 'MORE_MENU_OPENED':
      // More is a read mostly utility center: it may open while blocked
      // (Help/Shortcuts stay reachable read-only) but never over the
      // annotation editor. Row-level guards (Line Reader / Break) handle
      // their own disabled state.
      if (ctx.terminated) return state;
      if (state.surface.kind === 'annotation-note-editor') return state;
      next = {
        ...state,
        surface: { kind: 'more-menu', returnFocus: event.returnFocus },
        annotation: { ...state.annotation, textSelection: 'idle' },
      };
      break;
    case 'ANNOTATION_NOTE_EDITOR_OPENED':
      if (opensRefused) return state;
      next = {
        ...state,
        surface: {
          kind: 'annotation-note-editor',
          annotationId: event.annotationId,
          returnFocus: event.returnFocus,
        },
        annotation: { ...state.annotation, textSelection: 'idle' },
      };
      break;
    case 'ANNOTATION_NOTE_EDITOR_CLOSED':
    case 'SURFACE_CLOSED':
    case 'ESCAPE_HANDLED':
      // ESCAPE_HANDLED reaching the reducer means arbitration already chose
      // "close the exclusive surface". Pure close keeps the reducer boring.
      next = { ...state, surface: { kind: 'none' } };
      break;
    // Tool events are runner-owned (activeTools) and never reach this
    // machine: tool buttons dispatch runner commands directly. These cases
    // stay as acknowledged no-ops so stale in-flight intents keep reducing
    // instead of hitting `default`. They must NEVER touch surface, scope,
    // or annotation state.
    case 'CALCULATOR_OPENED':
    case 'CALCULATOR_CLOSED':
    case 'CALCULATOR_TOGGLED':
    case 'REFERENCE_OPENED':
    case 'REFERENCE_CLOSED':
    case 'REFERENCE_TOGGLED':
      return state;
    case 'ANNOTATION_MODE_CHANGED':
      if (event.mode !== 'off' && opensRefused) return state;
      if (!isAnnotationModeAllowed(event.mode, ctx.toolPolicy)) return state;
      next = {
        ...state,
        annotation: { mode: event.mode, textSelection: 'idle' },
      };
      break;
    case 'TEXT_SELECTION_STARTED':
      if (opensRefused) return state;
      if (state.annotation.mode === 'off') return state;
      next = {
        ...state,
        annotation: { ...state.annotation, textSelection: 'selecting' },
      };
      break;
    case 'TEXT_SELECTION_CAPTURED':
      if (state.annotation.textSelection !== 'selecting') return state;
      next = {
        ...state,
        annotation: { ...state.annotation, textSelection: 'captured' },
      };
      break;
    case 'TEXT_SELECTION_CLEARED':
      next = {
        ...state,
        annotation: { ...state.annotation, textSelection: 'idle' },
      };
      break;
    case 'QUESTION_CHANGED':
      // Explicit question contract: annotation mode survives per policy;
      // transient selection, editors, panels, navigator do not. Tool
      // visibility is runner-owned and untouched here.
      next = resetScope(state, event.moduleKey, event.questionId);
      break;
    case 'MODULE_SCOPE_CHANGED':
      next = {
        ...resetScope(state, event.moduleKey, event.questionId),
        annotation: { mode: 'off', textSelection: 'idle' },
      };
      break;
    case 'TOOL_POLICY_CHANGED':
      return normalizeSatInteractionState(state, ctx);
    case 'TERMINAL_TRANSITION':
      // Attempt terminated: discard all interaction, keep scope identity only.
      return {
        ...createSatInteractionState(),
        scope: { ...state.scope },
      };
    default:
      return state;
  }
  return normalizeSatInteractionState(next, ctx);
}

/** Development-only loud failure for impossible states. Zero-cost in prod. */
export function assertSatInteractionInvariants(
  state: SatInteractionState,
  ctx: SatInteractionContext,
): void {
  const failures: string[] = [];
  if (!isAnnotationModeAllowed(state.annotation.mode, ctx.toolPolicy)) {
    failures.push('Annotation mode active without capability');
  }
  if (ctx.phase !== 'module' && state.surface.kind !== 'none') {
    failures.push('Question interaction surface outside module');
  }
  if (state.annotation.mode === 'off' && state.annotation.textSelection !== 'idle') {
    failures.push('Transient selection without an armed annotation mode');
  }
  if (failures.length > 0) {
    throw new Error(`SAT interaction invariant violated: ${failures.join('; ')}`);
  }
}

/** DEV-guarded transition: transition + normalize + loud invariant check. */
export function transitionSatInteraction(
  state: SatInteractionState,
  event: SatInteractionEvent,
  ctx: SatInteractionContext,
): SatInteractionState {
  const next = satInteractionReducer(state, event, ctx);
  if (typeof import.meta !== 'undefined' && (import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV) {
    assertSatInteractionInvariants(next, ctx);
  }
  return next;
}

export function runnerPhaseToInteractionPhase(phase: SatRunnerState['phase']): SatInteractionPhase {
  return phase;
}
