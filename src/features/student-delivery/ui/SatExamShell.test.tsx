import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SatExamShell, type SatExamShellProps } from './SatExamShell';

function props(overrides: Partial<SatExamShellProps> = {}): SatExamShellProps {
  return {
    sectionLabel: 'Math', moduleTitle: 'Module 1', remainingLabel: '34:58', saveStatus: 'saved',
    questionIndex: 0, questionCount: 3, answered: new Set(['q1']), questionIds: ['q1', 'q2', 'q3'],
    reviewFlags: {}, currentQuestionId: 'q1', calculatorAvailable: true, calculatorOpen: false,
    referenceAvailable: true, referenceOpen: false, blocked: false, children: <div>Question body</div>,
    onSelectQuestion: vi.fn(), onToggleReview: vi.fn(), onToggleCalculator: vi.fn(), onToggleReference: vi.fn(),
    onPrevious: vi.fn(), onNext: vi.fn(), onReviewModule: vi.fn(), ...overrides,
  };
}

describe('SatExamShell', () => {
  it('keeps calculator capability explicit and exposes current timer/status', () => {
    render(<SatExamShell {...props()} />);
    expect(screen.getByText('34:58')).toBeInTheDocument();
    expect(screen.getByText('Saved')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Calculator' })).toBeInTheDocument();
  });

  it('does not render calculator controls when the module policy excludes them', () => {
    render(<SatExamShell {...props({ calculatorAvailable: false })} />);
    expect(screen.queryByRole('button', { name: 'Calculator' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /open calculator/i })).not.toBeInTheDocument();
  });

  it('opens the compact navigator and routes a selected question', () => {
    const onSelectQuestion = vi.fn();
    render(<SatExamShell {...props({ onSelectQuestion })} />);
    fireEvent.click(screen.getByRole('button', { name: /open question navigator/i }));
    const dialog = screen.getByRole('dialog', { name: 'Question navigator' });
    fireEvent.click(within(dialog).getByRole('button', { name: '2' }));
    expect(onSelectQuestion).toHaveBeenCalledWith(1);
    expect(screen.queryByRole('dialog', { name: 'Question navigator' })).not.toBeInTheDocument();
  });
});
