import type { StudentAnswerValue } from '../../../../types/studentAttempt';
import type {
  StudentExamSessionState,
  StudentExamStore,
} from './studentExamStoreFactory';

export const selectPhase = (state: StudentExamSessionState) => state.phase;
export const selectCurrentModule = (state: StudentExamSessionState) => state.navigation.currentModule;
export const selectCurrentQuestionId = (state: StudentExamSessionState) =>
  state.navigation.currentQuestionId;
export const selectDisplayTimeRemaining = (state: StudentExamSessionState) =>
  state.runtime.displayTimeRemaining;
export const selectAttemptSyncState = (state: StudentExamSessionState) => state.persistence.syncState;
export const selectAnswers = (state: StudentExamSessionState) => state.attempt.answers;
export const selectWritingAnswers = (state: StudentExamSessionState) =>
  state.attempt.writingAnswers;
export const selectFlags = (state: StudentExamSessionState) => state.attempt.flags;
export const selectBlocking = (state: StudentExamSessionState) => state.blocking;

export function selectQuestionAnswer(
  questionId: string,
): (state: StudentExamSessionState) => StudentAnswerValue | undefined {
  return (state) => state.attempt.answers[questionId];
}

export function selectQuestionFlag(questionId: string): (state: StudentExamSessionState) => boolean {
  return (state) => state.attempt.flags[questionId] ?? false;
}

export function selectWritingAnswer(taskId: string): (state: StudentExamSessionState) => string {
  return (state) => state.attempt.writingAnswers[taskId] ?? '';
}

export function subscribeToQuestionAnswer(
  store: StudentExamStore,
  questionId: string,
  listener: (answer: StudentAnswerValue | undefined) => void,
): () => void {
  return store.subscribe(selectQuestionAnswer(questionId), listener);
}
