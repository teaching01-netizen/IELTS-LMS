import { expect, test } from 'vitest';
import { createInitialExamState, getQuestionAnswer, getStudentQuestionsForModule } from '../examAdapterService';
import { ALL_QUESTION_TYPES, blockForType } from '../../components/student/__tests__/support/examFixtures';
import type { StudentAnswerValue } from '../../types/answers';

for (const section of ['reading', 'listening'] as const) {
  test.each(ALL_QUESTION_TYPES)(`${section} restores saved %s responses in every question slot`, (type) => {
    const exam = createInitialExamState('IELTS answer recovery', 'Academic');
    const block = blockForType(type);
    exam.reading.passages = [{ id: 'passage', title: 'Passage', content: '', blocks: [block], images: [], wordCount: 0 }];
    exam.listening.parts = [{ id: 'part', title: 'Part', blocks: [block] }];
    const questions = getStudentQuestionsForModule(exam, section);
    expect(questions.length).toBeGreaterThan(0);
    const saved = Object.fromEntries(questions.map((question, index) => [
      question.id, question.isMulti ? ['choice-a', 'choice-c'] : `saved ${index} ภาษาไทย`,
    ]));
    const reloaded = JSON.parse(JSON.stringify(saved)) as Record<string, StudentAnswerValue>;
    for (const question of questions) {
      expect(getQuestionAnswer(question, reloaded), question.id).toEqual(saved[question.id]);
    }
  });
}
