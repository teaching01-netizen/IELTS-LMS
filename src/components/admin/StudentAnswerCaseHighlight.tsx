import { Fragment } from 'react';
import { getCaseMismatchIndexes } from './studentAnswerComparison';

interface StudentAnswerCaseHighlightProps {
  readonly studentAnswer: string;
  readonly answerKey: string;
  readonly answerKeyVariants: readonly string[];
}

export function StudentAnswerCaseHighlight({
  studentAnswer,
  answerKey,
  answerKeyVariants,
}: StudentAnswerCaseHighlightProps) {
  if (!studentAnswer) {
    return 'Blank answer';
  }

  const hasExactAcceptedVariant = answerKeyVariants.some((variant) => (
    variant.normalize('NFKC').replace(/\s+/gu, ' ').trim()
      === studentAnswer.normalize('NFKC').replace(/\s+/gu, ' ').trim()
  ));
  const mismatchIndexes = hasExactAcceptedVariant ? new Set<number>() : getCaseMismatchIndexes(studentAnswer, answerKey);

  return Array.from(studentAnswer).map((character, index) => (
    <Fragment key={`${character}-${index}`}>
      {mismatchIndexes.has(index) ? (
        <mark
          className="rounded-sm bg-yellow-100 px-0.5 text-yellow-900 ring-1 ring-inset ring-yellow-300"
          title="Capitalization differs from answer key"
        >
          {character}
        </mark>
      ) : character}
    </Fragment>
  ));
}
