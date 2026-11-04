import type { CsvColumn } from '../../gradingReviewUtils';
import type { ObjectiveRowContext } from '../types';

import { toDisplayValue, toOptionalFiniteNumber } from '../pdf/text';
import { answersMatchCaseExact, answersMatchForEntry } from '../../../../utils/acceptedAnswers';

export type ObjectiveQuestionTableRow = {
  question: string;
  studentAnswer: string;
  rightAnswer: string;
  correct: '' | 'Yes' | 'No';
  score: string;
};

/**
 * Display-only separator for coalesced score-group rows. Deliberately not
 * " | ": a pipe separates accepted variants on both stacks, so a display
 * merge must never emit text that could be parsed as a variant list.
 */
const GROUP_ROW_DISPLAY_SEPARATOR = ', ';

/** Appends `right` unless it is empty or already present as a display entry. */
function joinDistinctDisplayValues(left: string, right: string): string {
  if (!left) return right;
  if (!right || left.split(GROUP_ROW_DISPLAY_SEPARATOR).includes(right)) return left;
  return `${left}${GROUP_ROW_DISPLAY_SEPARATOR}${right}`;
}

/**
 * Builds a stable, teacher-oriented row model for objective exports (Reading/Listening).
 *
 * Invariants:
 * - One row per `answer:*` column, except slots sharing one `scoreGroup:` mark
 *   (2-for-1 groups), which coalesce into a single row so Yes counts match totals.
 * - `rightAnswer:*` and `score:*` keys are best-effort; missing keys yield empty values.
 * - Correctness is derived from numeric score when present (authoritative saved score),
 *   else default strict: case-exact unless `caseSensitiveByQuestionId[id]` is explicitly false.
 */
export function buildObjectiveQuestionTableRows(
  columns: CsvColumn[],
  row: Record<string, unknown>,
  context: ObjectiveRowContext = {},
): ObjectiveQuestionTableRow[] {
  const {
    caseSensitiveByQuestionId = {},
    groupThresholdByScoreKey = {},
  } = context;
  const scoreKeyByLabel = new Map<string, string>();
  for (const column of columns) {
    const key = column.key;
    if (!key.startsWith('score:') && !key.startsWith('scoreGroup:')) continue;
    scoreKeyByLabel.set(column.label.trim(), key);
  }

  type ScoredRow = ObjectiveQuestionTableRow & { scoreKey: string; baseQuestion: string };
  const rows: ScoredRow[] = [];
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
          scoreKey,
          baseQuestion,
        });
      });
      continue;
    }

    let correct: '' | 'Yes' | 'No' = '';
    if (scoreNum !== null) {
      correct = scoreNum > 0 ? 'Yes' : 'No';
    } else if (studentAnswer.trim() !== '' && rightAnswer.trim() !== '') {
      // Compare each accepted answer separately; the joined display string
      // ("a | b") is not itself an accepted answer. Split on any pipe
      // spacing ("a|b", "a |b", "a| b") to match sanitizeAcceptedAnswers.
      const alternatives = rightAnswer.split('|').map((value) => value.trim()).filter(Boolean);
      const strict = caseSensitiveByQuestionId[id] !== false;
      const matches = strict
        ? alternatives.some((alternative) => answersMatchCaseExact(studentAnswer, alternative))
        : alternatives.some((alternative) => answersMatchForEntry(studentAnswer, alternative, false));
      correct = matches ? 'Yes' : 'No';
    }

    rows.push({
      question,
      studentAnswer,
      rightAnswer,
      correct,
      score: scoreValue,
      scoreKey,
      baseQuestion,
    });
  }

  // Slots sharing one scoreGroup mark (2-for-1 groups) coalesce into a single
  // row: per-slot rows would otherwise repeat the same group verdict and break
  // Yes==total. The merged row carries the group score once. Without a saved
  // group score, member verdicts are recomputed against the group threshold
  // (default any-correct, mirroring the scorer's requiredCorrect default).
  const merged: ObjectiveQuestionTableRow[] = [];
  const groupIndex = new Map<string, number>();
  interface GroupAccumulator {
    readonly firstIndex: number;
    yesCount: number;
    blankCount: number;
    savedScore: string | null;
  }
  const groupAccumulators = new Map<string, GroupAccumulator>();
  for (const entry of rows) {
    const { scoreKey: entryScoreKey, baseQuestion: entryBase, ...row } = entry;
    if (!entryScoreKey.startsWith('scoreGroup:')) {
      merged.push(row);
      continue;
    }
    const existing = groupIndex.get(entryScoreKey);
    if (existing === undefined) {
      groupIndex.set(entryScoreKey, merged.length);
      merged.push({ ...row, question: entryBase });
      groupAccumulators.set(entryScoreKey, {
        firstIndex: merged.length - 1,
        yesCount: row.correct === 'Yes' ? 1 : 0,
        blankCount: row.correct === '' ? 1 : 0,
        savedScore: toOptionalFiniteNumber(row.score) === null ? null : row.score,
      });
      continue;
    }
    const target = merged[existing]!;
    merged[existing] = {
      ...target,
      studentAnswer: joinDistinctDisplayValues(target.studentAnswer, row.studentAnswer),
      rightAnswer: joinDistinctDisplayValues(target.rightAnswer, row.rightAnswer),
    };
    const accumulator = groupAccumulators.get(entryScoreKey)!;
    if (row.correct === 'Yes') accumulator.yesCount += 1;
    if (row.correct === '') accumulator.blankCount += 1;
    if (accumulator.savedScore === null && toOptionalFiniteNumber(row.score) !== null) {
      accumulator.savedScore = row.score;
    }
  }

  // Evaluate each group's threshold exactly once from every member verdict:
  // merging pairwise would discard votes for 3+ slot groups.
  for (const [scoreKey, accumulator] of groupAccumulators) {
    const row = merged[accumulator.firstIndex]!;
    if (accumulator.savedScore !== null) {
      merged[accumulator.firstIndex] = { ...row, score: accumulator.savedScore };
      continue;
    }
    const threshold = groupThresholdByScoreKey[scoreKey] ?? 1;
    merged[accumulator.firstIndex] = {
      ...row,
      correct: accumulator.blankCount > 0
        ? ''
        : accumulator.yesCount >= threshold ? 'Yes' : 'No',
      score: '',
    };
  }

  return merged;
}
