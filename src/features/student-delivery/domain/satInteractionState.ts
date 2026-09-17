import type { SatRunnerState } from '../application/satRunnerReducer';
import type { SatSectionKey } from '../application/satRunnerReducer';
import type { SatTextAnchor } from './satResponses';
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
 *   - annotation: the armed annotation mode + the transient selection it allows
 *   - scope:      module/question identity for explicit transition contracts
 *
 * Annotation is an ARMED MODE. The student turns it on with the labeled top-bar
 * control; only then can choosing text raise the contextual toolbar. The machine
 * owns both halves of that contract — `modeEnabled` (may selection produce
 * controls?) and `selection` (which span is live) — so OFF can never be
 * defeated by a caller that reports a selection anyway.
 *
 * The invariant, in one line:
 *
 *     modeEnabled = false  →  selection must NEVER produce annotation controls
 *
 * Everything else follows from it: turning the mode off drops the transient
 * selection and nothing else, existing marks stay rendered, and the Notes
 * column is an independent surface that neither follows nor drives the mode.
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
  | { kind: 'annotation-note-editor'; annotationId: string; returnFocus: SatInteractionFocusTarget }
  // Writing about the question itself, with nothing selected. It is a surface
  // like the annotation editor — not a flag on the notes panel — so "which note
  // field is open" has exactly one owner, and Escape needs no special case.
  | { kind: 'question-note-editor'; returnFocus: SatInteractionFocusTarget };

/**
 * True for both note editors. They are unresolved student work: nothing else may
 * open over them, and Escape closes them before anything else.
 */
export function isSatNoteEditorSurface(surface: SatExclusiveSurface): boolean {
  return surface.kind === 'annotation-note-editor' || surface.kind === 'question-note-editor';
}

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
    /**
     * True while the student has armed annotation: selecting text may raise the
     * contextual toolbar, and existing marks may open their editor.
     *
     * False is the default and the state after leaving R&W or entering a new
     * module. It is NOT "hide the student's work": marks render either way, it
     * only decides whether selection produces controls.
     */
    modeEnabled: boolean;
    /**
     * Live annotation selection (exact span + recovery context). Null when
     * nothing is selected — which is also when no annotation toolbar may
     * exist anywhere in the tree. Never non-null while `modeEnabled` is false.
     */
    selection: SatTextAnchor | null;
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
  | { type: 'QUESTION_NOTE_EDITOR_OPENED'; returnFocus: SatInteractionFocusTarget }
  | { type: 'ANNOTATION_NOTE_EDITOR_CLOSED' }
  | { type: 'SURFACE_CLOSED' }
  | { type: 'CALCULATOR_OPENED' }
  | { type: 'CALCULATOR_CLOSED' }
  | { type: 'CALCULATOR_TOGGLED' }
  | { type: 'REFERENCE_OPENED' }
  | { type: 'REFERENCE_CLOSED' }
  | { type: 'REFERENCE_TOGGLED' }
  | { type: 'TEXT_SELECTION_CAPTURED'; anchor: SatTextAnchor }
  | { type: 'TEXT_SELECTION_CLEARED' }
  | { type: 'ANNOTATION_MODE_ENABLED' }
  | { type: 'ANNOTATION_MODE_DISABLED' }
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
    annotation: { modeEnabled: false, selection: null },
    scope: { moduleKey: scope.moduleKey ?? '', questionId: scope.questionId ?? '' },
  };
}

/**
 * Annotation capability, independent of the armed mode: R&W advertises the
 * annotation tools, Math does not. Used both by the capability selectors and
 * by the reducer's defense-in-depth check.
 */
export function isAnnotationAllowed(toolPolicy: SatExamToolPolicy): boolean {
  return toolPolicy.highlight || toolPolicy.underline || toolPolicy.notes;
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
  // Annotation data regions (stimulus/prompt) only exist in R&W; leaving the
  // capability drops a dangling selection AND disarms the mode, so a Math
  // question can never inherit a toolbar (or an anchor) from a R&W one.
  if (!isAnnotationAllowed(ctx.toolPolicy) && (state.annotation.selection !== null || state.annotation.modeEnabled)) {
    return { ...state, annotation: { modeEnabled: false, selection: null } };
  }
  return state;
}

/**
 * Question contract: chrome and the transient selection never survive
 * navigation, but the armed mode is the student's standing choice for the
 * module, so turning to the next question keeps it armed.
 */
function resetQuestionScope(
  state: SatInteractionState,
  moduleKey: string,
  questionId: string,
): SatInteractionState {
  return {
    ...state,
    surface: { kind: 'none' },
    annotation: { ...state.annotation, selection: null },
    scope: { moduleKey, questionId },
  };
}

/**
 * Module contract: a new module is a new context, so the armed mode starts from
 * scratch there — the same rule the annotation capability itself follows.
 */
