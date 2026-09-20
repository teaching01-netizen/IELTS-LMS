import { describe, expect, it } from 'vitest';

import type { StudentQuestionDescriptor } from '@student/application/studentExamContentFacade';
import { getStudentQuestionNavigationViewModel } from '../studentQuestionNavigation';

function groupedQuestion(
  id: string,
  groupId: string,
  rootId: string,
): StudentQuestionDescriptor {
  return {
    id,
    blockId: `${groupId}-block`,
    groupId,
    groupLabel: groupId,
    isMulti: false,
    correctCount: 1,
    answerKey: id,
    block: {
      id: `${groupId}-block`,
      type: 'SENTENCE_COMPLETION',
      instruction: '',
      questions: [],
    } as any,
    question: null,
    rootId,
  };
}

describe('student question navigation grouping', () => {
  it('keeps grouped slots from different passages separate when root ids repeat', () => {
    const repeatedRootId = 'question::group::answer-pair';
    const questions = [
      groupedQuestion('passage-1-q1', 'passage-1', repeatedRootId),
      groupedQuestion('passage-1-q1-b', 'passage-1', repeatedRootId),
      groupedQuestion('passage-2-q1', 'passage-2', repeatedRootId),
      groupedQuestion('passage-2-q1-b', 'passage-2', repeatedRootId),
    ];

    const view = getStudentQuestionNavigationViewModel({
      questions,
      answers: {},
      flags: {},
      currentQuestionId: 'passage-2-q1-b',
    });

    expect(view.items).toHaveLength(2);
    expect(view.items.map((item) => item.groupId)).toEqual(['passage-1', 'passage-2']);
    expect(view.items.find((item) => item.groupId === 'passage-2')).toMatchObject({
      current: true,
    });
  });
});
