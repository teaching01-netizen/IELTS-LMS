export type SatSectionKey = 'reading-writing' | 'math';

export type SatRunnerState =
  | { phase: 'loading'; scheduleId: string; candidateId: string }
  | { phase: 'directions'; scheduleId: string; candidateId: string; assessmentId: string }
  | {
      phase: 'module';
      scheduleId: string;
      candidateId: string;
      assessmentId: string;
      sectionKey: SatSectionKey;
      moduleKey: string;
      questionIds: string[];
      questionIndex: number;
      answers: Record<string, string>;
      responseRevisions: Record<string, number>;
      reviewFlags: Record<string, boolean>;
      eliminatedOptionIds: Record<string, string[]>;
      toolState: Record<string, boolean>;
      startedAt: string;
      endsAt: string;
    }
  | {
      phase: 'review';
      scheduleId: string;
      candidateId: string;
      assessmentId: string;
      sectionKey: SatSectionKey;
      moduleKey: string;
      questionIds: string[];
      questionIndex: number;
      answers: Record<string, string>;
      responseRevisions: Record<string, number>;
      reviewFlags: Record<string, boolean>;
      eliminatedOptionIds: Record<string, string[]>;
      toolState: Record<string, boolean>;
      startedAt: string;
      endsAt: string;
    }
  | {
      phase: 'submitting';
      scheduleId: string;
      candidateId: string;
      assessmentId: string;
      answers: Record<string, string>;
    }
  | { phase: 'break'; scheduleId: string; candidateId: string; assessmentId: string; nextSectionKey: SatSectionKey; resumeAt: string }
  | { phase: 'complete'; scheduleId: string; candidateId: string; assessmentId: string; resultId: string };

export type SatRunnerAction =
  | { type: 'bootstrapLoaded'; assessmentId: string }
  | { type: 'moduleStarted'; sectionKey: SatSectionKey; moduleKey: string; questionIds: string[]; startedAt: string; endsAt: string; tools?: Record<string, boolean> }
  | { type: 'setResponse'; questionId: string; value: string }
  | { type: 'responseSaved'; questionId: string; revision: number }
  | { type: 'setReviewFlag'; questionId: string; flagged: boolean }
  | { type: 'toggleEliminatedOption'; questionId: string; optionId: string }
  | { type: 'setToolState'; tool: string; open: boolean }
  | { type: 'selectQuestion'; questionIndex: number }
  | { type: 'reviewModule' }
  | { type: 'returnToModule' }
  | { type: 'routeToModule'; sectionKey: SatSectionKey; moduleKey: string; questionIds: string[]; startedAt: string; endsAt: string; tools?: Record<string, boolean> }
  | { type: 'startBreak'; nextSectionKey: SatSectionKey; resumeAt: string }
  | { type: 'showDirections' }
  | { type: 'submit' }
  | { type: 'completed'; resultId: string }
  | { type: 'recover'; state: SatRunnerState };

export function createSatRunnerState(scheduleId: string, candidateId: string): SatRunnerState {
  return { phase: 'loading', scheduleId, candidateId };
}

function moduleState(state: Extract<SatRunnerState, { phase: 'module' }>, action: SatRunnerAction): SatRunnerState {
  switch (action.type) {
    case 'setResponse':
      return { ...state, answers: { ...state.answers, [action.questionId]: action.value } };
    case 'responseSaved':
      return { ...state, responseRevisions: { ...state.responseRevisions, [action.questionId]: action.revision } };
    case 'setReviewFlag':
      return { ...state, reviewFlags: { ...state.reviewFlags, [action.questionId]: action.flagged } };
    case 'toggleEliminatedOption': {
      const current = state.eliminatedOptionIds[action.questionId] ?? [];
      const next = current.includes(action.optionId)
        ? current.filter((optionId) => optionId !== action.optionId)
        : [...current, action.optionId];
      return { ...state, eliminatedOptionIds: { ...state.eliminatedOptionIds, [action.questionId]: next } };
    }
    case 'setToolState':
      return { ...state, toolState: { ...state.toolState, [action.tool]: action.open } };
    case 'selectQuestion':
      return { ...state, questionIndex: Math.max(0, Math.min(action.questionIndex, state.questionIds.length - 1)) };
    case 'reviewModule':
      return { ...state, phase: 'review' };
    case 'submit':
      return { phase: 'submitting', scheduleId: state.scheduleId, candidateId: state.candidateId, assessmentId: state.assessmentId, answers: state.answers };
    case 'recover':
      return action.state;
    default:
      return state;
  }
}

export function satRunnerReducer(state: SatRunnerState, action: SatRunnerAction): SatRunnerState {
  if (action.type === 'recover') return action.state;
  if (
    state.phase === 'module' &&
    action.type !== 'routeToModule' &&
    action.type !== 'startBreak'
  ) {
    return moduleState(state, action);
  }

  switch (action.type) {
    case 'bootstrapLoaded':
      if (state.phase !== 'loading') return state;
      return { phase: 'directions', scheduleId: state.scheduleId, candidateId: state.candidateId, assessmentId: action.assessmentId };
    case 'moduleStarted':
      if (state.phase !== 'directions' && state.phase !== 'break' && state.phase !== 'review') return state;
      return {
        phase: 'module',
        scheduleId: state.scheduleId,
        candidateId: state.candidateId,
        assessmentId: state.assessmentId,
        sectionKey: action.sectionKey,
        moduleKey: action.moduleKey,
        questionIds: action.questionIds,
        questionIndex: 0,
        answers: {},
        responseRevisions: {},
        reviewFlags: {},
        eliminatedOptionIds: {},
        toolState: action.tools ?? {},
        startedAt: action.startedAt,
        endsAt: action.endsAt,
      };
    case 'routeToModule':
      if (state.phase !== 'directions' && state.phase !== 'break' && state.phase !== 'review' && state.phase !== 'module') return state;
      return {
        phase: 'module',
        scheduleId: state.scheduleId,
        candidateId: state.candidateId,
        assessmentId: state.assessmentId,
        sectionKey: action.sectionKey,
        moduleKey: action.moduleKey,
        questionIds: action.questionIds,
        questionIndex: 0,
        answers: {},
        responseRevisions: {},
        reviewFlags: {},
        eliminatedOptionIds: {},
        toolState: action.tools ?? {},
        startedAt: action.startedAt,
        endsAt: action.endsAt,
      };
    case 'startBreak':
      if (state.phase !== 'review' && state.phase !== 'module') return state;
      return { phase: 'break', scheduleId: state.scheduleId, candidateId: state.candidateId, assessmentId: state.assessmentId, nextSectionKey: action.nextSectionKey, resumeAt: action.resumeAt };
    case 'returnToModule':
      if (state.phase !== 'review') return state;
      return { ...state, phase: 'module' };
    case 'showDirections':
      if (state.phase === 'loading' || state.phase === 'complete' || state.phase === 'submitting') return state;
      return { phase: 'directions', scheduleId: state.scheduleId, candidateId: state.candidateId, assessmentId: state.assessmentId };
    case 'submit':
      if (state.phase !== 'review') return state;
      return { phase: 'submitting', scheduleId: state.scheduleId, candidateId: state.candidateId, assessmentId: state.assessmentId, answers: state.answers };
    case 'completed':
      if (state.phase !== 'submitting') return state;
      return { ...state, phase: 'complete', resultId: action.resultId };
    default:
      return state;
  }
}
