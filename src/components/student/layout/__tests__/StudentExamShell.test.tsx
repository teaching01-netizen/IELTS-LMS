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

  it('publishes the keyboard state attribute with a visible default', () => {
    const { rerender } = render(
      <StudentExamShell layoutMode="medium">
        <span>content</span>
      </StudentExamShell>,
    );

    const shell = screen.getByTestId('student-exam-shell');
    expect(shell).toHaveAttribute('data-student-keyboard-open', 'false');

    rerender(
      <StudentExamShell layoutMode="medium" keyboardOpen>
        <span>content</span>
      </StudentExamShell>,
    );
    expect(screen.getByTestId('student-exam-shell')).toHaveAttribute(
      'data-student-keyboard-open',
      'true',
    );
  });

  it('publishes the stable exam height as the single viewport CSS variable', () => {
    render(
      <StudentExamShell layoutMode="medium" examHeight={1024}>
        <span>content</span>
      </StudentExamShell>,
    );

    const shell = screen.getByTestId('student-exam-shell');
    expect(shell).toHaveStyle('--student-exam-height: 1024px');
  });

  it('does not overwrite existing typography CSS variables when publishing height', () => {
    render(
      <StudentExamShell
        layoutMode="medium"
        examHeight={1024}
        style={{ '--student-passage-font-size': '1.125rem' } as React.CSSProperties}
      >
        <span>content</span>
      </StudentExamShell>,
    );

    const shell = screen.getByTestId('student-exam-shell');
    expect(shell).toHaveStyle('--student-exam-height: 1024px');
    expect(shell).toHaveStyle('--student-passage-font-size: 1.125rem');
  });

  it('leaves the height variable to the CSS fallback until a height is measured', () => {
    render(
      <StudentExamShell layoutMode="medium" examHeight={null}>
        <span>content</span>
      </StudentExamShell>,
    );

    const shell = screen.getByTestId('student-exam-shell');
    expect(shell.style.getPropertyValue('--student-exam-height')).toBe('');
  });

  it('never remounts children when the keyboard state changes', () => {
    const { rerender } = render(
      <StudentExamShell layoutMode="medium" keyboardOpen={false}>
        <input aria-label="answer" defaultValue="durable" />
      </StudentExamShell>,
    );

    const answerBefore = screen.getByRole('textbox', { name: 'answer' });

    rerender(
      <StudentExamShell layoutMode="medium" keyboardOpen examHeight={1024}>
        <input aria-label="answer" defaultValue="durable" />
      </StudentExamShell>,
    );

    const answerAfter = screen.getByRole('textbox', { name: 'answer' });
    expect(answerAfter).toBe(answerBefore);
    expect(answerAfter).toHaveValue('durable');
    expect(screen.getByTestId('student-exam-shell')).toHaveAttribute(
      'data-student-keyboard-open',
      'true',
    );
  });

  it('preserves an answer input value across viewport transitions', () => {
    const { rerender } = render(
      <StudentExamShell layoutMode="medium" examHeight={1024}>
        <input aria-label="answer" defaultValue="typed answer" />
      </StudentExamShell>,
    );

    rerender(
      <StudentExamShell layoutMode="medium" examHeight={1024} keyboardOpen>
        <input aria-label="answer" defaultValue="typed answer" />
      </StudentExamShell>,
    );

    rerender(
      <StudentExamShell layoutMode="medium" examHeight={1024}>
        <input aria-label="answer" defaultValue="typed answer" />
      </StudentExamShell>,
    );

    expect(screen.getByRole('textbox', { name: 'answer' })).toHaveValue('typed answer');
    expect(screen.getByTestId('student-exam-shell')).toHaveAttribute(
      'data-student-keyboard-open',
      'false',
    );
  });
});
