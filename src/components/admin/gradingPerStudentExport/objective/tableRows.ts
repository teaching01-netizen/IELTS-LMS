import type { CsvColumn } from '../../gradingReviewUtils';

import { normalizeAnswer, toDisplayValue, toOptionalFiniteNumber } from '../pdf/text';

export type ObjectiveQuestionTableRow = {
  question: string;
  studentAnswer: string;
  rightAnswer: string;
  correct: '' | 'Yes' | 'No';
  score: string;
};

/**
 * Builds a stable, teacher-oriented row model for objective exports (Reading/Listening).
 *
 * Invariants:
 * - One row per `answer:*` column in the wide export.
 * - `rightAnswer:*` and `score:*` keys are best-effort; missing keys yield empty values.
 * - Correctness is derived from numeric score when present, else a normalized string compare.
 */
export function buildObjectiveQuestionTableRows(
  columns: CsvColumn[],
  row: Record<string, unknown>,
): ObjectiveQuestionTableRow[] {
  const scoreKeyByLabel = new Map<string, string>();
  for (const column of columns) {
    const key = column.key;
    if (!key.startsWith('score:') && !key.startsWith('scoreGroup:')) continue;
    scoreKeyByLabel.set(column.label.trim(), key);
  }

  const rows: ObjectiveQuestionTableRow[] = [];
  for (const column of columns) {
    if (!column.key.startsWith('answer:')) continue;
    const id = column.key.slice('answer:'.length);
    const label = column.label.trim();
    const baseQuestion = label.replace(/\s+Answer.*$/i, '').trim();
    const suffixMatch = label.match(/Answer\s*(\(\d+\))/i);
    const question = suffixMatch ? `${baseQuestion} ${suffixMatch[1]}` : baseQuestion;

    const studentAnswer = toDisplayValue(row[column.key]);
    const rightAnswer = toDisplayValue(row[`rightAnswer:${id}`]);

    const scoreLabel = `${baseQuestion} Score`;
    const scoreKey = scoreKeyByLabel.get(scoreLabel) ?? `score:${id}`;
    const scoreValue = toDisplayValue(row[scoreKey]);
    const scoreNum = toOptionalFiniteNumber(row[scoreKey]);

    let correct: '' | 'Yes' | 'No' = '';
    if (scoreNum !== null) {
      correct = scoreNum > 0 ? 'Yes' : 'No';
    } else if (studentAnswer.trim() !== '' && rightAnswer.trim() !== '') {
      correct = normalizeAnswer(studentAnswer) === normalizeAnswer(rightAnswer) ? 'Yes' : 'No';
    }

    rows.push({
      question,
      studentAnswer,
      rightAnswer,
      correct,
      score: scoreValue,
    });
  }

  return rows;
}

