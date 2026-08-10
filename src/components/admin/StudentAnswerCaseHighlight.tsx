import React from 'react';

interface StudentAnswerCaseHighlightProps {
  readonly studentAnswer: string;
  readonly answerKey: string;
  readonly answerKeyVariants: readonly string[];
}

function normalizeForCaseComparison(value: string): string {
  return value.normalize('NFKC').replace(/\s+/gu, ' ').trim();
}

function answersMatchIgnoringCase(studentAnswer: string, answerKey: string): boolean {
  const normalizedStudentAnswer = normalizeForCaseComparison(studentAnswer);
  const normalizedAnswerKey = normalizeForCaseComparison(answerKey);

  return Boolean(normalizedStudentAnswer)
    && normalizedStudentAnswer.toLowerCase() === normalizedAnswerKey.toLowerCase();
}

function getCaseMismatchIndexes(studentAnswer: string, answerKey: string): ReadonlySet<number> {
  if (!answersMatchIgnoringCase(studentAnswer, answerKey)) {
    return new Set<number>();
  }

  const studentCharacters = Array.from(studentAnswer);
  const answerKeyCharacters = Array.from(answerKey);
  if (studentCharacters.length !== answerKeyCharacters.length) {
    return new Set<number>();
  }

  const mismatchIndexes = new Set<number>();
  studentCharacters.forEach((character, index) => {
    const answerKeyCharacter = answerKeyCharacters[index];
    if (
      answerKeyCharacter
      && character !== answerKeyCharacter
      && character.toLowerCase() === answerKeyCharacter.toLowerCase()
    ) {
      mismatchIndexes.add(index);
    }
  });
  return mismatchIndexes;
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
    normalizeForCaseComparison(variant) === normalizeForCaseComparison(studentAnswer)
  ));
  const mismatchIndexes = hasExactAcceptedVariant
    ? new Set<number>()
    : getCaseMismatchIndexes(studentAnswer, answerKey);

  return Array.from(studentAnswer).map((character, index) => (
    <React.Fragment key={`${character}-${index}`}>
      {mismatchIndexes.has(index) ? (
        <mark
          className="rounded-sm bg-yellow-100 px-0.5 text-yellow-900 ring-1 ring-inset ring-yellow-300"
          title="Capitalization differs from answer key"
        >
          {character}
        </mark>
      ) : character}
    </React.Fragment>
  ));
}
