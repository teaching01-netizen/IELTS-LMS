import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CompactStudentHeader } from '../CompactStudentHeader';

describe('CompactStudentHeader', () => {
  it('shows ACT branding for an ACT exam instead of the IELTS label', () => {
    render(<CompactStudentHeader moduleLabel="Science" examType="ACT" />);

    expect(screen.getByText('ACT')).toBeInTheDocument();
    expect(screen.queryByText('IELTS')).not.toBeInTheDocument();
  });

  it('keeps the timer visible while putting secondary tools behind More', () => {
    render(
      <CompactStudentHeader
        moduleLabel="Reading"
        timeRemaining={1122}
        onOpenNavigator={() => undefined}
        onOpenAccessibility={() => undefined}
      />,
    );

    expect(screen.getByRole('timer', { name: 'Time remaining' })).toHaveTextContent('18:42');
    expect(screen.getByRole('button', { name: 'Open exam tools' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Exam tools' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Open exam tools' }));
    expect(screen.getByRole('dialog', { name: 'Exam tools' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Question navigator' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Accessibility settings' })).toBeInTheDocument();
  });

  it('closes the tools sheet after opening the navigator', () => {
    const onOpenNavigator = vi.fn();

    render(
      <CompactStudentHeader
        moduleLabel="Listening"
        onOpenNavigator={onOpenNavigator}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Open exam tools' }));
    fireEvent.click(screen.getByRole('button', { name: 'Question navigator' }));

    expect(onOpenNavigator).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('student-tools-sheet')).not.toBeInTheDocument();
  });

  it('exposes ACT Science choice elimination in the compact exam tools', () => {
    const onToggleChoiceElimination = vi.fn();

    render(
      <CompactStudentHeader
        moduleLabel="Science"
        examType="ACT"
        choiceEliminationAvailable
        choiceEliminationEnabled={false}
        onToggleChoiceElimination={onToggleChoiceElimination}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Open exam tools' }));
    const eliminateButton = screen.getByRole('button', { name: 'Eliminate choices' });
    expect(eliminateButton).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(eliminateButton);
    expect(onToggleChoiceElimination).toHaveBeenCalledTimes(1);
  });
});
