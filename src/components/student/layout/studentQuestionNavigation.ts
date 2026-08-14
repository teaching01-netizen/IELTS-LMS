import type { StudentQuestionDescriptor } from '@services/examAdapterService';

export function getStudentQuestionNavigationKey(question: StudentQuestionDescriptor): string {
  return question.rootId?.includes('::group::') ? question.rootId : question.id;
}

export function getStudentNavigableQuestions(
  questions: readonly StudentQuestionDescriptor[],
): StudentQuestionDescriptor[] {
  const seen = new Set<string>();

  return questions.filter((question) => {
    const key = getStudentQuestionNavigationKey(question);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}
