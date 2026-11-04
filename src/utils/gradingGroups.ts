import type { StudentQuestionDescriptor } from '../features/exam-authoring/api/examAuthoringGateway';
import type { SentenceCompletionQuestion, TableCompletionBlock } from '../types';

/**
 * The one owner of grouped-slot identity and required-correct thresholds.
 *
 * Both delivered repository flows previously carried their own copy
 * (grading review/export, objective scoring, student adapter); they must agree
 * or the same group gets one question number and two different marks.
 */
export function getGroupedScoringSlotKey(
  descriptor: StudentQuestionDescriptor,
): string | null {
  if (typeof descriptor.rootId !== 'string') {
    return null;
  }
  // Only collapse slots explicitly marked as grouped scoring (e.g. 2-for-1),
  // not other uses of rootId such as the sub-answer tree.
  return descriptor.rootId.includes('::group::') ? descriptor.rootId : null;
}

/**
 * Required-correct threshold for a score group: the maximum explicit
 * `requiredCorrect` across its slots, defaulting to 1 (one correct slot earns
 * the group's mark).
 */
export function resolveGroupedScoringRequiredCorrect(
  groupQuestions: readonly StudentQuestionDescriptor[],
): number {
  const candidates: number[] = [];

  for (const question of groupQuestions) {
    if (
      (question.block.type === 'SENTENCE_COMPLETION' || question.block.type === 'NOTE_COMPLETION')
      && question.question
      && 'blanks' in question.question
      && question.answerIndex !== undefined
    ) {
      const blank = (question.question as SentenceCompletionQuestion).blanks[question.answerIndex];
      if (blank?.requiredCorrect !== undefined) {
        candidates.push(blank.requiredCorrect);
      }
      continue;
    }

    if (question.block.type === 'TABLE_COMPLETION' && question.answerIndex !== undefined) {
      const block = question.block as unknown as TableCompletionBlock;
      const cell = Array.isArray(block.cells) ? block.cells[question.answerIndex] : undefined;
      if (cell?.requiredCorrect !== undefined) {
        candidates.push(cell.requiredCorrect);
      }
    }
  }

  const normalized = candidates
    .map((value) => (Number.isFinite(value) ? Math.floor(value) : 0))
    .filter((value) => value >= 1);

  return normalized.length > 0 ? Math.max(...normalized) : 1;
}
