import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CompactStudentHeader } from '../CompactStudentHeader';

describe('CompactStudentHeader', () => {
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
});
