import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StudentEntryRoute } from '../StudentEntryRoute';

const navigateMock = vi.fn();
const studentEntryMock = vi.fn();

vi.mock('../../../auth/authSession', () => ({
  useAuthSession: () => ({ studentEntry: studentEntryMock }),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

function renderRoute(scheduleId: string) {
  render(
    <MemoryRouter initialEntries={[`/student/${scheduleId}`]}>
      <Routes>
        <Route path="/student/:scheduleId" element={<StudentEntryRoute />} />
      </Routes>
    </MemoryRouter>,
  );
}

function submitForm() {
  fireEvent.change(screen.getByLabelText(/wcode/i), {
    target: { value: 'W250334' },
  });
  fireEvent.change(screen.getByLabelText(/email/i), {
    target: { value: 'student@example.com' },
  });
  fireEvent.change(screen.getByLabelText(/full name/i), {
    target: { value: 'Student One' },
  });
  fireEvent.click(screen.getByRole('button', { name: /continue/i }));
}

describe('StudentEntryRoute', () => {
  afterEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    navigateMock.mockReset();
    studentEntryMock.mockReset();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('creates a behind-the-scenes student session and continues to the schedule-backed delivery route', async () => {
    const scheduleId = '550e8400-e29b-41d4-a716-446655440000';
    studentEntryMock.mockResolvedValue({
      user: {
        id: 'student-1',
        email: 'student@example.com',
        displayName: 'Student One',
        role: 'student',
        state: 'active',
      },
      csrfToken: 'csrf-1',
      expiresAt: '2026-01-01T12:00:00.000Z',
    });

    renderRoute(scheduleId);
    submitForm();

    await waitFor(() => {
      expect(studentEntryMock).toHaveBeenCalledWith({
        scheduleId,
        wcode: 'W250334',
        email: 'student@example.com',
        studentName: 'Student One',
      });
    });

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith(`/student/${scheduleId}/W250334`);
    });
  });

  it('auto-resumes an existing attempt for the last wcode instead of forcing check-in again', async () => {
    const scheduleId = '550e8400-e29b-41d4-a716-446655440001';
    window.localStorage.setItem(`ielts-student-last-wcode:${scheduleId}`, 'W250334');
    window.localStorage.setItem(
      'ielts_student_attempts_v1',
      JSON.stringify([
        {
          id: 'attempt-1',
          scheduleId,
          studentKey: `student-${scheduleId}-W250334`,
          examId: 'exam-1',
          examTitle: 'Mock Exam',
          candidateId: 'W250334',
          candidateName: 'Student One',
          candidateEmail: 'student@example.com',
          phase: 'exam',
          currentModule: 'reading',
          currentQuestionId: null,
          answers: {},
          writingAnswers: {},
          flags: {},
          violations: [],
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
            syncState: 'idle',
          },
          createdAt: '2026-04-24T00:00:00.000Z',
          updatedAt: '2026-04-24T00:00:00.000Z',
        },
      ]),
    );

    renderRoute(scheduleId);

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith(`/student/${scheduleId}/W250334`, {
        replace: true,
      });
    });

    expect(studentEntryMock).not.toHaveBeenCalled();
  });
});
