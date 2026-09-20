import type { SatQuestionAnnotations, SatQuestionResponseDraft } from '../domain/satResponses';
import {
  applySatResponseDraftChange,
  emptySatQuestionResponse,
  normalizeSatResponseDraft,
} from '../domain/satResponses';
import type { SatActiveTool, SatToolCapabilities, SatToolId } from '../domain/satTools';
import { EMPTY_SAT_ACTIVE_TOOLS, emptySatToolCapabilities, satActiveToolsFromLegacy, satActiveToolsToLegacy, toggleSatActiveTool, type SatActiveTools } from '../domain/satTools';

export type SatSectionKey = 'reading-writing' | 'math';

type SatWorkingState = {
  scheduleId: string;
  candidateId: string;
  assessmentId: string;
  sectionKey: SatSectionKey;
  moduleKey: string;
  questionIds: string[];
  questionIndex: number;
  responses: Record<string, SatQuestionResponseDraft>;
  responseRevisions: Record<string, number>;
  toolCapabilities: SatToolCapabilities;
  activeTool: SatActiveTool;
  activeTools: SatActiveTools;
  startedAt: string;
  endsAt: string;
};

export type SatRunnerState =
  | { phase: 'loading'; scheduleId: string; candidateId: string }
  | { phase: 'directions'; scheduleId: string; candidateId: string; assessmentId: string }
  | ({ phase: 'module' } & SatWorkingState)
  | ({ phase: 'review' } & SatWorkingState)
  | { phase: 'submitting'; scheduleId: string; candidateId: string; assessmentId: string }
  | { phase: 'break'; scheduleId: string; candidateId: string; assessmentId: string; nextSectionKey: SatSectionKey; resumeAt: string }
  | { phase: 'complete'; scheduleId: string; candidateId: string; assessmentId: string; resultId: string };

type SatWorkingRunnerState =
  | Extract<SatRunnerState, { phase: 'module' }>
  | Extract<SatRunnerState, { phase: 'review' }>;

export type SatRunnerAction =
  | { type: 'bootstrapLoaded'; assessmentId: string }
  | { type: 'moduleStarted'; sectionKey: SatSectionKey; moduleKey: string; questionIds: string[]; startedAt: string; endsAt: string; toolCapabilities?: SatToolCapabilities }
  | { type: 'setAnswer'; questionId: string; value: string }
  | { type: 'hydrateResponse'; response: SatQuestionResponseDraft; revision: number }
  // Audit finding 3: the controller computes the next draft with the domain
  // mutator and replaces the whole draft, so the dispatched state and the
  // persisted payload are the same object instead of two derivations.
  | { type: 'replaceResponse'; response: SatQuestionResponseDraft }
  | { type: 'responseSaved'; questionId: string; revision: number }
  | { type: 'setReviewFlag'; questionId: string; flagged: boolean }
  | { type: 'toggleEliminatedOption'; questionId: string; optionId: string }
  | { type: 'setAnnotations'; questionId: string; annotations: SatQuestionAnnotations }
  | { type: 'toggleTool'; tool: SatToolId }
  | { type: 'closeTool'; tool: SatToolId }
  | { type: 'closeAllTools' }
  | { type: 'selectQuestion'; questionIndex: number }
  | { type: 'reviewModule' }
  | { type: 'returnToModule' }
  | { type: 'routeToModule'; sectionKey: SatSectionKey; moduleKey: string; questionIds: string[]; startedAt: string; endsAt: string; toolCapabilities?: SatToolCapabilities }
  | { type: 'startBreak'; nextSectionKey: SatSectionKey; resumeAt: string }
  | { type: 'showDirections' }
  | { type: 'submit' }
  | { type: 'completed'; resultId: string }
  | { type: 'recover'; state: SatRunnerState };

// Phase 04 identity note: candidateId is the route candidate prop, never the
// attempt id — see useSatExamController call sites. newWorkingState carries it
// through; the recover migration below is orthogonal (legacy activeTools).
export function createSatRunnerState(scheduleId: string, candidateId: string): SatRunnerState {
  return { phase: 'loading', scheduleId, candidateId };
}

