import { render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it } from 'vitest';
import { StudentHeader } from '../StudentHeader';

describe('StudentHeader highlight hint', () => {
  it('shows a highlight usage hint when highlight is enabled for reading/listening', () => {
    render(
      <StudentHeader
        testTakerId="W000000"
        timeRemaining={60}
        highlightEnabled
        // Presence of navigator implies reading/listening context.
        onOpenNavigator={() => {}}
      />,
    );

    expect(screen.getByText('Tip: Select text to highlight')).toBeInTheDocument();
  });

  it('does not show the hint when highlight is disabled', () => {
    render(
      <StudentHeader
        testTakerId="W000000"
        timeRemaining={60}
        highlightEnabled={false}
        onOpenNavigator={() => {}}
      />,
    );

    expect(screen.queryByText('Tip: Select text to highlight')).toBeNull();
  });
});
