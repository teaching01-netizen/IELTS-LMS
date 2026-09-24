import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SatExamLibraryRoute } from '../SatExamLibraryRoute';
import { SatResultDetailRoute } from '../SatResultDetailRoute';
import { SatResultsRoute } from '../SatResultsRoute';
import { SatSessionRoomRoute } from '../SatSessionRoomRoute';
import { SatSessionsRoute } from '../SatSessionsRoute';

const useSatResultsQueryMock = vi.hoisted(() => vi.fn());
const useSatAttemptsQueryMock = vi.hoisted(() => vi.fn());
const useSatResultQueryMock = vi.hoisted(() => vi.fn());
vi.mock('../../../../features/results/api/satResultsQueries', () => ({
  useSatResultsQuery: useSatResultsQueryMock,
  useSatAttemptsQuery: useSatAttemptsQueryMock,
  useSatResultQuery: useSatResultQueryMock,
}));

const useExamListQueryMock = vi.hoisted(() => vi.fn());
const createProviderExamMock = vi.hoisted(() => vi.fn());
const invalidateExamListMock = vi.hoisted(() => vi.fn());
// NOTE: SatSessionsRoute imports useExamListQuery from the same examQueries
// module, so useExamListQueryMock serves both Library and Sessions routes.
vi.mock('../../../../features/exam-authoring/api/examQueries', () => ({
  useExamListQuery: useExamListQueryMock,
  invalidateExamList: invalidateExamListMock,
}));
vi.mock('../../../../features/exam-authoring/api/examAuthoringFacade', () => ({
  examAuthoringFacade: { lifecycle: { createProviderExam: createProviderExamMock } },
}));

const useSummariesMock = vi.hoisted(() => vi.fn());
const useSaveScheduleMock = vi.hoisted(() => vi.fn());
vi.mock('../../../../features/proctor/api/proctorQueries', () => ({
  proctorKeys: { sessions: (provider?: string) => ['proctor', 'sessions', provider ?? 'all'] },
  useProctorSessionSummaries: useSummariesMock,
}));
vi.mock('../../../../features/scheduling/api/scheduleQueries', () => ({
  useSaveScheduleMutation: useSaveScheduleMock,
}));
vi.mock('../../../../features/proctor/application/proctorFacade', () => ({
  proctorFacade: { isPreviewRuntimeCohortName: () => false },
}));

const controllerMock = vi.hoisted(() => vi.fn());
vi.mock('../../../../features/proctor/hooks/useProctorRouteController', () => ({
  useProctorRouteController: controllerMock,
}));
vi.mock('../../../../features/proctor/infrastructure/proctorGateway', () => ({
  examDeliveryService: {
    extendStudentAttempt: vi.fn(),
    warnStudent: vi.fn(),
    pauseStudentAttempt: vi.fn(),
    resumeStudentAttempt: vi.fn(),
    terminateStudentAttempt: vi.fn(),
  },
}));

vi.mock('../../../../features/auth/authSession', () => ({
  useAuthSession: () => ({
    session: { user: { role: 'admin', displayName: 'Admin', email: 'admin@example.com' } },
  }),
}));

const resultSummary = {
  id: 'result-1',
  submissionId: 'submission-1',
  scheduleId: 'schedule-1',
  examId: 'sat-1',
  examTitle: 'Practice Test 06',
  versionNumber: 3,
  studentId: 'W2501',
  studentName: 'Ananda S.',
  studentEmail: null,
  cohortName: 'Morning',
  submittedAt: '2026-08-30T08:00:00Z',
  totalScore: 1370,
  scoreKind: 'practice',
  releaseStatus: 'ready_to_release',
  outcomeStatus: 'scored',
};
const accessGroupSummary = {
  scheduleId: 'schedule-1', accessLinkId: 'link-1', accessLinkName: 'Morning Access', accessLinkState: 'active',
  examId: 'sat-1', examTitle: 'Practice Test 06', versionNumber: 3, cohortName: 'Morning',
  attemptCount: 3, submittedCount: 3, scoredCount: 1, pendingCount: 1, invalidatedCount: 1, latestSubmittedAt: '2026-08-30T08:00:00Z',
};

