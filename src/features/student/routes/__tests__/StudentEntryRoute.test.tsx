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

function submitForm(wcode = 'W250334') {
  fireEvent.change(screen.getByLabelText(/access code|wcode/i), {
    target: { value: wcode },
  });
  fireEvent.change(screen.getByLabelText(/email/i), {
    target: { value: 'student@example.com' },
  });
  fireEvent.change(screen.getByLabelText(/full name/i), {
    target: { value: 'Student One' },
  });
  fireEvent.change(screen.getByLabelText(/nickname/i), {
    target: { value: 'student-one' },
  });
  fireEvent.change(screen.getByLabelText(/IELTS Course/i), {
    target: { value: 'IELTS Academic' },
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
        nickname: 'student-one',
        ieltsCourse: 'IELTS Academic',
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

  it('auto-resumes an existing attempt for non-legacy access codes', async () => {
    const scheduleId = '550e8400-e29b-41d4-a716-446655440126';
    const accessCode = 'guest-alpha_01';
    window.localStorage.setItem(`ielts-student-last-wcode:${scheduleId}`, accessCode);
    window.localStorage.setItem(
      'ielts_student_attempts_v1',
      JSON.stringify([
        {
          id: 'attempt-2',
          scheduleId,
          studentKey: `student-${scheduleId}-${accessCode}`,
          examId: 'exam-1',
          examTitle: 'Mock Exam',
          candidateId: accessCode,
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
      expect(navigateMock).toHaveBeenCalledWith(`/student/${scheduleId}/${accessCode}`, {
        replace: true,
      });
    });

    expect(studentEntryMock).not.toHaveBeenCalled();
  });

  it('rejects emails that pass simple regex patterns but fail shared schema validation', async () => {
    const scheduleId = '550e8400-e29b-41d4-a716-446655440099';
    renderRoute(scheduleId);

    fireEvent.change(screen.getByLabelText(/access code|wcode/i), {
      target: { value: 'W250334' },
    });
    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: 'student@example..com' },
    });
    fireEvent.change(screen.getByLabelText(/full name/i), {
      target: { value: 'Student One' },
    });
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));

    await waitFor(() => {
      expect(studentEntryMock).not.toHaveBeenCalled();
    });
  });

  it('shows queue position and keeps polling until admission is granted', async () => {
    const scheduleId = '550e8400-e29b-41d4-a716-446655440123';
    studentEntryMock
      .mockResolvedValueOnce({
        state: 'queued',
        ticketId: 'ticket-1',
        scheduleId,
        wcode: 'W250334',
        position: 3,
        pollAfterMs: 10,
        queuedAt: '2026-05-08T00:00:00.000Z',
      })
      .mockResolvedValueOnce({
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
      expect(screen.getByText(/you are in queue/i)).toBeInTheDocument();
      expect(screen.getByText(/position: 3/i)).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(studentEntryMock).toHaveBeenCalledTimes(2);
      expect(navigateMock).toHaveBeenCalledWith(`/student/${scheduleId}/W250334`);
    });
  });

  it('accepts non-Wcode formatted access codes', async () => {
    const scheduleId = '550e8400-e29b-41d4-a716-446655440124';
    studentEntryMock.mockResolvedValue({
      user: {
        id: 'student-2',
        email: 'student@example.com',
        displayName: 'Student Two',
        role: 'student',
        state: 'active',
      },
      csrfToken: 'csrf-2',
      expiresAt: '2026-01-01T12:00:00.000Z',
    });

    renderRoute(scheduleId);
    submitForm('guest-alpha_01');

    await waitFor(() => {
      expect(studentEntryMock).toHaveBeenCalledWith({
        scheduleId,
        wcode: 'guest-alpha_01',
        email: 'student@example.com',
        studentName: 'Student One',
        nickname: 'student-one',
        ieltsCourse: 'IELTS Academic',
      });
    });

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith(`/student/${scheduleId}/guest-alpha_01`);
    });
  });

  it('canonicalizes legacy W-codes to uppercase without blocking input', async () => {
    const scheduleId = '550e8400-e29b-41d4-a716-446655440127';
    studentEntryMock.mockResolvedValue({
      user: {
        id: 'student-4',
        email: 'student@example.com',
        displayName: 'Student Four',
        role: 'student',
        state: 'active',
      },
      csrfToken: 'csrf-4',
      expiresAt: '2026-01-01T12:00:00.000Z',
    });

    renderRoute(scheduleId);
    submitForm('w250334');

    await waitFor(() => {
      expect(studentEntryMock).toHaveBeenCalledWith({
        scheduleId,
        wcode: 'W250334',
        email: 'student@example.com',
        studentName: 'Student One',
        nickname: 'student-one',
        ieltsCourse: 'IELTS Academic',
      });
    });

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith(`/student/${scheduleId}/W250334`);
    });
  });

  it('encodes access code when navigating to student route', async () => {
    const scheduleId = '550e8400-e29b-41d4-a716-446655440125';
    const rawAccessCode = 'guest/a?x#y';
    studentEntryMock.mockResolvedValue({
      user: {
        id: 'student-3',
        email: 'student@example.com',
        displayName: 'Student Three',
        role: 'student',
        state: 'active',
      },
      csrfToken: 'csrf-3',
      expiresAt: '2026-01-01T12:00:00.000Z',
    });

    renderRoute(scheduleId);
    submitForm(rawAccessCode);

    await waitFor(() => {
      expect(studentEntryMock).toHaveBeenCalledWith({
        scheduleId,
        wcode: rawAccessCode,
        email: 'student@example.com',
        studentName: 'Student One',
        nickname: 'student-one',
        ieltsCourse: 'IELTS Academic',
      });
    });

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith(
        `/student/${scheduleId}/${encodeURIComponent(rawAccessCode)}`,
      );
    });
  });
});
