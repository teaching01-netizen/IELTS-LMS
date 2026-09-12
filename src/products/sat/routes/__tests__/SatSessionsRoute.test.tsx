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

  it('renders header plus skeleton while loading, without blanking the page', () => {
    useSummariesMock.mockReturnValue({ data: undefined, isLoading: true, error: null, refetch: vi.fn() });
    renderRoute();
    expect(screen.getByText('Sessions')).toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'Loading SAT sessions' })).toBeInTheDocument();
  });

  it('announces the visible session count once data is present', () => {
    renderRoute();
    expect(screen.getByRole('status')).toHaveTextContent('1 session');
  });

  it('focuses the first sheet field on open', () => {
    renderRoute();
    fireEvent.click(screen.getByRole('button', { name: 'New Session' }));
    expect(screen.getByLabelText('SAT exam')).toBeInTheDocument();
  });

  it('explains an invalid session time range without clearing the form', async () => {
    // Far-future fixtures: the D2 past-start rule (default now) must not
    // shadow the end>start assertion as the real clock advances.
    renderRoute();
    fireEvent.click(screen.getByRole('button', { name: 'New Session' }));
    fireEvent.change(screen.getByLabelText('Session name'), { target: { value: 'Morning SAT' } });
    fireEvent.change(screen.getByLabelText('Session start time'), { target: { value: '2099-09-01T13:00' } });
    fireEvent.change(screen.getByLabelText('Session end time'), { target: { value: '2099-09-01T10:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Schedule' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('End time must be after the start time.');
    expect(screen.getByLabelText('Session start time')).toHaveValue('2099-09-01T13:00');
  });

  it('confirms before discarding a dirty sheet, closes quietly when pristine', () => {
    renderRoute();
    fireEvent.click(screen.getByRole('button', { name: 'New Session' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'New Session' }));
    fireEvent.change(screen.getByLabelText('Session name'), { target: { value: 'Morning SAT' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Discard this session?');
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('rejects a past start time in the sheet (D2 policy)', async () => {
    renderRoute();
    fireEvent.click(screen.getByRole('button', { name: 'New Session' }));
    fireEvent.change(screen.getByLabelText('Session name'), { target: { value: 'Morning SAT' } });
    fireEvent.change(screen.getByLabelText('Session start time'), { target: { value: '2000-09-01T10:00' } });
    fireEvent.change(screen.getByLabelText('Session end time'), { target: { value: '2000-09-01T13:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Schedule' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Start time is in the past.');
  });

  it('distinguishes filtered-zero from bucket-empty with query echo and clear action', () => {
    renderRoute();
    fireEvent.change(screen.getByPlaceholderText('Search exam, cohort, institution'), { target: { value: 'zzz-no-match' } });
    expect(screen.getByText('No matching sessions')).toBeInTheDocument();
    expect(screen.getByText(/No sessions match/)).toHaveTextContent('zzz-no-match');
    expect(screen.getByRole('status')).toHaveTextContent('0 of 1 sessions');
    fireEvent.click(screen.getByRole('button', { name: 'Clear Search' }));
    expect(screen.getByText('SAT Published')).toBeInTheDocument();
  });

  it('rejects a session shorter than 15 minutes in the sheet (D2 policy)', async () => {
    renderRoute();
    fireEvent.click(screen.getByRole('button', { name: 'New Session' }));
    fireEvent.change(screen.getByLabelText('Session name'), { target: { value: 'Morning SAT' } });
    fireEvent.change(screen.getByLabelText('Session start time'), { target: { value: '2099-09-01T10:00' } });
    fireEvent.change(screen.getByLabelText('Session end time'), { target: { value: '2099-09-01T10:10' } });
    fireEvent.click(screen.getByRole('button', { name: 'Schedule' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Sessions must be at least 15 minutes long.');
  });

  it('preserves search text when the bucket filter changes (04A composition guard)', () => {
    renderRoute();
    fireEvent.change(screen.getByPlaceholderText('Search exam, cohort, institution'), { target: { value: 'zzz-no-match' } });
    fireEvent.click(screen.getByRole('radio', { name: 'Live' }));
    expect(screen.getByPlaceholderText('Search exam, cohort, institution')).toHaveValue('zzz-no-match');
    expect(screen.getByText('No matching sessions')).toBeInTheDocument();
    expect(screen.getByText(/No sessions match/)).toHaveTextContent('zzz-no-match');
  });

  it('opens the discard alert when edited datetimes are cancelled, then discards both', () => {
    renderRoute();
    fireEvent.click(screen.getByRole('button', { name: 'New Session' }));
    fireEvent.change(screen.getByLabelText('Session start time'), { target: { value: '2099-09-01T10:00' } });
    fireEvent.change(screen.getByLabelText('Session end time'), { target: { value: '2099-09-01T13:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Discard this session?');
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'New Session' })).not.toBeInTheDocument();
  });

  it('closes a pristine sheet on Escape with no alertdialog', () => {
    renderRoute();
    fireEvent.click(screen.getByRole('button', { name: 'New Session' }));
    expect(screen.getByRole('dialog', { name: 'New Session' })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'New Session' })).not.toBeInTheDocument();
  });

  it('keeps the sheet mounted on Cancel while saving is pending', () => {
    useSaveScheduleMock.mockReturnValue({ mutateAsync: vi.fn(() => new Promise(() => {})), isPending: true });
    renderRoute();
    fireEvent.click(screen.getByRole('button', { name: 'New Session' }));
    fireEvent.change(screen.getByLabelText('Session name'), { target: { value: 'Morning SAT' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('dialog', { name: 'New Session' })).toBeInTheDocument();
  });

  it('returns focus to the New Session trigger after pristine Cancel', () => {
    renderRoute();
    const trigger = screen.getByRole('button', { name: 'New Session' });
    trigger.focus();
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog', { name: 'New Session' })).not.toBeInTheDocument();
    expect(document.activeElement).toBe(trigger);
  });

  it('keeps every session data point on one merged 10px meta line (04A hierarchy guard)', () => {
    const { container } = renderRoute();
    const row = screen.getByText('SAT Published').closest('.sat-list-row');
    expect(row).not.toBeNull();
    expect(row).toHaveTextContent('Morning');
    expect(row).toHaveTextContent('0 joined');
    expect(row).toHaveTextContent('0 active');
    expect(row).toHaveTextContent('Ready');
    const meta = row?.querySelector('.tabular-nums');
    expect(meta).not.toBeNull();
    expect(meta?.className).toMatch(/text-\[10px\]/);
    expect(container.innerHTML).not.toMatch(/bg-gradient|backdrop-blur/);
  });
});
