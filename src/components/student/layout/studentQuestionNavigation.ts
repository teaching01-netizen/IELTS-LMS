import type { StudentQuestionDescriptor } from '@services/examAdapterService';

export function getStudentNavigableQuestions(
  questions: readonly StudentQuestionDescriptor[],
): StudentQuestionDescriptor[] {
  const seen = new Set<string>();

  return questions.filter((question) => {
    const key = question.rootId?.includes('::group::') ? question.rootId : question.id;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}
