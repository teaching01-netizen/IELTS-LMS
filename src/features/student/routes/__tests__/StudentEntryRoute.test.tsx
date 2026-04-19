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
});
