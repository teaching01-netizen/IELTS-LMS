import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { AuthSessionProvider } from '../../../auth/authSession';
import { authService } from '../../../../services/authService';
import { StudentSessionRoute } from '../StudentSessionRoute';

const navigateMock = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

const useStudentSessionRouteDataMock = vi.fn();
vi.mock('@student/hooks/useStudentSessionRouteData', () => ({
  useStudentSessionRouteData: (...args: unknown[]) => useStudentSessionRouteDataMock(...args),
}));

const StudentAppWrapperMock = vi.fn();
vi.mock('@components/student/StudentAppWrapper', () => ({
  StudentAppWrapper: (props: any) => StudentAppWrapperMock(props),
}));

function renderRoute(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <AuthSessionProvider>
        <Routes>
          <Route path="/student/:scheduleId/:studentId" element={<StudentSessionRoute />} />
        </Routes>
      </AuthSessionProvider>
    </MemoryRouter>,
  );
}

describe('StudentSessionRoute', () => {
  afterEach(() => {
    navigateMock.mockReset();
    useStudentSessionRouteDataMock.mockReset();
    StudentAppWrapperMock.mockReset();
    vi.restoreAllMocks();
  });

  it('routes missing state back to student check-in instead of /admin', async () => {
    vi.spyOn(authService, 'getSession').mockResolvedValue(null);
    vi.spyOn(authService, 'logoutAll').mockResolvedValue();
    useStudentSessionRouteDataMock.mockReturnValue({
      attemptSnapshot: null,
      error: null,
      isLoading: false,
      retry: vi.fn(),
      runtimeSnapshot: null,
      state: null,
      refreshRuntime: vi.fn(),
    });

    renderRoute('/student/sched-1/alice');
    fireEvent.click(screen.getByRole('button', { name: /back to check-in/i }));

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith('/student/sched-1');
    });
  });

  it('routes invalid access code errors back to check-in', async () => {
    vi.spyOn(authService, 'getSession').mockResolvedValue(null);
    vi.spyOn(authService, 'logoutAll').mockResolvedValue();
    useStudentSessionRouteDataMock.mockReturnValue({
      attemptSnapshot: null,
      error: 'Invalid access code. Please check in again.',
      isLoading: false,
      retry: vi.fn(),
      runtimeSnapshot: null,
      state: null,
      refreshRuntime: vi.fn(),
    });

    renderRoute('/student/sched-1/precheck');
    fireEvent.click(screen.getByRole('button', { name: /back to check-in/i }));

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith('/student/sched-1');
    });
  });

  it('routes student exit back to student check-in instead of /admin', async () => {
    vi.spyOn(authService, 'getSession').mockResolvedValue({
      user: {
        id: 'student-1',
        email: 'student@example.com',
        displayName: 'Student User',
        role: 'student',
        state: 'active',
      },
      csrfToken: 'csrf-student',
      expiresAt: '2026-01-01T12:00:00.000Z',
    });
    const logoutAllMock = vi.spyOn(authService, 'logoutAll').mockResolvedValue();

    StudentAppWrapperMock.mockImplementation((props: any) => (
      <button onClick={props.onExit}>Exit</button>
    ));

    useStudentSessionRouteDataMock.mockReturnValue({
      attemptSnapshot: null,
      error: null,
      isLoading: false,
      retry: vi.fn(),
      runtimeSnapshot: null,
      state: {},
      refreshRuntime: vi.fn(),
    });

    renderRoute('/student/sched-1/alice');

    fireEvent.click(screen.getByRole('button', { name: /exit/i }));

    await waitFor(() => {
      expect(logoutAllMock).toHaveBeenCalledTimes(1);
    });
    expect(navigateMock).toHaveBeenCalledWith('/student/sched-1');
  });
});
