import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { createDefaultConfig } from '../../../constants/examDefaults';
import type { ExamState } from '../../../types';
import { StudentExamPreview } from '../StudentExamPreview';

function createExamState(): ExamState {
  return {
    title: 'Preview Exam',
    type: 'Academic',
    activeModule: 'writing',
    activePassageId: 'p1',
    activeListeningPartId: 'l1',
    config: createDefaultConfig('Academic', 'Academic'),
    reading: { passages: [] },
    listening: { parts: [] },
    writing: {
      task1Prompt: 'Task 1 prompt',
      task2Prompt: 'Task 2 prompt',
    },
    speaking: {
      part1Topics: [],
      cueCard: '',
      part3Discussion: [],
    },
  };
}

describe('StudentExamPreview', () => {
  it('shows the split accessibility controls in the preview shell', () => {
    render(
      <MemoryRouter>
        <StudentExamPreview state={createExamState()} examId="exam-1" initialModule="writing" />
      </MemoryRouter>,
    );

    const zoomControls = screen.getByTestId('zoom-controls');
    const zoomPercent = screen.getByTestId('zoom-percent');

    expect(zoomControls).toHaveClass('w-[11.5rem]');
    expect(zoomPercent).toHaveTextContent('100%');
    expect(screen.getByRole('button', { name: /zoom out/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /zoom in/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /reset zoom/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /open accessibility settings/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /zoom in/i }));
    expect(zoomPercent).toHaveTextContent('110%');
    expect(zoomControls).toHaveClass('w-[11.5rem]');
  });

  it('updates the preview shell font size when the accessibility setting changes', () => {
    const { container } = render(
      <MemoryRouter>
        <StudentExamPreview state={createExamState()} examId="exam-1" initialModule="writing" />
      </MemoryRouter>,
    );

    const shell = container.querySelector('.student-exam-shell') as HTMLElement;
    const initialFontSize = shell.style.fontSize;

    fireEvent.click(screen.getByRole('button', { name: /open accessibility settings/i }));
    fireEvent.click(screen.getByTestId('font-size-option-large'));

    expect(shell.style.fontSize).not.toBe(initialFontSize);
    expect(shell.style.fontSize).toContain('clamp');
  });
});