const satExam = {
  id: 'sat-1',
  slug: 'sat-1',
  title: 'SAT Practice 06',
  providerKey: 'sat',
  type: 'Academic',
  status: 'draft',
  visibility: 'organization',
  owner: 'Admin',
  createdAt: '2026-08-29T00:00:00Z',
  updatedAt: '2026-08-30T00:00:00Z',
  currentDraftVersionId: 'draft-1',
  currentPublishedVersionId: null,
  canEdit: true,
  canPublish: true,
  canDelete: true,
  schemaVersion: 4,
};

const sessionSummary = {
  schedule: {
    id: 'sched-1',
    examId: 'sat-1',
    providerKey: 'sat',
    examTitle: 'SAT Published',
    proctorDisplayName: 'SAT Published',
    gradingDisplayName: 'SAT Published',
    publishedVersionId: 'v-sat',
    cohortName: 'Morning',
    startTime: '2026-09-01T02:00:00Z',
    endTime: '2026-09-01T06:00:00Z',
    plannedDurationMinutes: 180,
    deliveryMode: 'proctor_start',
    autoStart: false,
    autoStop: false,
    status: 'scheduled',
    createdAt: '2026-08-30T00:00:00Z',
    createdBy: 'Admin',
    updatedAt: '2026-08-30T00:00:00Z',
  },
  runtime: {
    id: 'runtime-1',
    scheduleId: 'sched-1',
    examId: 'sat-1',
    providerKey: 'sat',
    examTitle: 'SAT Published',
    cohortName: 'Morning',
    deliveryMode: 'proctor_start',
    status: 'not_started',
    timingModel: 'cohort_section_v3',
    actualStartAt: null,
    actualEndAt: null,
    activeSectionKey: null,
    currentSectionKey: null,
    currentSectionRemainingSeconds: 0,
    waitingForNextSection: false,
    isOverrun: false,
    totalPausedSeconds: 0,
    sections: [],
    createdAt: '2026-08-30T00:00:00Z',
    updatedAt: '2026-08-30T00:00:00Z',
  },
  studentCount: 0,
  activeCount: 0,
  alertCount: 0,
  violationCount: 0,
  degradedLiveMode: false,
};

const roomSchedule = {
  id: 'sched-1',
  examId: 'sat-1',
  providerKey: 'sat',
  examTitle: 'Practice Test 06',
  proctorDisplayName: 'Practice Test 06',
  gradingDisplayName: 'Practice Test 06',
  publishedVersionId: 'v1',
  cohortName: 'Morning',
  startTime: '2026-08-30T02:00:00Z',
  endTime: '2026-08-30T06:00:00Z',
  plannedDurationMinutes: 180,
  deliveryMode: 'proctor_start',
  autoStart: false,
  autoStop: false,
  status: 'live',
  createdAt: '2026-08-30T00:00:00Z',
  createdBy: 'Admin',
  updatedAt: '2026-08-30T00:00:00Z',
};
const roomRuntime = {
  id: 'runtime-1',
  scheduleId: 'sched-1',
  examId: 'sat-1',
  providerKey: 'sat',
  examTitle: 'Practice Test 06',
  cohortName: 'Morning',
  deliveryMode: 'proctor_start',
  status: 'live',
  timingModel: 'cohort_section_v3',
  actualStartAt: '2026-08-30T02:00:00Z',
  actualEndAt: null,
  activeSectionKey: 'reading',
  currentSectionKey: 'reading',
  currentSectionRemainingSeconds: 1603,
  waitingForNextSection: false,
  isOverrun: false,
  totalPausedSeconds: 0,
  sections: [
    {
      sectionKey: 'reading',
      label: 'Reading & Writing · Module 1',
      order: 1,
      plannedDurationMinutes: 32,
      gapAfterMinutes: 0,
      status: 'live',
      availableAt: null,
      actualStartAt: '2026-08-30T02:00:00Z',
      actualEndAt: null,
      pausedAt: null,
      accumulatedPausedSeconds: 0,
      extensionMinutes: 0,
    },
  ],
  createdAt: '2026-08-30T02:00:00Z',
  updatedAt: '2026-08-30T02:05:00Z',
};
const roomStudent = {
  id: 'attempt-1',
  studentId: 'W2501',
  name: 'Ananda S.',
  email: 'a@example.com',
  scheduleId: 'sched-1',
  status: 'active',
  currentSection: 'reading',
  timeRemaining: 1500,
  runtimeStatus: 'live',
  runtimeCurrentSection: 'reading',
  runtimeTimeRemainingSeconds: 1500,
  violations: [],
  warnings: 0,
  lastActivity: '2026-08-30T02:05:00Z',
  examId: 'sat-1',
  examName: 'Practice Test 06',
};

