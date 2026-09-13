import { describe, expect, it } from 'vitest';
import {
  composeStudentQuestionPane,
  STUDENT_QUESTION_STACKED_FLAG_WIDTH_PX,
} from '../useStudentQuestionPaneComposition';

/**
 * P4: composition is a policy over the question pane's measured usable width,
 * not the device. `stackFlag` is the whole policy, so it is pinned here rather
 * than inferred from a rendered class name.
 */
describe('composeStudentQuestionPane', () => {
  it('keeps the trailing flag column at and above the threshold', () => {
    expect(composeStudentQuestionPane(STUDENT_QUESTION_STACKED_FLAG_WIDTH_PX)).toEqual({
      measured: true,
      stackFlag: false,
    });
    // A wide desktop pane and a comfortable iPad split both stay horizontal.
    expect(composeStudentQuestionPane(900).stackFlag).toBe(false);
    expect(composeStudentQuestionPane(560).stackFlag).toBe(false);
  });

  it('stacks the flag once the trailing column stops paying for itself', () => {
    // A narrow split and a phone land here alike — the decision never asks what
    // device it is, only how much room the question text actually has.
    expect(composeStudentQuestionPane(STUDENT_QUESTION_STACKED_FLAG_WIDTH_PX - 1).stackFlag).toBe(
      true,
    );
    expect(composeStudentQuestionPane(431).stackFlag).toBe(true);
  });
});
