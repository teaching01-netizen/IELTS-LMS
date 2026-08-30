import type { SatQuestionResponseDraft } from './satResponses';
import { isSatResponseAnswered } from './satResponses';

export type SatQuestionStatus = 'answered' | 'unanswered';

export interface SatQuestionNavigationItem {
  id: string;
  index: number;
  number: number;
  status: SatQuestionStatus;
  current: boolean;
  markedForReview: boolean;
}

export function buildSatQuestionNavigationItems(
  questionIds: readonly string[],
  currentQuestionIndex: number,
  responses: Readonly<Record<string, SatQuestionResponseDraft>>,
): SatQuestionNavigationItem[] {
  return questionIds.map((id, index) => {
    const response = responses[id];
    return {
      id,
      index,
      number: index + 1,
      status: isSatResponseAnswered(response) ? 'answered' : 'unanswered',
      current: index === currentQuestionIndex,
      markedForReview: response?.markedForReview ?? false,
    };
  });
}
export function answeredSatQuestionCount(
  questionIds: readonly string[],
  responses: Readonly<Record<string, SatQuestionResponseDraft>>,
): number {
  return questionIds.reduce(
    (count, id) => count + Number(isSatResponseAnswered(responses[id])),
    0,
  );
}

export function satQuestionIndexById(questionIds: readonly string[], questionId: string): number {
  return Math.max(0, questionIds.indexOf(questionId));
}