function renderLibrary() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <SatExamLibraryRoute />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function renderSessions() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <SatSessionsRoute />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('SAT Phase 02 copy contracts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSatResultsQueryMock.mockReturnValue({
      data: [accessGroupSummary],
      isLoading: false,
      error: null,
      isFetching: false,
      refetch: vi.fn(),
    });
    useSatAttemptsQueryMock.mockReturnValue({
      data: { items: [
        { resultId: 'result-1', attemptId: 'attempt-1', ...resultSummary, outcomeStatus: 'scored' },
        { resultId: 'result-pending', attemptId: 'attempt-2', ...resultSummary, studentName: 'Pending Student', outcomeStatus: 'pending', totalScore: null },
        { resultId: 'result-terminated', attemptId: 'attempt-3', ...resultSummary, studentName: 'Terminated Student', outcomeStatus: 'invalidated_proctor', totalScore: null },
      ], total: 3, offset: 0, limit: 50, hasMore: false }, isLoading: false, error: null, isFetching: false, refetch: vi.fn(),
    });
    useExamListQueryMock.mockReturnValue({
      data: { entities: [satExam], exams: [] },
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });
    invalidateExamListMock.mockResolvedValue(undefined);
    createProviderExamMock.mockResolvedValue({ success: true, exam: satExam });
    useSummariesMock.mockReturnValue({ data: [sessionSummary], isLoading: false, error: null, refetch: vi.fn() });
    useSaveScheduleMock.mockReturnValue({ mutateAsync: vi.fn(), isPending: false });
    controllerMock.mockReturnValue({
      schedules: [roomSchedule],
      runtimeSnapshots: [roomRuntime],
      sessions: [roomStudent],
      alerts: [],
      error: null,
      isLoading: false,
      reload: vi.fn().mockResolvedValue(undefined),
      handleStartScheduledSession: vi.fn(),
      handlePauseCohort: vi.fn(),
      handleResumeCohort: vi.fn(),
      handleExtendCurrentSection: vi.fn(),
      handleCompleteExam: vi.fn(),
    });
  });

  it('placeholders name their filter scope', () => {
    // Search scope follows the hierarchy: exams, then access groups, then students.
    const { unmount: unmountResults } = render(
      <MemoryRouter>
        <SatResultsRoute />
      </MemoryRouter>,
    );
    expect(screen.getByPlaceholderText('Search exams')).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Search results')).not.toBeInTheDocument();
    unmountResults();

    render(
      <MemoryRouter initialEntries={['/sat/results?exam=sat-1']}>
        <SatResultsRoute />
      </MemoryRouter>,
    );
    expect(screen.getByPlaceholderText('Search Student Access')).toBeInTheDocument();
    cleanup();

    render(<MemoryRouter initialEntries={['/sat/results?exam=sat-1&access=schedule-1']}><SatResultsRoute /></MemoryRouter>);
    expect(screen.getByPlaceholderText('Search name, ID, cohort')).toBeInTheDocument();
    cleanup();

    renderLibrary();
    expect(screen.getByPlaceholderText('Search exam title')).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Search exams')).not.toBeInTheDocument();
  });

  it('sessions and room placeholders name their filter scope', () => {
    renderSessions();
    expect(screen.getByPlaceholderText('Search exam, cohort, institution')).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Search sessions')).not.toBeInTheDocument();

    render(
      <MemoryRouter initialEntries={['/sat/sessions/sched-1']}>
        <Routes>
          <Route path="/sat/sessions/:scheduleId" element={<SatSessionRoomRoute />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByPlaceholderText('Search name, ID, email')).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Search students')).not.toBeInTheDocument();
  });

  it('empty-state CTAs are Title Case', () => {
    renderLibrary();
    fireEvent.change(screen.getByPlaceholderText('Search exam title'), { target: { value: 'zzz-no-match' } });
    expect(screen.getByRole('button', { name: 'Clear Search' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Clear search' })).not.toBeInTheDocument();
  });

  it('sessions empty-state CTA is Title Case', () => {
    renderSessions();
    fireEvent.change(screen.getByPlaceholderText('Search exam, cohort, institution'), {
      target: { value: 'zzz-no-match' },
    });
    expect(screen.getByRole('button', { name: 'Clear Search' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Clear search' })).not.toBeInTheDocument();
  });

  it('exam creation is named Create SAT', () => {
    createProviderExamMock.mockResolvedValue({ success: true, exam: satExam });
    renderLibrary();
    expect(screen.getByRole('button', { name: 'Create SAT' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'New SAT' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Create SAT' }));
    expect(screen.getByRole('dialog', { name: 'Create SAT' })).toBeInTheDocument();
  });

  it('result rows expose a single status signal', () => {
    useSatResultsQueryMock.mockReturnValue({
      data: [accessGroupSummary],
      isLoading: false,
      error: null,
      isFetching: false,
      refetch: vi.fn(),
    });
    const { container } = render(
      <MemoryRouter>
        <SatResultsRoute />
      </MemoryRouter>,
    );
    // The exam list has one exam row with one roll-up pill.
    const groupRows = container.querySelectorAll('.sat-list-row');
    expect(groupRows.length).toBe(1);
    // One pill per row: the pill is the inline-flex rounded-full tone element.
    groupRows.forEach((row) => {
      expect(row.querySelectorAll('span[class*="rounded-full"][class*="inline-flex"]').length).toBe(1);
    });
    expect(screen.queryByText(/\u00B7 Practice \u00B7/)).not.toBeInTheDocument();
  });

  it('inside-page attempt rows expose a single status signal', () => {
    useSatResultsQueryMock.mockReturnValue({
      data: [accessGroupSummary],
      isLoading: false,
      error: null,
      isFetching: false,
      refetch: vi.fn(),
    });
    const { container } = render(
      <MemoryRouter initialEntries={['/sat/results?exam=sat-1&access=schedule-1']}>
        <SatResultsRoute />
      </MemoryRouter>,
    );
    const rows = container.querySelectorAll('.sat-list-row');
    expect(rows.length).toBe(3);
    rows.forEach((row) => {
      expect(row.querySelectorAll('span[class*="rounded-full"][class*="inline-flex"]').length).toBe(1);
    });
    // Mixed schedule: roll-up pill is pending (pending > 0) plus the pending row's
    // own pill — two 'Scoring pending' nodes, one pill per row each.
    expect(screen.getAllByText('Scoring pending')).toHaveLength(2);
    expect(screen.getByText('Exam terminated by proctor')).toBeInTheDocument();
  });

  it('jargon footnote is gone; module scores stay', () => {
    useSatResultQueryMock.mockReturnValue({
      data: {
        summary: resultSummary,
        scorePayload: {},
        sections: [
          {
            sectionKey: 'reading-writing',
            route: 'higher',
            rawCorrect: 20,
            operationalQuestionCount: 34,
            scaledScore: 680,
            details: {},
            modules: [
              { moduleKey: 'rw-base', adaptiveRole: 'base', rawCorrect: 12, operationalQuestionCount: 20, state: 'submitted', isAdministered: true, displayOrder: 1 },
            ],
          },
        ],
        questions: [],
      },
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });
    render(
      <MemoryRouter initialEntries={['/sat/results/result-1']}>
        <Routes>
          <Route path="/sat/results/:resultId" element={<SatResultDetailRoute />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.queryByText('Module identifiers as delivered.')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Reading & Writing module raw scores')).toBeInTheDocument();
    expect(screen.getByText('rw-base')).toBeInTheDocument();
  });
});