function updateResponse(
  state: SatWorkingRunnerState,
  questionId: string,
  update: (response: SatQuestionResponseDraft) => SatQuestionResponseDraft,
): SatWorkingRunnerState {
  const current = state.responses[questionId] ?? emptySatQuestionResponse(questionId);
  return { ...state, responses: { ...state.responses, [questionId]: update(current) } };
}
function workingState(
  state: Extract<SatRunnerState, { phase: 'module' | 'review' }>,
  action: SatRunnerAction,
): SatRunnerState {
  switch (action.type) {
    case 'setAnswer':
      // Bluebook parity (Phase 6): selecting an eliminated choice restores
      // it first — selected and eliminated must never contradict. The
      // elimination is lifted, the answer is set. Kept as a second line of
      // defense behind `applySatResponseDraftChange` so a direct dispatch
      // cannot re-create the contradiction the audit found.
      return updateResponse(state, action.questionId, (response) =>
        applySatResponseDraftChange(response, { kind: 'setAnswer', answer: action.value }),
      );
    case 'replaceResponse':
      return updateResponse(state, action.response.questionId, () =>
        normalizeSatResponseDraft(action.response),
      );
    case 'hydrateResponse':
      return {
        ...state,
        // A snapshot from an older build or a pre-fix durable record may
        // violate the invariant; heal it on read rather than resurrecting it.
        responses: {
          ...state.responses,
          [action.response.questionId]: normalizeSatResponseDraft(action.response),
        },
        responseRevisions: {
          ...state.responseRevisions,
          [action.response.questionId]: action.revision,
        },
      };
    case 'responseSaved':
      return {
        ...state,
        responseRevisions: { ...state.responseRevisions, [action.questionId]: action.revision },
      };
    case 'setReviewFlag':
      return updateResponse(state, action.questionId, (response) => ({
        ...response,
        markedForReview: action.flagged,
      }));
    case 'setAnnotations':
      return updateResponse(state, action.questionId, (response) => ({
        ...response,
        annotations: action.annotations,
      }));
    case 'toggleEliminatedOption':
      return updateResponse(state, action.questionId, (response) =>
        applySatResponseDraftChange(response, {
          kind: 'toggleEliminatedOption',
          optionId: action.optionId,
        }),
      );
    case 'toggleTool': {
      // Bluebook coexistence (Phase 9): toggling one tool never closes the
      // other. Legacy activeTool is derived from the NEW flags for compat
      // only (calculator wins ties); route mounts read activeTools flags.
      const activeTools = toggleSatActiveTool(state.toolCapabilities, state.activeTools, action.tool);
      return { ...state, activeTools, activeTool: satActiveToolsToLegacy(activeTools) };
    }
    case 'closeTool': {
      // Coexistence close (Phase 05): closing one tool leaves the other open.
      // Legacy activeTool is re-derived from the new flags (calculator wins ties).
      const activeTools: SatActiveTools =
        action.tool === 'calculator'
          ? { ...state.activeTools, calculator: false }
          : { ...state.activeTools, referenceSheet: false };
      return { ...state, activeTools, activeTool: satActiveToolsToLegacy(activeTools) };
    }
    case 'closeAllTools':
      return { ...state, activeTool: null, activeTools: EMPTY_SAT_ACTIVE_TOOLS };
    case 'selectQuestion':
      return {
        ...state,
        questionIndex: Math.max(0, Math.min(action.questionIndex, state.questionIds.length - 1)),
      };
    case 'reviewModule':
      return state.phase === 'module' ? { ...state, phase: 'review', activeTool: null, activeTools: EMPTY_SAT_ACTIVE_TOOLS } : state;
    case 'returnToModule':
      return state.phase === 'review' ? { ...state, phase: 'module' } : state;
    default:
      return state;
  }
}