function resetModuleScope(
  state: SatInteractionState,
  moduleKey: string,
  questionId: string,
): SatInteractionState {
  return {
    ...state,
    surface: { kind: 'none' },
    annotation: { modeEnabled: false, selection: null },
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
      // A note editor must resolve before navigation affordances.
      if (isSatNoteEditorSurface(state.surface)) return state;
      next = {
        ...state,
        surface: { kind: 'navigator', returnFocus: event.returnFocus },
        annotation: { ...state.annotation, selection: null },
      };
      break;
    case 'DIRECTIONS_OPENED':
      if (opensRefused) return state;
      if (isSatNoteEditorSurface(state.surface)) return state;
      next = {
        ...state,
        surface: { kind: 'directions', returnFocus: event.returnFocus },
        annotation: { ...state.annotation, selection: null },
      };
      break;
    case 'READING_SETTINGS_OPENED':
      if (opensRefused) return state;
      if (isSatNoteEditorSurface(state.surface)) return state;
      next = {
        ...state,
        surface: { kind: 'reading-settings', returnFocus: event.returnFocus },
        annotation: { ...state.annotation, selection: null },
      };
      break;
    case 'QUESTION_NOTES_OPENED':
      if (opensRefused) return state;
      if (isSatNoteEditorSurface(state.surface)) return state;
      next = {
        ...state,
        surface: { kind: 'question-notes', returnFocus: event.returnFocus },
        annotation: { ...state.annotation, selection: null },
      };
      break;
    case 'MORE_MENU_OPENED':
      // More is a read mostly utility center: it may open while blocked
      // (Help/Shortcuts stay reachable read-only) but never over a note
      // editor. Row-level guards (Line Reader / Break) handle their own
      // disabled state.
      if (ctx.terminated) return state;
      if (isSatNoteEditorSurface(state.surface)) return state;
      next = {
        ...state,
        surface: { kind: 'more-menu', returnFocus: event.returnFocus },
        annotation: { ...state.annotation, selection: null },
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
        annotation: { ...state.annotation, selection: null },
      };
      break;
    case 'QUESTION_NOTE_EDITOR_OPENED':
      if (opensRefused) return state;
      next = {
        ...state,
        surface: { kind: 'question-note-editor', returnFocus: event.returnFocus },
        annotation: { ...state.annotation, selection: null },
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
    case 'TEXT_SELECTION_CAPTURED':
      // Selecting text may only produce annotation controls while the student has
      // armed the mode. This guard is the invariant's single owner: whatever a
      // caller reports, an unarmed exam can never raise a toolbar.
      if (opensRefused) return state;
      if (!state.annotation.modeEnabled) return state;
      if (!isAnnotationAllowed(ctx.toolPolicy)) return state;
      if (isSatNoteEditorSurface(state.surface)) return state;
      if (event.anchor.nodeId === '' || !(event.anchor.endOffset > event.anchor.startOffset)) return state;
      next = { ...state, annotation: { ...state.annotation, selection: event.anchor } };
      break;
    case 'TEXT_SELECTION_CLEARED':
      if (state.annotation.selection === null) return state;
      next = { ...state, annotation: { ...state.annotation, selection: null } };
      break;
    case 'ANNOTATION_MODE_ENABLED':
      // Arming is a capability + gate question only. It deliberately does not
      // touch the surface: a student reviewing notes can arm the mode, and a
      // student arming the mode keeps the column they already had open.
      if (opensRefused) return state;
      if (!isAnnotationAllowed(ctx.toolPolicy)) return state;
      if (state.annotation.modeEnabled) return state;
      next = { ...state, annotation: { ...state.annotation, modeEnabled: true } };
      break;
    case 'ANNOTATION_MODE_DISABLED':
      // The mode's own cleanup: the transient selection (and the controls it
      // raised) go away, and nothing else does. No mark is deleted, no highlight
      // is hidden, and the exclusive surface — the Notes column, an open note
      // editor — is left exactly as it was.
      if (!state.annotation.modeEnabled && state.annotation.selection === null) return state;
      next = { ...state, annotation: { modeEnabled: false, selection: null } };
      break;
    case 'QUESTION_CHANGED':
      // Explicit question contract: transient selection, editors, panels and
      // navigator never survive navigation — the armed annotation mode does,
      // because it is the student's standing choice for the module. Tool
      // visibility is runner-owned and untouched here.
      next = resetQuestionScope(state, event.moduleKey, event.questionId);
      break;
    case 'MODULE_SCOPE_CHANGED':
      next = resetModuleScope(state, event.moduleKey, event.questionId);
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
  if (state.annotation.selection !== null && !state.annotation.modeEnabled) {
    failures.push('Annotation selection without an armed annotation mode');
  }
  if (state.annotation.selection !== null && !isAnnotationAllowed(ctx.toolPolicy)) {
    failures.push('Annotation selection without capability');
  }
  if (state.annotation.modeEnabled && !isAnnotationAllowed(ctx.toolPolicy)) {
    failures.push('Armed annotation mode without capability');
  }
  if (ctx.phase !== 'module' && state.surface.kind !== 'none') {
    failures.push('Question interaction surface outside module');
  }
  if (state.annotation.selection !== null && isSatNoteEditorSurface(state.surface)) {
    failures.push('Annotation selection behind the note editor');
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
