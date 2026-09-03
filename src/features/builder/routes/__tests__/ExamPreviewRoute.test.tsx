import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createInitialExamState } from '../../../../services/examAdapterService';
import { ExamPreviewRoute } from '../ExamPreviewRoute';

const mockNavigate = vi.fn();
const wrapperSpy = vi.fn();
const mockController = vi.fn();
const resolvePreviewRuntimeSessionMock = vi.fn();
const useStudentSessionRouteDataMock = vi.fn();
let searchParams = new URLSearchParams('module=writing');
const setSearchParamsMock = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useParams: () => ({ examId: 'exam-1' }),
    useSearchParams: () => [searchParams, setSearchParamsMock],
  };
});

vi.mock('../../../auth/authSession', () => ({
  useAuthSession: () => ({
    session: {
      user: {
        id: 'builder-1',
      },
    },
  }),
}));

vi.mock('@builder/hooks/useBuilderRouteController', () => ({
  useBuilderRouteController: (...args: unknown[]) => mockController(...args),
}));

vi.mock('@student/hooks/useStudentSessionRouteData', () => ({
  useStudentSessionRouteData: (...args: unknown[]) => useStudentSessionRouteDataMock(...args),
}));

vi.mock('../../services/previewRuntimeSessionService', () => ({
  resolvePreviewRuntimeSession: (...args: unknown[]) => resolvePreviewRuntimeSessionMock(...args),
}));

vi.mock('@components/student/StudentAppWrapper', () => ({
  StudentAppWrapper: (props: unknown) => {
    wrapperSpy(props);
    return <div data-testid="student-app-wrapper" />;
  },
}));

describe('ExamPreviewRoute', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    searchParams = new URLSearchParams('module=writing');

    useStudentSessionRouteDataMock.mockReturnValue({
      answerInvariantRollout: {
        enabled: true,
        killSwitch: false,
        cohort: null,
        configFingerprint: null,
        source: 'default',
      },
      attemptSnapshot: null,
      error: null,
      isLoading: false,
      refreshRuntime: vi.fn(),
      runtimeSnapshot: null,
      state: createInitialExamState('Preview exam', 'Academic'),
    });

    resolvePreviewRuntimeSessionMock.mockResolvedValue({
      module: 'writing',
      scheduleId: 'sched-preview-writing',
      studentId: 'W123456',
    });
  });

  it('renders runtime preview with wrapper in preview-safe mode', async () => {
    const state = createInitialExamState('Preview exam', 'Academic');
    mockController.mockReturnValue({
      isLoading: false,
      error: null,
      exam: {
        id: 'exam-1',
        slug: 'exam-1',
        title: 'Preview exam',
        type: 'Academic',
        status: 'draft',
        visibility: 'private',
        owner: 'builder-1',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        currentDraftVersionId: 'ver-1',
        currentPublishedVersionId: null,
        canEdit: true,
        canPublish: true,
        canDelete: true,
        schemaVersion: 4,
      },
      state,
    });

    render(<ExamPreviewRoute />);

    await waitFor(() => {
      expect(screen.getByTestId('student-app-wrapper')).toBeInTheDocument();
    });

    expect(screen.getByRole('combobox', { name: /preview section/i })).toBeInTheDocument();
    expect(wrapperSpy).toHaveBeenCalledTimes(1);

    const props = wrapperSpy.mock.calls[0]?.[0] as {
      showSubmitControls: boolean;
      persistenceEnabled: boolean;
      enableMonitoring: boolean;
      allowExitDuringExam: boolean;
      scheduleId: string;
      onExit: () => void;
    };

    expect(props.showSubmitControls).toBe(false);
    expect(props.persistenceEnabled).toBe(false);
    expect(props.enableMonitoring).toBe(false);
    expect(props.allowExitDuringExam).toBe(true);
    expect(props.scheduleId).toBe('sched-preview-writing');

    props.onExit();
    expect(mockNavigate).toHaveBeenCalledWith('/builder/exam-1/builder', { replace: true });

    expect(resolvePreviewRuntimeSessionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        requestedModule: 'writing',
        authorUserId: 'builder-1',
      }),
    );
  });

  it('updates preview query param when module changes', async () => {
    const state = createInitialExamState('Preview exam', 'Academic');
    mockController.mockReturnValue({
      isLoading: false,
      error: null,
      exam: {
        id: 'exam-1',
        slug: 'exam-1',
        title: 'Preview exam',
        type: 'Academic',
        status: 'draft',
        visibility: 'private',
        owner: 'builder-1',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        currentDraftVersionId: 'ver-1',
        currentPublishedVersionId: null,
        canEdit: true,
        canPublish: true,
        canDelete: true,
        schemaVersion: 4,
      },
      state,
    });

    render(<ExamPreviewRoute />);

    await waitFor(() => {
      expect(screen.getByTestId('student-app-wrapper')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByRole('combobox', { name: /preview section/i }), {
      target: { value: 'reading' },
    });

    expect(setSearchParamsMock).toHaveBeenCalled();
    const [nextParams, options] = setSearchParamsMock.mock.calls.at(-1) as [
      URLSearchParams,
      { replace: boolean },
    ];
    expect(nextParams.get('module')).toBe('reading');
    expect(options).toEqual({ replace: true });
  });

  it('keeps hook order stable when loading state resolves', async () => {
    const state = createInitialExamState('Preview exam', 'Academic');
    const exam = {
      id: 'exam-1',
      slug: 'exam-1',
      title: 'Preview exam',
      type: 'Academic',
      status: 'draft',
      visibility: 'private',
      owner: 'builder-1',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      currentDraftVersionId: 'ver-1',
      currentPublishedVersionId: null,
      canEdit: true,
      canPublish: true,
      canDelete: true,
      schemaVersion: 4,
    };
    let isLoaded = false;

    mockController.mockImplementation(() =>
      isLoaded
        ? {
            isLoading: false,
            error: null,
            exam,
            state,
          }
        : {
            isLoading: true,
            error: null,
            exam: undefined,
            state: null,
          },
    );

    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { rerender } = render(<ExamPreviewRoute />);

    isLoaded = true;

    expect(() => rerender(<ExamPreviewRoute />)).not.toThrow();
    await waitFor(() => {
      expect(screen.getByTestId('student-app-wrapper')).toBeInTheDocument();
    });

    consoleErrorSpy.mockRestore();
  });

  it('renders ACT Science through the student runtime preview', async () => {
    searchParams = new URLSearchParams('module=science');
    resolvePreviewRuntimeSessionMock.mockResolvedValueOnce({
      module: 'science',
      scheduleId: 'sched-preview-science',
      studentId: 'W654321',
    });
    const state = createInitialExamState('ACT Science preview', 'ACT');
    mockController.mockReturnValue({
      isLoading: false,
      error: null,
      exam: {
        id: 'exam-1',
        slug: 'exam-1',
        title: 'ACT Science preview',
        type: 'ACT',
        status: 'draft',
        visibility: 'private',
        owner: 'builder-1',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        currentDraftVersionId: 'ver-1',
        currentPublishedVersionId: null,
        canEdit: true,
        canPublish: true,
        canDelete: true,
        schemaVersion: 4,
      },
      state,
    });

    render(<ExamPreviewRoute />);

    expect(await screen.findByTestId('student-app-wrapper')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: /preview section/i })).toHaveValue('science');
    expect(resolvePreviewRuntimeSessionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        requestedModule: 'science',
        authorUserId: 'builder-1',
      }),
    );

    const props = wrapperSpy.mock.calls[0]?.[0] as { scheduleId: string };
    expect(props.scheduleId).toBe('sched-preview-science');
  });
});
