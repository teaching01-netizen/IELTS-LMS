import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { StudentQuestionDescriptor } from '@student/application/studentExamContentFacade';
import { StudentFooter } from '../StudentFooter';
import { StudentIeltsFooter } from '../StudentIeltsFooter';

function question(id: string, groupId: string): StudentQuestionDescriptor {
  return {
    id,
    blockId: id,
    groupId,
    groupLabel: `Section ${groupId}`,
    isMulti: false,
    correctCount: 1,
    answerKey: id,
    block: {} as StudentQuestionDescriptor['block'],
    question: null,
  };
}

// Part 1 has more numbers than the old single row could show at tablet widths.
const questions = [
  ...Array.from({ length: 13 }, (_, index) => question(`p1-q${index + 1}`, 'part-1')),
  ...Array.from({ length: 3 }, (_, index) => question(`p2-q${index + 1}`, 'part-2')),
];

function renderFooter(overrides: Partial<Parameters<typeof StudentIeltsFooter>[0]> = {}) {
  const props: Parameters<typeof StudentIeltsFooter>[0] = {
    questions,
    currentQuestionId: 'p1-q1',
    onNavigate: vi.fn(),
    answers: {},
    flags: {},
    onSubmit: vi.fn(),
    showSubmitButton: true,
    ...overrides,
  };
  render(<StudentIeltsFooter {...props} />);
  return props;
}

describe('StudentIeltsFooter', () => {
  it('shows every question of the active part in one row', () => {
    renderFooter();

    const partQuestions = screen.getByRole('group', { name: 'Part 1 questions' });
    const chips = within(partQuestions).getAllByRole('button');

    expect(partQuestions).not.toHaveClass('flex-wrap');
    expect(chips).toHaveLength(13);
    expect(chips.filter((chip) => chip.hasAttribute('aria-current'))).toHaveLength(1);
  });

  it('moves to another part through its tab and opens the first question of that part', () => {
    const { onNavigate } = renderFooter();

    fireEvent.click(screen.getByRole('button', { name: 'Part 2, 0 of 3 answered' }));

    expect(onNavigate).toHaveBeenCalledWith('p2-q1');
  });

  it('steps one question at a time and disables Previous on the first question', () => {
    const { onNavigate } = renderFooter({ currentQuestionId: 'p1-q1' });

    expect(screen.getByRole('button', { name: 'Previous question' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Next question' }));

    expect(onNavigate).toHaveBeenCalledWith('p1-q2');
  });

  it('submits from Finish', () => {
    const { onSubmit } = renderFooter();

    fireEvent.click(screen.getByRole('button', { name: 'Finish' }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('hides Finish when submission is not offered', () => {
    renderFooter({ showSubmitButton: false });

    expect(screen.queryByRole('button', { name: 'Finish' })).not.toBeInTheDocument();
  });
});

describe('StudentFooter exam-type routing', () => {
  const footerProps = {
    questions,
    currentQuestionId: 'p1-q1',
    onNavigate: () => {},
    answers: {},
    onSubmit: () => {},
  };

  it('uses the IELTS footer for IELTS exam types', () => {
    render(<StudentFooter {...footerProps} examType="Academic" layoutMode="wide" />);

    expect(screen.getByRole('group', { name: 'Parts' })).toBeInTheDocument();
  });

  it('keeps the existing footer for ACT and for callers that do not name an exam type', () => {
    const { unmount } = render(<StudentFooter {...footerProps} examType="ACT" />);
    expect(screen.queryByRole('group', { name: 'Parts' })).not.toBeInTheDocument();
    unmount();

    render(<StudentFooter {...footerProps} />);
    expect(screen.queryByRole('group', { name: 'Parts' })).not.toBeInTheDocument();
  });
});
