export interface StudentAnswerComparison {
  readonly expectedAnswer: string;
  readonly reason: string;
}

function normalizeForCaseComparison(value: string): string {
  return value.normalize('NFKC').replace(/\s+/gu, ' ').trim();
}

function normalizeUnicode(value: string): string {
  return value.normalize('NFKC');
}

function getCaseMismatchCount(studentAnswer: string, answerKey: string): number | null {
  const normalizedStudentAnswer = normalizeForCaseComparison(studentAnswer);
  const normalizedAnswerKey = normalizeForCaseComparison(answerKey);
  if (!normalizedStudentAnswer || normalizedStudentAnswer.toLowerCase() !== normalizedAnswerKey.toLowerCase()) {
    return null;
  }

  const studentCharacters = Array.from(normalizedStudentAnswer);
  const answerKeyCharacters = Array.from(normalizedAnswerKey);
  if (studentCharacters.length !== answerKeyCharacters.length) return null;

  return studentCharacters.reduce((count, character, index) => {
    const answerKeyCharacter = answerKeyCharacters[index];
    return count + (answerKeyCharacter && character !== answerKeyCharacter ? 1 : 0);
  }, 0);
}

export function getClosestAcceptedAnswer(
  studentAnswer: string,
  primaryAnswerKey: string,
  answerKeyVariants: readonly string[],
): string {
  const candidates = [...new Set(
    [primaryAnswerKey, ...answerKeyVariants].map((answer) => answer.trim()).filter(Boolean),
  )];
  let closest: { readonly answer: string; readonly mismatchCount: number; readonly order: number } | null = null;

  for (const [order, candidate] of candidates.entries()) {
    const mismatchCount = getCaseMismatchCount(studentAnswer, candidate);
    if (mismatchCount === null) continue;

    if (
      !closest
      || mismatchCount < closest.mismatchCount
      || (mismatchCount === closest.mismatchCount && order < closest.order)
    ) {
      closest = { answer: candidate, mismatchCount, order };
    }
  }

  return closest?.answer || primaryAnswerKey.trim() || answerKeyVariants[0]?.trim() || '';
}

export function getStudentAnswerComparison(
  studentAnswer: string,
  primaryAnswerKey: string,
  answerKeyVariants: readonly string[],
): StudentAnswerComparison | null {
  if (!studentAnswer.trim()) return null;

  const hasExactAcceptedVariant = answerKeyVariants.some((variant) => (
    normalizeForCaseComparison(variant) === normalizeForCaseComparison(studentAnswer)
  ));
  if (hasExactAcceptedVariant) return null;

  const expectedAnswer = getClosestAcceptedAnswer(studentAnswer, primaryAnswerKey, answerKeyVariants);
  if (!expectedAnswer || studentAnswer === expectedAnswer) return null;

  const normalizedStudentAnswer = normalizeForCaseComparison(studentAnswer);
  const normalizedExpectedAnswer = normalizeForCaseComparison(expectedAnswer);
  const caseDiffers = normalizedStudentAnswer !== normalizedExpectedAnswer
    && normalizedStudentAnswer.toLowerCase() === normalizedExpectedAnswer.toLowerCase();
  const spacingDiffers = normalizeUnicode(studentAnswer).toLowerCase()
    !== normalizeUnicode(expectedAnswer).toLowerCase();

  if (caseDiffers && spacingDiffers) {
    return { expectedAnswer, reason: 'Capitalization and spacing differ from the closest accepted answer.' };
  }
  if (caseDiffers) {
    return { expectedAnswer, reason: 'Capitalization differs from the closest accepted answer.' };
  }
  if (spacingDiffers) {
    return { expectedAnswer, reason: 'Spacing differs from the closest accepted answer.' };
  }

  return { expectedAnswer, reason: 'This answer does not exactly match an accepted answer.' };
}

export function getCaseMismatchIndexes(
  studentAnswer: string,
  answerKey: string,
): ReadonlySet<number> {
  if (getCaseMismatchCount(studentAnswer, answerKey) === null) {
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
