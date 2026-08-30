export interface SatQuestionAnnotations extends Record<string, unknown> {
  version: 1;
  note: string;
}

export interface SatQuestionResponseDraft {
  questionId: string;
  answer: string;
  markedForReview: boolean;
  eliminatedOptionIds: string[];
  annotations: SatQuestionAnnotations;
}

export function emptySatAnnotations(): SatQuestionAnnotations {
  return { version: 1, note: '' };
}

export function normalizeSatAnnotations(value: Record<string, unknown>): SatQuestionAnnotations {
  return {
    version: 1,
    note: typeof value['note'] === 'string' ? value['note'].slice(0, 2_000) : '',
  };
}

export function emptySatQuestionResponse(questionId: string): SatQuestionResponseDraft {
  return {
    questionId,
    answer: '',
    markedForReview: false,
    eliminatedOptionIds: [],
    annotations: emptySatAnnotations(),
  };
}
export function responseForQuestion(
  responses: Readonly<Record<string, SatQuestionResponseDraft>>,
  questionId: string,
): SatQuestionResponseDraft {
  return responses[questionId] ?? emptySatQuestionResponse(questionId);
}

export function isSatResponseAnswered(response: SatQuestionResponseDraft | undefined): boolean {
  return Boolean(response?.answer.trim());
}
