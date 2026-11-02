import type { CsvColumn } from '../../gradingReviewUtils';

import { toDisplayValue, toOptionalFiniteNumber } from '../pdf/text';
import { answersMatch } from '../../../../utils/acceptedAnswers';

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
 * - Correctness is derived from numeric score when present, else a case-sensitive normalized string compare.
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

    const rawSelectionScores = row[`selectionScores:${id}`];
    if (Array.isArray(rawSelectionScores) && rawSelectionScores.length > 1) {
      const selectionAnswers = row[`selectionAnswers:${id}`];
      const selectionCorrectAnswers = row[`selectionCorrectAnswers:${id}`];
      const startNumber = Number.parseInt(baseQuestion.replace(/^Q/i, ''), 10);
      rawSelectionScores.forEach((rawScore, index) => {
        const selectionScore = toOptionalFiniteNumber(rawScore) ?? 0;
        rows.push({
          question: Number.isFinite(startNumber)
            ? `Q${startNumber + index}`
            : `${baseQuestion} (${index + 1})`,
          studentAnswer: Array.isArray(selectionAnswers)
            ? toDisplayValue(selectionAnswers[index])
            : '',
          rightAnswer: Array.isArray(selectionCorrectAnswers)
            ? selectionCorrectAnswers.map((value) => toDisplayValue(value)).join(' | ')
            : rightAnswer,
          correct: selectionScore > 0 ? 'Yes' : 'No',
          score: String(selectionScore),
        });
      });
      continue;
    }

    let correct: '' | 'Yes' | 'No' = '';
    if (scoreNum !== null) {
      correct = scoreNum > 0 ? 'Yes' : 'No';
    } else if (studentAnswer.trim() !== '' && rightAnswer.trim() !== '') {
      // Compare each accepted answer separately; the joined display string
      // ("a | b") is not itself an accepted answer.
      const alternatives = rightAnswer.split(' | ').map((value) => value.trim()).filter(Boolean);
      correct = alternatives.some((alternative) => answersMatch(studentAnswer, alternative))
        ? 'Yes'
        : 'No';
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
