import React, { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createDefaultConfig } from '../../../constants/examDefaults';
import type { ExamState } from '../../../types';
import { FormattedText } from '../FormattedText';
import { StudentAppWrapper } from '../StudentAppWrapper';

vi.mock('../StudentApp', () => ({
  StudentApp: () => {
    const [visible, setVisible] = useState(true);
    return (
      <>
        <button onClick={() => setVisible((current) => !current)}>Toggle surface</button>
        {visible ? (
          <FormattedText
            text="Persistent question copy"
            highlightEnabled
            highlightToolMode="highlight"
            highlightSurfaceId="question:block-1:q1:prompt"
          />
        ) : null}
      </>
    );
  },
}));

const state = {
  title: 'Highlight test',
  type: 'Academic',
  activeModule: 'reading',
  activePassageId: null,
  activeListeningPartId: null,
  config: createDefaultConfig('Academic', 'Academic'),
  reading: { passages: [] },
  listening: { parts: [] },
  writing: { task1Prompt: '', task2Prompt: '' },
  speaking: { part1Topics: [], cueCard: '', part3Discussion: [] },
} as ExamState;

describe('StudentAppWrapper highlight persistence', () => {
  it('retains a real highlight after its surface unmounts and remounts for the same attempt', () => {
    render(
      <StudentAppWrapper
        state={state}
        onExit={() => undefined}
        attemptSnapshot={{
          id: 'attempt-highlight-1',
          scheduleId: 'schedule-highlight-1',
          studentKey: 'student-highlight-1',
          examId: 'exam-highlight-1',
          examTitle: 'Highlight test',
          candidateId: 'candidate-highlight-1',
          candidateName: 'Highlight Candidate',
          candidateEmail: 'highlight@example.test',
          phase: 'exam',
          currentModule: 'reading',
          currentQuestionId: null,
          answers: {},
          writingAnswers: {},
          flags: {},
          violations: [],
          proctorStatus: 'active',
          proctorNote: null,
          proctorUpdatedAt: null,
          proctorUpdatedBy: null,
          lastWarningId: null,
          lastAcknowledgedWarningId: null,
          integrity: {
            preCheck: null,
            deviceFingerprintHash: null,
            clientSessionId: null,
            lastDisconnectAt: null,
            lastReconnectAt: null,
            lastHeartbeatAt: null,
            lastHeartbeatStatus: 'idle',
          },
          recovery: {
            lastRecoveredAt: null,
            lastLocalMutationAt: null,
            lastPersistedAt: null,
            lastDroppedMutations: null,
            pendingMutationCount: 0,
            serverAcceptedThroughSeq: 0,
            clientSessionId: null,
            syncState: 'saved',
          },
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        }}
        enableMonitoring={false}
        persistenceEnabled={false}
      />,
    );
    const surface = screen.getByText('Persistent question copy');
    const textNode = surface.firstChild!;
    const range = document.createRange();
    range.setStart(textNode, 0);
    range.setEnd(textNode, 10);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    fireEvent(document, new Event('pointerup'));
    expect(document.querySelector('mark[data-highlighted="true"]')).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Toggle surface' }));
    fireEvent.click(screen.getByRole('button', { name: 'Toggle surface' }));

    expect(document.querySelector('mark[data-highlighted="true"]')).toHaveTextContent('Persistent');
    window.getSelection()?.removeAllRanges();
  });
});
