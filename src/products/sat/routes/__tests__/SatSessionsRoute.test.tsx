import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SatSessionsRoute } from '../SatSessionsRoute';

const useSummariesMock = vi.hoisted(() => vi.fn());
const useExamListQueryMock = vi.hoisted(() => vi.fn());
const useSaveScheduleMock = vi.hoisted(() => vi.fn());
vi.mock('../../../../features/proctor/api/proctorQueries', () => ({
  proctorKeys: { sessions: (provider?: string) => ['proctor', 'sessions', provider ?? 'all'] },
  useProctorSessionSummaries: useSummariesMock,
}));
vi.mock('../../../../features/exam-authoring/api/examQueries', () => ({ useExamListQuery: useExamListQueryMock }));
vi.mock('../../../../features/scheduling/api/scheduleQueries', () => ({ useSaveScheduleMutation: useSaveScheduleMock }));
vi.mock('../../../../features/proctor/application/proctorFacade', () => ({
  proctorFacade: { isPreviewRuntimeCohortName: () => false },
}));
vi.mock('../../../../features/auth/authSession', () => ({
  useAuthSession: () => ({ session: { user: { role: 'admin' } } }),
}));

const satExam = {
  id: 'sat-1', title: 'SAT Published', providerKey: 'sat', currentPublishedVersionId: 'v-sat',
};
const ieltsExam = {
  id: 'ielts-1', title: 'IELTS Published', providerKey: 'ielts', currentPublishedVersionId: 'v-ielts',
};
const summary = {
  schedule: {
    id: 'sched-1', examId: 'sat-1', providerKey: 'sat', examTitle: 'SAT Published', proctorDisplayName: 'SAT Published',
    gradingDisplayName: 'SAT Published', publishedVersionId: 'v-sat', cohortName: 'Morning', startTime: '2026-09-01T02:00:00Z',
    endTime: '2026-09-01T06:00:00Z', plannedDurationMinutes: 180, deliveryMode: 'proctor_start', autoStart: false, autoStop: false,
    status: 'scheduled', createdAt: '2026-08-30T00:00:00Z', createdBy: 'Admin', updatedAt: '2026-08-30T00:00:00Z',
  },
  runtime: {
    id: 'runtime-1', scheduleId: 'sched-1', examId: 'sat-1', providerKey: 'sat', examTitle: 'SAT Published', cohortName: 'Morning',
    deliveryMode: 'proctor_start', status: 'not_started', timingModel: 'cohort_section_v3', actualStartAt: null, actualEndAt: null,
    activeSectionKey: null, currentSectionKey: null, currentSectionRemainingSeconds: 0, waitingForNextSection: false, isOverrun: false,
    totalPausedSeconds: 0, sections: [], createdAt: '2026-08-30T00:00:00Z', updatedAt: '2026-08-30T00:00:00Z',
  },
  studentCount: 0, activeCount: 0, alertCount: 0, violationCount: 0, degradedLiveMode: false,
};

function renderRoute() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><MemoryRouter><SatSessionsRoute /></MemoryRouter></QueryClientProvider>);
}

describe('SatSessionsRoute', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSummariesMock.mockReturnValue({ data: [summary], isLoading: false, error: null, refetch: vi.fn() });
    useExamListQueryMock.mockReturnValue({ data: { entities: [ieltsExam, satExam], exams: [] }, isLoading: false, error: null });
    useSaveScheduleMock.mockReturnValue({ mutateAsync: vi.fn(), isPending: false });
  });

  it('requests SAT-only session and exam boundaries', () => {
    renderRoute();
    expect(useSummariesMock).toHaveBeenCalledWith(4_000, 'sat');
    expect(useExamListQueryMock).toHaveBeenCalledWith(true, 'sat');
    expect(screen.getByText('SAT Published')).toBeInTheDocument();
  });

  it('never offers IELTS exams when creating a SAT session', () => {
    renderRoute();
    fireEvent.click(screen.getByRole('button', { name: 'New Session' }));
    expect(screen.getByRole('option', { name: 'SAT Published' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'IELTS Published' })).not.toBeInTheDocument();
  });
});
