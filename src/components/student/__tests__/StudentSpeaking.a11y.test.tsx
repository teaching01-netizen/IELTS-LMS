import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createDefaultConfig } from '../../../constants/examDefaults';
import type { ExamState } from '../../../types';
import { StudentSpeaking } from '../StudentSpeaking';

function createExamState(): ExamState {
  const config = createDefaultConfig('Academic', 'Academic');
  return {
    title: 'Test Exam',
    type: 'Academic',
    activeModule: 'speaking',
    activePassageId: 'p1',
    activeListeningPartId: 'l1',
    config,
    reading: { passages: [] },
    listening: { parts: [] },
    writing: {
      task1Prompt: 'Task 1 prompt',
      task2Prompt: 'Task 2 prompt',
      tasks: [],
      customPromptTemplates: [],
    },
    speaking: {
      part1Topics: [],
      cueCard: '',
      part3Discussion: [],
    },
  };
}

describe('StudentSpeaking a11y', () => {
  it('adds aria-labels to speaking control icon buttons', () => {
    render(
      <StudentSpeaking
        state={createExamState()}
        onSubmit={() => undefined}
        currentQuestionId={null}
        onNavigate={() => undefined}
      />,
    );

    expect(screen.getByLabelText(/toggle microphone/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/toggle camera/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/end call/i)).toBeInTheDocument();
  });
});

