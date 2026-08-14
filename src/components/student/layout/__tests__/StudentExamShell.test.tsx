import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StudentExamShell } from '../StudentExamShell';

describe('StudentExamShell', () => {
  it('publishes the responsive layout and touch mode without mutating children', () => {
    render(
      <StudentExamShell layoutMode="medium" touchMode highContrast>
        <input aria-label="answer" defaultValue="preserved answer" />
      </StudentExamShell>,
    );

    const shell = screen.getByTestId('student-exam-shell');
    expect(shell).toHaveAttribute('data-student-layout-mode', 'medium');
    expect(shell).toHaveAttribute('data-student-touch-mode', 'true');
    expect(shell).toHaveClass('high-contrast');
    expect(screen.getByRole('textbox', { name: 'answer' })).toHaveValue('preserved answer');
  });

  it('preserves caller style variables while rendering a single shell node', () => {
    render(
      <StudentExamShell
        layoutMode="wide"
        style={{ '--student-passage-line-height': 1.9 } as React.CSSProperties}
      >
        <span data-testid="child">content</span>
      </StudentExamShell>,
    );

    const shell = screen.getByTestId('student-exam-shell');
    expect(shell).toHaveStyle('--student-passage-line-height: 1.9');
    expect(screen.getByTestId('child')).toHaveTextContent('content');
    expect(screen.getAllByTestId('student-exam-shell')).toHaveLength(1);
  });
});
