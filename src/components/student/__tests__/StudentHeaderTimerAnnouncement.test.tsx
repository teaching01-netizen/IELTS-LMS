import { render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it } from 'vitest';
import { StudentHeader } from '../StudentHeader';

describe('StudentHeader timer announcements', () => {
  it('announces the 5-minute warning once and never per tick (T2.5)', () => {
    // timeRemaining drives the shared threshold announcer: 299s crosses the
    // 5-minute threshold exactly once; a re-render at 298s must not change
    // the announcement, and the per-tick timer carries aria-live="off".
    const { rerender } = render(<StudentHeader testTakerId="W000000" timeRemaining={299} />);
    const announcement = screen.getByTestId('student-timer-announcement');
    expect(announcement).toHaveAttribute('aria-live', 'polite');
    expect(announcement).toHaveTextContent('Low time: 5 minutes remaining');
    rerender(<StudentHeader testTakerId="W000000" timeRemaining={298} />);
    expect(screen.getByTestId('student-timer-announcement')).toHaveTextContent(
      'Low time: 5 minutes remaining',
    );
    expect(screen.getByRole('timer', { name: 'Time remaining' })).toHaveTextContent('04:58');
  });
});
