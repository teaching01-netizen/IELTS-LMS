import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createDefaultConfig } from '../../../constants/examDefaults';
import type { ExamState } from '../../../types';
import { StudentReading } from '../StudentReading';
import { StudentWriting } from '../StudentWriting';
import { StudentFlagButton } from '../StudentFlagButton';
import { readSystemTextScale } from '../useSystemAccessibilityPreferences';
import {
  getStudentSaveStatusPresentation,
  type StudentAutoSaveStatus,
} from '../saveStatusPresentation';

function readingState(content: string): ExamState {
  return {
    title: 'Reading Test',
    type: 'Academic',
    activeModule: 'reading',
    activePassageId: 'passage-1',
    activeListeningPartId: 'part-1',
    config: {
      type: 'Academic',
      delivery: {
        launchMode: 'proctor_start',
        transitionMode: 'auto_with_proctor_override',
        allowedExtensionMinutes: [5],
      },
      sections: {
        listening: { enabled: false, order: 1, duration: 30, autoContinue: true, allowedQuestionTypes: ['SHORT_ANSWER'] },
        reading: { enabled: true, order: 2, duration: 60, autoContinue: true, allowedQuestionTypes: ['SHORT_ANSWER'] },
        writing: { enabled: false, order: 3, duration: 60, autoContinue: true, allowedQuestionTypes: ['SHORT_ANSWER'] },
        speaking: { enabled: false, order: 4, duration: 15, autoContinue: true, allowedQuestionTypes: ['SHORT_ANSWER'] },
      },
    },
    reading: {
      passages: [
        {
          id: 'passage-1',
          title: 'Passage 1',
          content,
          images: [],
          blocks: [
            {
              id: 'reading-block-1',
              type: 'SHORT_ANSWER',
              instruction: 'Answer the question.',
              questions: [{ id: 'reading-q1', prompt: 'What?', correctAnswer: 'answer', answerRule: 'ONE_WORD' }],
            },
          ],
        },
      ],
    },
    listening: { parts: [] },
    writing: { task1Prompt: 'Describe the chart.', task2Prompt: 'Discuss both views.' },
    speaking: { part1Topics: [], cueCard: '', part3Discussion: [] },
  } as unknown as ExamState;
}

describe('IELTS passage images', () => {
  it('are labeled, focusable controls that open the viewer from the keyboard and return focus', () => {
    vi.useFakeTimers();
    try {
      render(
        <StudentReading
          state={readingState('<p>Intro text.</p><p><img src="https://example.com/map.png" alt="Town map"></p>')}
          answers={{}}
          onAnswerChange={() => {}}
          currentQuestionId="reading-q1"
          onNavigate={() => {}}
        />,
      );

      const trigger = screen.getByRole('button', { name: 'Enlarge image: Town map' });
      expect(trigger.tagName).toBe('IMG');
      expect(trigger).toHaveAttribute('tabindex', '0');
      // Prose is not wrapped in a control.
      expect(screen.getByText('Intro text.').closest('[role="button"]')).toBeNull();

      fireEvent.keyDown(trigger, { key: 'Enter' });
      const viewer = screen.getByRole('dialog', { name: 'Town map zoomed view' });
      expect(viewer).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Close image zoom' }));
      act(() => {
        vi.runAllTimers();
      });
      expect(screen.queryByRole('dialog', { name: 'Town map zoomed view' })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Enlarge image: Town map' })).toHaveFocus();
    } finally {
      vi.useRealTimers();
    }
  });
});

function writingState(): ExamState {
  const config = createDefaultConfig('Academic', 'Academic');
  config.sections.writing.tasks = [
    { id: 'task1', label: 'Task 1', taskType: 'task1', minWords: 150, recommendedTime: 20 },
  ];
  return {
    ...readingState(''),
    activeModule: 'writing',
    config,
    reading: { passages: [] },
    writing: { task1Prompt: 'Task 1 prompt', task2Prompt: '', tasks: [], customPromptTemplates: [] },
  } as unknown as ExamState;
}

describe('IELTS writing editor', () => {
  it('takes its type size from the student text-size tokens', () => {
    render(
      <StudentWriting
        state={writingState()}
        writingAnswers={{}}
        onWritingChange={() => undefined}
        onSubmit={() => undefined}
        currentQuestionId={null}
        onNavigate={() => undefined}
      />,
    );

    const editor = screen.getByRole('textbox', { name: /writing response/i });
    expect(editor.style.fontSize).toBe('var(--student-writing-editor-font-size)');
    expect(editor.style.lineHeight).toBe('var(--student-writing-editor-line-height)');
  });
});

describe('save status copy', () => {
  const statuses: StudentAutoSaveStatus[] = ['saved', 'saving', 'syncing', 'offline', 'error'];

  it('keeps the compact wording a prefix of the full wording', () => {
    for (const status of statuses) {
      const { label, shortLabel } = getStudentSaveStatusPresentation(status);
      expect(label.startsWith(shortLabel)).toBe(true);
    }
  });

  it('only says "Saved" for the acknowledged state', () => {
    for (const status of statuses) {
      const { label } = getStudentSaveStatusPresentation(status);
      expect(/^saved$/i.test(label)).toBe(status === 'saved');
    }
  });
});

describe('iPad system Text Size', () => {
  function fakeWindow({ touch, supported, bodyPx }: { touch: boolean; supported: boolean; bodyPx: string }) {
    return {
      document,
      navigator: { maxTouchPoints: touch ? 5 : 0 },
      CSS: { supports: () => supported },
      getComputedStyle: () => ({ fontSize: bodyPx }),
    } as unknown as Window;
  }

  it('scales from the -apple-system-body size on touch devices', () => {
    expect(readSystemTextScale(fakeWindow({ touch: true, supported: true, bodyPx: '17px' }))).toBe(1);
    expect(readSystemTextScale(fakeWindow({ touch: true, supported: true, bodyPx: '23.8px' }))).toBe(1.4);
    // Accessibility sizes are capped so the exam stays usable.
    expect(readSystemTextScale(fakeWindow({ touch: true, supported: true, bodyPx: '53px' }))).toBe(1.6);
  });

  it('never shrinks exam text and ignores desktop Safari', () => {
    expect(readSystemTextScale(fakeWindow({ touch: true, supported: true, bodyPx: '14px' }))).toBe(1);
    expect(readSystemTextScale(fakeWindow({ touch: false, supported: true, bodyPx: '13px' }))).toBe(1);
    expect(readSystemTextScale(fakeWindow({ touch: true, supported: false, bodyPx: '23.8px' }))).toBe(1);
  });
});

describe('flag button', () => {
  it('names the question it flags so VoiceOver can tell flags apart', () => {
    const { rerender } = render(
      <StudentFlagButton flagged={false} questionLabel={14} onToggle={() => {}} />,
    );
    expect(screen.getByRole('button', { name: 'Flag question 14' })).toHaveAttribute('aria-pressed', 'false');
    rerender(<StudentFlagButton flagged questionLabel={14} onToggle={() => {}} />);
    expect(screen.getByRole('button', { name: 'Unflag question 14' })).toHaveAttribute('aria-pressed', 'true');
  });
});
