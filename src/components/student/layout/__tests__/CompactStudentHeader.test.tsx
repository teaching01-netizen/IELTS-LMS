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

  it('announces the 1-minute warning once and never per tick (T2.5)', () => {
    // timeRemaining drives the shared threshold announcer: 59s crosses the
    // 1-minute threshold exactly once; a re-render at 58s must not change
    // the announcement, and the per-tick timer carries no live region.
    const { rerender } = render(
      <CompactStudentHeader moduleLabel="Reading" timeRemaining={59} />,
    );
    const announcement = screen.getByTestId('student-timer-announcement');
    expect(announcement).toHaveAttribute('aria-live', 'polite');
    expect(announcement).toHaveTextContent('Low time: 1 minute remaining');
    rerender(<CompactStudentHeader moduleLabel="Reading" timeRemaining={58} />);
    expect(screen.getByTestId('student-timer-announcement')).toHaveTextContent(
      'Low time: 1 minute remaining',
    );
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
