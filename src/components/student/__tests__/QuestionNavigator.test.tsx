import React, { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { QuestionNavigator } from '../QuestionNavigator';
import type { StudentQuestionDescriptor } from '@services/examAdapterService';

const mockQuestions: StudentQuestionDescriptor[] = [
  {
    id: 'q1',
    number: 1,
    label: '1',
    groupId: 'group-1',
    groupLabel: 'Passage 1',
    rootId: 'q1',
    answerKey: 'q1',
    isMulti: false,
    answerType: 'scalar',
  },
  {
    id: 'q2',
    number: 2,
    label: '2',
    groupId: 'group-1',
    groupLabel: 'Passage 1',
    rootId: 'q2',
    answerKey: 'q2',
    isMulti: false,
    answerType: 'scalar',
  },
  {
    id: 'q3',
    number: 3,
    label: '3',
    groupId: 'group-2',
    groupLabel: 'Passage 2',
    rootId: 'q3',
    answerKey: 'q3',
    isMulti: false,
    answerType: 'scalar',
  },
];

describe('QuestionNavigator', () => {
  beforeEach(() => {
    HTMLDialogElement.prototype.showModal = vi.fn(function () {
      (this as HTMLDialogElement).open = true;
    });
    HTMLDialogElement.prototype.close = vi.fn(function () {
      (this as HTMLDialogElement).open = false;
    });
  });

  it('renders dialog with title', () => {
    render(
      <QuestionNavigator
        questions={mockQuestions}
        answers={{}}
        flags={{}}
        currentQuestionId={null}
        onNavigate={() => {}}
        onClose={() => {}}
      />,
    );
    expect(screen.getByText('Question Navigator')).toBeInTheDocument();
  });

  it('displays total and answered counts', () => {
    render(
      <QuestionNavigator
        questions={mockQuestions}
        answers={{ q1: 'A' }}
        flags={{}}
        currentQuestionId={null}
        onNavigate={() => {}}
        onClose={() => {}}
      />,
    );
    expect(screen.getByText(/Answered/)).toBeInTheDocument();
    expect(screen.getByText(/Unanswered/)).toBeInTheDocument();
  });

  it('displays flagged count', () => {
    render(
      <QuestionNavigator
        questions={mockQuestions}
        answers={{}}
        flags={{ q1: true, q2: true }}
        currentQuestionId={null}
        onNavigate={() => {}}
        onClose={() => {}}
      />,
    );
    expect(screen.getByText(/Flagged \(2\)/)).toBeInTheDocument();
  });

  it('keeps an answered question visibly flagged until the student unflags it', () => {
    const { rerender } = render(
      <QuestionNavigator
        questions={mockQuestions}
        answers={{}}
        flags={{ q1: true }}
        currentQuestionId={null}
        onNavigate={() => {}}
        onClose={() => {}}
      />,
    );

    expect(screen.getByRole('button', { name: '1' })).toHaveClass('bg-amber-100');

    rerender(
      <QuestionNavigator
        questions={mockQuestions}
        answers={{ q1: 'A' }}
        flags={{ q1: true }}
        currentQuestionId={null}
        onNavigate={() => {}}
        onClose={() => {}}
      />,
    );

    expect(screen.getByRole('button', { name: '1' })).toHaveClass(
      'bg-amber-100',
      'text-amber-800',
      'border-amber-300',
    );
  });

  it('calls onClose when close button is clicked', () => {
    const onClose = vi.fn();
    render(
      <QuestionNavigator
        questions={mockQuestions}
        answers={{}}
        flags={{}}
        currentQuestionId={null}
        onNavigate={() => {}}
        onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByLabelText('Close question navigator'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
  it('restores focus to the navigator trigger after the dialog closes', () => {
    function Harness() {
      const [open, setOpen] = useState(true);

      return (
        <>
          <button type="button" data-testid="navigator-trigger">
            Open navigator
          </button>
          {open ? (
            <QuestionNavigator
              questions={mockQuestions}
              answers={{}}
              flags={{}}
              currentQuestionId="q1"
              onNavigate={() => undefined}
              onClose={() => setOpen(false)}
            />
          ) : null}
        </>
      );
    }

    render(<Harness />);
    const trigger = screen.getByTestId('navigator-trigger');
    trigger.focus();

    fireEvent.click(screen.getByLabelText('Close question navigator'));

    expect(trigger).toHaveFocus();
  });


  it('calls onNavigate when a question button is clicked', () => {
    const onNavigate = vi.fn();
    render(
      <QuestionNavigator
        questions={mockQuestions}
        answers={{}}
        flags={{}}
        currentQuestionId={null}
        onNavigate={onNavigate}
        onClose={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '1' }));
    expect(onNavigate).toHaveBeenCalledWith('q1');
  });

  it('renders groups under their real passage labels', () => {
    render(
      <QuestionNavigator
        questions={mockQuestions}
        answers={{}}
        flags={{}}
        currentQuestionId={null}
        onNavigate={() => {}}
        onClose={() => {}}
      />,
    );
    expect(screen.getByText('Passage 1')).toBeInTheDocument();
    expect(screen.getByText('Passage 2')).toBeInTheDocument();
  });

  it('calls dialog show modal on mount', () => {
    render(
      <QuestionNavigator
        questions={mockQuestions}
        answers={{}}
        flags={{}}
        currentQuestionId={null}
        onNavigate={() => {}}
        onClose={() => {}}
      />,
    );
    expect(HTMLDialogElement.prototype.showModal).toHaveBeenCalled();
  });
});
