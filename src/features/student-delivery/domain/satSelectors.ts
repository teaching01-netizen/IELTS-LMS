import type { DeliveredQuestion } from '../contracts/assessmentDelivery';
import type { SatQuestionResponseDraft } from './satResponses';
import { satQuestionResponseStatus } from './satResponses';

export type SatQuestionStatus = 'answered' | 'unanswered' | 'invalid';

export interface SatQuestionIdentity {
  examQuestionId: string;
  questionType: DeliveredQuestion['questionType'];
}

export interface SatQuestionNavigationItem {
  id: string;
  index: number;
  number: number;
  status: SatQuestionStatus;
  current: boolean;
  markedForReview: boolean;
}

function questionTypesById(
  questions: readonly SatQuestionIdentity[],
): ReadonlyMap<string, DeliveredQuestion['questionType']> {
  return new Map(questions.map((question) => [question.examQuestionId, question.questionType]));
}

export function buildSatQuestionNavigationItems(
  questionIds: readonly string[],
  currentQuestionIndex: number,
  responses: Readonly<Record<string, SatQuestionResponseDraft>>,
  questions: readonly SatQuestionIdentity[],
): SatQuestionNavigationItem[] {
  const types = questionTypesById(questions);
  return questionIds.map((id, index) => {
    const response = responses[id];
    return {
      id,
      index,
      number: index + 1,
      status: satQuestionResponseStatus(response, types.get(id)),
      current: index === currentQuestionIndex,
      markedForReview: response?.markedForReview ?? false,
    };
  });
}

export function answeredSatQuestionCount(
  questionIds: readonly string[],
  responses: Readonly<Record<string, SatQuestionResponseDraft>>,
  questions: readonly SatQuestionIdentity[],
): number {
  const types = questionTypesById(questions);
  return questionIds.reduce(
    (count, id) => count + Number(satQuestionResponseStatus(responses[id], types.get(id)) === 'answered'),
    0,
  );
}

export function invalidSatQuestionCount(
  items: readonly SatQuestionNavigationItem[],
): number {
  return items.reduce((count, item) => count + Number(item.status === 'invalid'), 0);
}

export function satQuestionIndexById(questionIds: readonly string[], questionId: string): number {
  return Math.max(0, questionIds.indexOf(questionId));
}
