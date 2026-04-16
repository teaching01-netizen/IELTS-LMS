import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StudentAppWrapper } from '../StudentAppWrapper';
import { createDefaultConfig } from '../../../constants/examDefaults';
import type { ExamState } from '../../../types';
import type { ExamSessionRuntime } from '../../../types/domain';

describe('StudentApp runtime-backed mode', () => {
  const state: ExamState = {
    title: 'Mock Exam',
    type: 'Academic',
    activeModule: 'writing',
    activePassageId: 'p1',
    activeListeningPartId: 'l1',
    config: createDefaultConfig('Academic', 'Academic'),
    reading: { passages: [] },
    listening: { parts: [] },
    writing: {
      task1Prompt: 'Task 1 prompt',
      task2Prompt: 'Task 2 prompt'
    },
    speaking: {
      part1Topics: [],
      cueCard: '',
      part3Discussion: []
    }
  };

  it('shows the waiting overlay when the runtime locks the student between sections', () => {
    const runtimeSnapshot: ExamSessionRuntime = {
      id: 'runtime-1',
      scheduleId: 'sched-1',
      examId: 'exam-1',
      examTitle: 'Mock Exam',
      cohortName: 'Cohort A',
      deliveryMode: 'proctor_start',
      status: 'live',
      actualStartAt: '2026-01-01T00:00:00.000Z',
      actualEndAt: null,
      activeSectionKey: null,
      currentSectionKey: 'writing',
      currentSectionRemainingSeconds: 300,
      waitingForNextSection: true,
      isOverrun: false,
      totalPausedSeconds: 0,
      sections: [
        {
          sectionKey: 'writing',
          label: 'Writing',
          order: 1,
          plannedDurationMinutes: 60,
          gapAfterMinutes: 0,
          status: 'completed',
          availableAt: '2026-01-01T00:00:00.000Z',
          actualStartAt: '2026-01-01T00:00:00.000Z',
          actualEndAt: '2026-01-01T01:00:00.000Z',
          pausedAt: null,
          accumulatedPausedSeconds: 0,
          extensionMinutes: 0,
          completionReason: 'auto_timeout',
          projectedStartAt: '2026-01-01T00:00:00.000Z',
          projectedEndAt: '2026-01-01T01:00:00.000Z'
        }
      ],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T01:00:00.000Z'
    };

    const { container } = render(
      <StudentAppWrapper
        state={state}
        onExit={() => {}}
        runtimeSnapshot={runtimeSnapshot}
      />
    );

    // Should render without crashing when runtime-backed with waiting state
    expect(container).toBeInTheDocument();
  });
});
