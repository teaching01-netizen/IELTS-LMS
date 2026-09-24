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

const SatStudentSessionRouteMock = vi.fn();
vi.mock('../../../student-delivery/routes/SatStudentSessionRoute', () => ({
  SatStudentSessionRoute: (props: any) => SatStudentSessionRouteMock(props),
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
    SatStudentSessionRouteMock.mockReset();
    vi.restoreAllMocks();
  });

  it.each(['', '?touchSelectionDebug=1'])('only exposes diagnostics when the session URL opts in: %s', async (query) => {
    vi.spyOn(authService, 'getSession').mockResolvedValue(null);
    StudentAppWrapperMock.mockReturnValue(<div>IELTS exam</div>);
    useStudentSessionRouteDataMock.mockReturnValue({
      attemptSnapshot: null, error: null, isLoading: false, providerKey: 'ielts',
      retry: vi.fn(), runtimeSnapshot: null, state: {}, refreshRuntime: vi.fn(),
    });
    renderRoute(`/student/sched-1/alice${query}`);
    await screen.findByText('IELTS exam');
    expect(screen.queryByRole('region', { name: 'Touch selection diagnostics' }) !== null).toBe(query !== '');
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
      error: 'Invalid wcode. Please check in again.',
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

  it('navigates to check-in without waiting for a slow logout request', () => {
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
    vi.spyOn(authService, 'logoutAll').mockImplementation(() => new Promise(() => {}));

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

    expect(navigateMock).toHaveBeenCalledWith('/student/sched-1');
  });

  it('keeps a completed ACT session on the completion screen after Exit', async () => {
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
      providerKey: 'act',
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
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it('renders the SAT skin (never the admin skeleton) while a SAT load is pending', async () => {
    // Auth window excluded from the flicker assertion: settle auth to
    // 'unauthenticated' so the route reads the provider-known-SAT branch.
    vi.spyOn(authService, 'getSession').mockResolvedValue(null);
    vi.spyOn(authService, 'logoutAll').mockResolvedValue();
    useStudentSessionRouteDataMock.mockReturnValue({
      attemptSnapshot: null,
      error: null,
      isLoading: true,
      providerKey: 'sat',
      retry: vi.fn(),
      runtimeSnapshot: null,
      state: null,
      refreshRuntime: vi.fn(),
      satBootstrapSeed: null,
      isSatStaticReady: false,
    });

    renderRoute('/student/sched-1/alice');

    // Auth window excluded: wait for auth to settle past 'loading' so the
    // provider-known-SAT branch (not the auth-window admin skeleton) renders.
    await waitFor(() => {
      expect(screen.queryByText('Loading Digital SAT…')).toBeInTheDocument();
    });
    // Single SAT skin: SAT loader present with the kind probe …
    expect(screen.getByText('Loading Digital SAT…')).toBeInTheDocument();
    expect(screen.getByRole('status').getAttribute('data-sat-loading-kind')).toBe('initial');
    // … and the admin skeleton absent (bg-gray-50 shell + admin sr-only label).
    expect(screen.queryByText('Loading Exam…')).not.toBeInTheDocument();
    expect(document.querySelector('.bg-gray-50')).toBeNull();
    expect(SatStudentSessionRouteMock).not.toHaveBeenCalled();
  });

  it('renders a neutral blank (neither skeleton nor SAT skin) while the provider is unknown', async () => {
    vi.spyOn(authService, 'getSession').mockResolvedValue(null);
    vi.spyOn(authService, 'logoutAll').mockResolvedValue();
    useStudentSessionRouteDataMock.mockReturnValue({
      attemptSnapshot: null,
      error: null,
      isLoading: true,
      providerKey: 'unknown',
      retry: vi.fn(),
      runtimeSnapshot: null,
      state: null,
      refreshRuntime: vi.fn(),
      satBootstrapSeed: null,
      isSatStaticReady: false,
    });

    renderRoute('/student/sched-1/alice');

    await waitFor(() => {
      expect(screen.getByRole('status')).toBeInTheDocument();
    });
    // Neutral blank: no admin skeleton grey, no SAT spinner, no admin label.
    expect(document.querySelector('.bg-gray-50')).toBeNull();
    expect(screen.queryByText('Loading Digital SAT…')).not.toBeInTheDocument();
    expect(screen.queryByText('Loading Exam…')).not.toBeInTheDocument();
    expect(screen.getByText('Loading…')).toBeInTheDocument();
    expect(SatStudentSessionRouteMock).not.toHaveBeenCalled();
  });

  it('renders the admin skeleton (never the SAT skin) while an IELTS load is pending', () => {
    vi.spyOn(authService, 'getSession').mockResolvedValue(null);
    useStudentSessionRouteDataMock.mockReturnValue({
      attemptSnapshot: null,
      error: null,
      isLoading: true,
      providerKey: 'ielts',
      retry: vi.fn(),
      runtimeSnapshot: null,
      state: null,
      refreshRuntime: vi.fn(),
      satBootstrapSeed: null,
      isSatStaticReady: false,
    });

    renderRoute('/student/sched-1/alice');

    expect(screen.getByText('Loading Exam…')).toBeInTheDocument();
    expect(document.querySelector('.bg-gray-50')).not.toBeNull();
    expect(screen.queryByText('Loading Digital SAT…')).not.toBeInTheDocument();
    expect(SatStudentSessionRouteMock).not.toHaveBeenCalled();
  });

  it('keeps SAT attempt-missing on Back to Check-in after the load settles', async () => {
    vi.spyOn(authService, 'getSession').mockResolvedValue(null);
    vi.spyOn(authService, 'logoutAll').mockResolvedValue();
    useStudentSessionRouteDataMock.mockReturnValue({
      attemptSnapshot: null,
      error: null,
      isLoading: false,
      providerKey: 'sat',
      retry: vi.fn(),
      runtimeSnapshot: null,
      state: {},
      refreshRuntime: vi.fn(),
      satBootstrapSeed: null,
      isSatStaticReady: true,
    });

    renderRoute('/student/sched-1/alice');
    fireEvent.click(screen.getByRole('button', { name: /back to check-in/i }));

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith('/student/sched-1');
    });
    expect(SatStudentSessionRouteMock).not.toHaveBeenCalled();
  });

  it('passes bootstrapSeed + initialIsLoading through to the mounted SAT child', async () => {
    vi.spyOn(authService, 'getSession').mockResolvedValue(null);
    SatStudentSessionRouteMock.mockImplementation(() => <div>sat child</div>);
    const seed = {
      scheduleId: 'sched-1',
      attemptId: 'attempt-1',
      candidateId: 'alice',
      attemptSnapshot: { id: 'attempt-1' },
      runtimeSnapshot: null,
      liveSnapshotReceivedAt: 1,
      staticVersionId: 'ver-1',
      attemptRevision: 1,
      runtimeRevision: null,
      seedGeneration: 1,
    };
    useStudentSessionRouteDataMock.mockReturnValue({
      attemptSnapshot: { id: 'attempt-1', candidateId: 'alice', leaseEpoch: 0, controlEpoch: 0 },
      error: null,
      isLoading: false,
      providerKey: 'sat',
      retry: vi.fn(),
      runtimeSnapshot: null,
      liveSocketConnected: false,
      satAttemptUpdateToken: 3,
      state: {},
      refreshRuntime: vi.fn(),
      satBootstrapSeed: seed,
      isSatStaticReady: true,
    });

    renderRoute('/student/sched-1/alice');

    expect(await screen.findByText('sat child')).toBeInTheDocument();
    expect(SatStudentSessionRouteMock).toHaveBeenCalledTimes(1);
    const props = SatStudentSessionRouteMock.mock.calls[0]?.[0] as {
      bootstrapSeed?: unknown;
      initialIsLoading?: unknown;
      attemptId?: unknown;
    };
    expect(props.attemptId).toBe('attempt-1');
    expect(props.bootstrapSeed).toBe(seed);
    expect(props.initialIsLoading).toBe(false);
  });

  it('does not render Loading Error during non-fatal reconnect sync conflict recovery', async () => {
    vi.spyOn(authService, 'getSession').mockResolvedValue(null);
    StudentAppWrapperMock.mockImplementation(() => <div>Student App Active</div>);
    useStudentSessionRouteDataMock.mockReturnValue({
      attemptSnapshot: {
        id: 'attempt-1',
        scheduleId: 'sched-1',
        recovery: {
          syncState: 'syncing_reconnect',
        },
      },
      error: null,
      isLoading: false,
      retry: vi.fn(),
      runtimeSnapshot: { status: 'live', currentSectionKey: 'reading' },
      state: {
        phase: 'exam',
        currentModule: 'reading',
        currentQuestionId: 'q1',
      },
      refreshRuntime: vi.fn(),
      answerInvariantRollout: null,
    });

    renderRoute('/student/sched-1/alice');

    expect(screen.queryByText('Loading Error')).not.toBeInTheDocument();
    expect(await screen.findByText('Student App Active')).toBeInTheDocument();
    expect(StudentAppWrapperMock).toHaveBeenCalled();
    const props = StudentAppWrapperMock.mock.calls[0]?.[0] as { allowExitDuringExam?: boolean };
    expect(props.allowExitDuringExam).toBe(false);
  });
});