function newWorkingState(
  state: Exclude<SatRunnerState, { phase: 'loading' | 'complete' | 'submitting' }>,
  action: Extract<SatRunnerAction, { type: 'moduleStarted' | 'routeToModule' }>,
): SatRunnerState {
  const existingResponses = 'responses' in state ? state.responses : {};
  const existingRevisions = 'responseRevisions' in state ? state.responseRevisions : {};
  return {
    phase: 'module',
    scheduleId: state.scheduleId,
    candidateId: state.candidateId,
    assessmentId: state.assessmentId,
    sectionKey: action.sectionKey,
    moduleKey: action.moduleKey,
    questionIds: action.questionIds,
    questionIndex: 0,
    responses: { ...existingResponses },
    responseRevisions: { ...existingRevisions },
    toolCapabilities: action.toolCapabilities ?? emptySatToolCapabilities(),
    activeTool: null,
    activeTools: EMPTY_SAT_ACTIVE_TOOLS,
    startedAt: action.startedAt,
    endsAt: action.endsAt,
  };
}

export function satRunnerReducer(state: SatRunnerState, action: SatRunnerAction): SatRunnerState {
  if (action.type === 'recover') {
    // Legacy snapshots (persisted before Phase 9) lack activeTools at
    // runtime even though the type now declares it — migrate via cast.
    const snapshot = action.state;
    if (snapshot.phase === 'module' || snapshot.phase === 'review') {
      const maybeTools = (snapshot as { activeTools?: SatActiveTools }).activeTools;
      if (!maybeTools) {
        return { ...snapshot, activeTools: satActiveToolsFromLegacy(snapshot.activeTool) };
      }
    }
    return snapshot;
  }

  if (
    (state.phase === 'module' || state.phase === 'review')
    && action.type !== 'routeToModule'
    && action.type !== 'startBreak'
    && action.type !== 'showDirections'
    && action.type !== 'submit'
    && action.type !== 'completed'
  ) {
    return workingState(state, action);
  }

  switch (action.type) {
    case 'bootstrapLoaded':
      if (state.phase !== 'loading') return state;
      return {
        phase: 'directions',
        scheduleId: state.scheduleId,
        candidateId: state.candidateId,
        assessmentId: action.assessmentId,
      };
    case 'moduleStarted':
      if (state.phase !== 'directions' && state.phase !== 'break' && state.phase !== 'review') {
        return state;
      }
      return newWorkingState(state, action);
    case 'routeToModule':
      if (
        state.phase !== 'directions'
        && state.phase !== 'break'
        && state.phase !== 'review'
        && state.phase !== 'module'
      ) {
        return state;
      }
      return newWorkingState(state, action);
    case 'startBreak':
      if (state.phase !== 'review' && state.phase !== 'module') return state;
      return {
        phase: 'break',
        scheduleId: state.scheduleId,
        candidateId: state.candidateId,
        assessmentId: state.assessmentId,
        nextSectionKey: action.nextSectionKey,
        resumeAt: action.resumeAt,
      };
    case 'showDirections':
      if (state.phase === 'loading' || state.phase === 'complete' || state.phase === 'submitting') {
        return state;
      }
      return {
        phase: 'directions',
        scheduleId: state.scheduleId,
        candidateId: state.candidateId,
        assessmentId: state.assessmentId,
      };
    case 'submit':
      // SAT-002: begin-finalization is legal from the question screen as well
      // as Review. A timeout on the last module must move the runner to
      // `submitting` whether or not the student ever opened Review; gating on
      // Review stranded the state machine on a failed finalization.
      if (state.phase !== 'review' && state.phase !== 'module') return state;
      return {
        phase: 'submitting',
        scheduleId: state.scheduleId,
        candidateId: state.candidateId,
        assessmentId: state.assessmentId,
      };
    case 'completed':
      if (state.phase !== 'submitting') return state;
      return { ...state, phase: 'complete', resultId: action.resultId };
    default:
      return state;
  }
}
