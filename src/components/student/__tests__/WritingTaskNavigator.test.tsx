import React, { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { WritingTaskNavigator } from '../WritingTaskNavigator';
import type { WritingTaskConfig } from '../../../types';

const mockTasks: WritingTaskConfig[] = [
  {
    id: 'task1',
    label: 'Task 1',
    taskType: 'task1-academic',
    minWords: 150,
    recommendedTime: 20,
  },
  {
    id: 'task2',
    label: 'Task 2',
    taskType: 'task2-essay',
    minWords: 250,
    recommendedTime: 40,
  },
];

describe('WritingTaskNavigator', () => {
  beforeEach(() => {
    HTMLDialogElement.prototype.showModal = vi.fn(function () {
      (this as HTMLDialogElement).open = true;
    });
    HTMLDialogElement.prototype.close = vi.fn(function () {
      (this as HTMLDialogElement).open = false;
    });
  });

  it('renders the dialog with title and task list', () => {
    render(
      <WritingTaskNavigator
        tasks={mockTasks}
        writingAnswers={{}}
        currentQuestionId={null}
        onNavigate={() => {}}
        onClose={() => {}}
      />,
    );
    expect(screen.getByText('Task Navigator')).toBeInTheDocument();
    expect(screen.getByText('Task 1')).toBeInTheDocument();
    expect(screen.getByText('Task 2')).toBeInTheDocument();
  });

  it('shows the answered summary', () => {
    render(
      <WritingTaskNavigator
        tasks={mockTasks}
        writingAnswers={{ task1: 'The chart shows a rise in temperatures.' }}
        currentQuestionId={null}
        onNavigate={() => {}}
        onClose={() => {}}
      />,
    );
    expect(screen.getByText('1 of 2 tasks answered')).toBeInTheDocument();
  });

  it('marks answered tasks and shows the word count', () => {
    render(
      <WritingTaskNavigator
        tasks={mockTasks}
        writingAnswers={{ task1: 'one two three' }}
        currentQuestionId={null}
        onNavigate={() => {}}
        onClose={() => {}}
      />,
    );
    expect(screen.getByText('3 words')).toBeInTheDocument();
    expect(screen.getAllByText('Answered')).toHaveLength(1);
    expect(screen.getAllByText('Unanswered')).toHaveLength(1);
  });

  it('marks the current task with the solid blue number square', () => {
    render(
      <WritingTaskNavigator
        tasks={mockTasks}
        writingAnswers={{}}
        currentQuestionId="task2"
        onNavigate={() => {}}
        onClose={() => {}}
      />,
    );
    const currentButton = screen.getByRole('button', { name: /Task 2/ });
    expect(currentButton).toHaveClass('border-blue-800', 'bg-blue-50');
    const numberSquare = currentButton.querySelector('span');
    expect(numberSquare).toHaveClass('bg-blue-800', 'text-white');
  });

  it('calls onNavigate and onClose when a task is clicked', () => {
    const onNavigate = vi.fn();
    const onClose = vi.fn();
    render(
      <WritingTaskNavigator
        tasks={mockTasks}
        writingAnswers={{}}
        currentQuestionId={null}
        onNavigate={onNavigate}
        onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Task 1/ }));
    expect(onNavigate).toHaveBeenCalledWith('task1');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when the close button is clicked', () => {
    const onClose = vi.fn();
    render(
      <WritingTaskNavigator
        tasks={mockTasks}
        writingAnswers={{}}
        currentQuestionId={null}
        onNavigate={() => {}}
        onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByLabelText('Close task navigator'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on Escape', () => {
    const onClose = vi.fn();
    render(
      <WritingTaskNavigator
        tasks={mockTasks}
        writingAnswers={{}}
        currentQuestionId={null}
        onNavigate={() => {}}
        onClose={onClose}
      />,
    );
    const dialog = screen.getByRole('dialog', { name: 'Task Navigator' });
    dialog.dispatchEvent(new Event('cancel', { cancelable: true }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('shows an empty state when no tasks are configured', () => {
    render(
      <WritingTaskNavigator
        tasks={[]}
        writingAnswers={{}}
        currentQuestionId={null}
        onNavigate={() => {}}
        onClose={() => {}}
      />,
    );
    expect(screen.getByText('No writing tasks configured.')).toBeInTheDocument();
  });

  it('restores focus to the navigator trigger after the dialog closes', () => {
    function Harness() {
      const [open, setOpen] = useState(true);

      return (
        <>
          <button type="button" data-testid="task-navigator-trigger">
            Open task navigator
          </button>
          {open ? (
            <WritingTaskNavigator
              tasks={mockTasks}
              writingAnswers={{}}
              currentQuestionId={null}
              onNavigate={() => undefined}
              onClose={() => setOpen(false)}
            />
          ) : null}
        </>
      );
    }

    render(<Harness />);
    const trigger = screen.getByTestId('task-navigator-trigger');
    trigger.focus();

    fireEvent.click(screen.getByLabelText('Close task navigator'));

    expect(trigger).toHaveFocus();
  });
});
