import type { SatQuestionAnnotations, SatQuestionResponseDraft } from '../domain/satResponses';
import { emptySatQuestionResponse } from '../domain/satResponses';
import type { SatActiveTool, SatToolCapabilities, SatToolId } from '../domain/satTools';
import { emptySatToolCapabilities, nextSatActiveTool } from '../domain/satTools';

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
  | { type: 'responseSaved'; questionId: string; revision: number }
  | { type: 'setReviewFlag'; questionId: string; flagged: boolean }
  | { type: 'toggleEliminatedOption'; questionId: string; optionId: string }
  | { type: 'setAnnotations'; questionId: string; annotations: SatQuestionAnnotations }
  | { type: 'toggleTool'; tool: SatToolId }
  | { type: 'closeTool' }
  | { type: 'selectQuestion'; questionIndex: number }
  | { type: 'reviewModule' }
  | { type: 'returnToModule' }
  | { type: 'routeToModule'; sectionKey: SatSectionKey; moduleKey: string; questionIds: string[]; startedAt: string; endsAt: string; toolCapabilities?: SatToolCapabilities }
  | { type: 'startBreak'; nextSectionKey: SatSectionKey; resumeAt: string }
  | { type: 'showDirections' }
  | { type: 'submit' }
  | { type: 'completed'; resultId: string }
  | { type: 'recover'; state: SatRunnerState };

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
      return updateResponse(state, action.questionId, (response) => ({ ...response, answer: action.value }));
    case 'hydrateResponse':
      return {
        ...state,
        responses: { ...state.responses, [action.response.questionId]: action.response },
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
      return updateResponse(state, action.questionId, (response) => {
        const current = response.eliminatedOptionIds;
        const eliminatedOptionIds = current.includes(action.optionId)
          ? current.filter((optionId) => optionId !== action.optionId)
          : [...current, action.optionId];
        return { ...response, eliminatedOptionIds };
      });
    case 'toggleTool':
      return {
        ...state,
        activeTool: nextSatActiveTool(state.toolCapabilities, state.activeTool, action.tool),
      };
    case 'closeTool':
      return { ...state, activeTool: null };
    case 'selectQuestion':
      return {
        ...state,
        questionIndex: Math.max(0, Math.min(action.questionIndex, state.questionIds.length - 1)),
      };
    case 'reviewModule':
      return state.phase === 'module' ? { ...state, phase: 'review', activeTool: null } : state;
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
    startedAt: action.startedAt,
    endsAt: action.endsAt,
  };
}

export function satRunnerReducer(state: SatRunnerState, action: SatRunnerAction): SatRunnerState {
  if (action.type === 'recover') return action.state;

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
      if (state.phase !== 'review') return state;
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
