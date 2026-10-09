import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { SatSessionsRoute } from '../SatSessionsRoute';

const useSummariesMock = vi.hoisted(() => vi.fn());
const useExamListQueryMock = vi.hoisted(() => vi.fn());
const useOverviewMock = vi.hoisted(() => vi.fn());
const createMutateMock = vi.hoisted(() => vi.fn());
const createStateMock = vi.hoisted(() => ({ isPending: false }));
vi.mock('../../../../features/proctor/api/proctorQueries', () => ({
  proctorKeys: { sessions: (provider?: string) => ['proctor', 'sessions', provider ?? 'all'] },
  useProctorSessionSummaries: useSummariesMock,
}));
vi.mock('../../../../features/exam-authoring/api/examQueries', () => ({ useExamListQuery: useExamListQueryMock }));
vi.mock('../../../../features/exam-authoring/api/assessmentAccessLinkQueries', () => ({
  useAccessDistributionOverview: useOverviewMock,
  useCreateAccessLink: () => ({ mutateAsync: createMutateMock, isPending: createStateMock.isPending }),
  useAccessLinkMembers: () => ({ data: [], isLoading: false, error: null, refetch: vi.fn() }),
}));
vi.mock('../../../../features/proctor/application/proctorFacade', () => ({
  proctorFacade: { isPreviewRuntimeCohortName: () => false },
}));
vi.mock('../../../../features/auth/authSession', () => ({
  useAuthSession: () => ({ session: { user: { role: 'admin' } } }),
}));

beforeAll(() => {
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = function showModal() { this.setAttribute('open', ''); };
  }
  if (!HTMLDialogElement.prototype.close) {
    HTMLDialogElement.prototype.close = function close() { this.removeAttribute('open'); this.dispatchEvent(new Event('close')); };
  }
});

const satExam = {
  id: 'sat-1', title: 'SAT Published', providerKey: 'sat', currentPublishedVersionId: 'v-sat', currentPublishedScope: 'reading-writing',
};
const ieltsExam = {
  id: 'ielts-1', title: 'IELTS Published', providerKey: 'ielts', currentPublishedVersionId: 'v-ielts',
};
const summary = {
  schedule: {
    id: 'sched-1', examId: 'sat-1', providerKey: 'sat', examTitle: 'SAT Published', proctorDisplayName: 'SAT Published',
    gradingDisplayName: 'SAT Published', publishedVersionId: 'v-sat', publishScope: 'reading-writing', cohortName: 'Morning', startTime: '2026-09-01T02:00:00Z',
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
const publishedVersion = { id: 'v-9', versionNumber: 9, revision: 1, publishNotes: null, publishScope: 'reading-writing', createdAt: '2026-09-01T00:00:00Z' };

function LocationProbe() {
  return <p data-testid="location">{useLocation().pathname}</p>;
}

function renderRoute() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/sat/sessions']}>
        <Routes>
          <Route path="/sat/sessions" element={<SatSessionsRoute />} />
          <Route path="/sat/sessions/:scheduleId" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** Opens the unified setup for the (only) SAT exam: exam question first, then the shared session form. */
function openSetup() {
  fireEvent.click(screen.getByRole('button', { name: 'Create room' }));
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
}

describe('SatSessionsRoute', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createStateMock.isPending = false;
    useSummariesMock.mockReturnValue({ data: [summary], isLoading: false, error: null, refetch: vi.fn() });
    useExamListQueryMock.mockReturnValue({ data: { entities: [ieltsExam, satExam], exams: [] }, isLoading: false, error: null });
    useOverviewMock.mockReturnValue({ data: { currentPublishedVersion: publishedVersion, links: [] }, isLoading: false, error: null, refetch: vi.fn() });
    createMutateMock.mockResolvedValue({ id: 'link-new', scheduleId: 'sched-new' });
  });

  it('requests SAT-only room and exam boundaries', () => {
    renderRoute();
    expect(useSummariesMock).toHaveBeenCalledWith(4_000, 'sat');
    expect(useExamListQueryMock).toHaveBeenCalledWith(true, 'sat');
    expect(screen.getByText('SAT Published')).toBeInTheDocument();
  });

  it('never offers IELTS exams when creating a SAT room', () => {
    renderRoute();
    fireEvent.click(screen.getByRole('button', { name: 'Create room' }));
    expect(screen.getByRole('option', { name: 'SAT Published' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'IELTS Published' })).not.toBeInTheDocument();
    expect(screen.getByText('Students will receive Reading & Writing only in this session.')).toBeInTheDocument();
  });

  it('renders header plus skeleton while loading, without blanking the page', () => {
    useSummariesMock.mockReturnValue({ data: undefined, isLoading: true, error: null, refetch: vi.fn() });
    renderRoute();
    expect(screen.getByText('Rooms')).toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'Loading SAT rooms' })).toBeInTheDocument();
  });

  it('announces the visible room count once data is present', () => {
    renderRoute();
    expect(screen.getByRole('status')).toHaveTextContent('1 room');
  });

  it('focuses the first sheet field on open', () => {
    renderRoute();
    fireEvent.click(screen.getByRole('button', { name: 'Create room' }));
    expect(screen.getByLabelText('SAT test')).toBeInTheDocument();
  });

  it('opens the same room settings the exam uses, pinned to the exam’s published version, then lands in the new room', async () => {
    renderRoute();
    openSetup();
    expect(screen.getByText('Digital SAT · Version 9')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Room name'), { target: { value: 'Saturday mock' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create room' }));

    await waitFor(() => expect(createMutateMock).toHaveBeenCalledOnce());
    expect(createMutateMock.mock.calls[0]![0]).toMatchObject({
      name: 'Saturday mock', publishedVersionId: 'v-9', audienceType: 'anyone', availabilityType: 'anytime', enabledSections: ['reading-writing'],
    });
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/sat/sessions/sched-new'));
  });

  it('keeps the form and stays on the list when creation fails, so a retry cannot be lost', async () => {
    createMutateMock.mockRejectedValueOnce(new Error('The room could not be created.'));
    renderRoute();
    openSetup();
    fireEvent.change(screen.getByLabelText('Room name'), { target: { value: 'Saturday mock' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create room' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The room could not be created.');
    expect(screen.getByLabelText('Room name')).toHaveValue('Saturday mock');
    expect(screen.queryByTestId('location')).not.toBeInTheDocument();
  });

  it('explains an invalid check-in window without clearing the form', async () => {
    // Far-future fixtures: the D2 past-start rule must not shadow the end>start assertion.
    renderRoute();
    openSetup();
    fireEvent.change(screen.getByLabelText('Room name'), { target: { value: 'Morning SAT' } });
    fireEvent.click(screen.getByRole('button', { name: /Scheduled/ }));
    fireEvent.change(screen.getByLabelText('Opens'), { target: { value: '2099-09-01T13:00' } });
    fireEvent.change(screen.getByLabelText('Closes'), { target: { value: '2099-09-01T10:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create room' }));
    expect(await screen.findByText('Closing time must be after opening time.')).toBeInTheDocument();
    expect(screen.getByLabelText('Opens')).toHaveValue('2099-09-01T13:00');
    expect(createMutateMock).not.toHaveBeenCalled();
  });

  it('rejects a past opening time for a new room (D2 policy)', async () => {
    renderRoute();
    openSetup();
    fireEvent.change(screen.getByLabelText('Room name'), { target: { value: 'Morning SAT' } });
    fireEvent.click(screen.getByRole('button', { name: /Scheduled/ }));
    fireEvent.change(screen.getByLabelText('Opens'), { target: { value: '2000-09-01T10:00' } });
    fireEvent.change(screen.getByLabelText('Closes'), { target: { value: '2000-09-01T13:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create room' }));
    expect(await screen.findByText('Start time is in the past.')).toBeInTheDocument();
    expect(createMutateMock).not.toHaveBeenCalled();
  });

  it('rejects a check-in window shorter than 15 minutes (D2 policy)', async () => {
    renderRoute();
    openSetup();
    fireEvent.change(screen.getByLabelText('Room name'), { target: { value: 'Morning SAT' } });
    fireEvent.click(screen.getByRole('button', { name: /Scheduled/ }));
    fireEvent.change(screen.getByLabelText('Opens'), { target: { value: '2099-09-01T10:00' } });
    fireEvent.change(screen.getByLabelText('Closes'), { target: { value: '2099-09-01T10:10' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create room' }));
    expect(await screen.findByText('Rooms must be at least 15 minutes long.')).toBeInTheDocument();
    expect(createMutateMock).not.toHaveBeenCalled();
  });

  it('offers an earlier room’s setup as a starting point', () => {
    const earlier = {
      id: 'link-1', name: 'Morning class', versionNumber: 8, audienceType: 'cohort', audienceLabel: 'Morning', accessMode: 'student_code',
      availabilityType: 'anytime', opensAt: null, closesAt: null, enabledSections: null, publishScope: 'reading-writing', providerKey: 'sat', selectedStudentCount: 0,
    };
    useOverviewMock.mockReturnValue({ data: { currentPublishedVersion: publishedVersion, links: [earlier] }, isLoading: false, error: null, refetch: vi.fn() });
    renderRoute();
    openSetup();
    fireEvent.change(screen.getByRole('combobox', { name: 'Start from an earlier room' }), { target: { value: 'link-1' } });
    expect(screen.getByLabelText('Room name')).toHaveValue('Morning class (copy)');
    expect(screen.getByLabelText('Class or group label')).toHaveValue('Morning');
  });

  it('confirms before discarding a dirty setup, closes quietly when pristine', () => {
    renderRoute();
    fireEvent.click(screen.getByRole('button', { name: 'Create room' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    openSetup();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    openSetup();
    fireEvent.change(screen.getByLabelText('Room name'), { target: { value: 'Morning SAT' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Discard room settings changes?');
    fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(createMutateMock).not.toHaveBeenCalled();
  });

  it('distinguishes filtered-zero from bucket-empty with query echo and clear action', () => {
    renderRoute();
    fireEvent.change(screen.getByPlaceholderText('Search exam, cohort, institution'), { target: { value: 'zzz-no-match' } });
    expect(screen.getByText('No matching rooms')).toBeInTheDocument();
    expect(screen.getByText(/No rooms match/)).toHaveTextContent('zzz-no-match');
    expect(screen.getByRole('status')).toHaveTextContent('0 of 1 rooms');
    fireEvent.click(screen.getByRole('button', { name: 'Clear Search' }));
    expect(screen.getByText('SAT Published')).toBeInTheDocument();
  });

  it('preserves search text when the bucket filter changes (04A composition guard)', () => {
    renderRoute();
    fireEvent.change(screen.getByPlaceholderText('Search exam, cohort, institution'), { target: { value: 'zzz-no-match' } });
    fireEvent.click(screen.getByRole('radio', { name: 'Live 0' }));
    expect(screen.getByPlaceholderText('Search exam, cohort, institution')).toHaveValue('zzz-no-match');
    expect(screen.getByText('No matching rooms')).toBeInTheDocument();
    expect(screen.getByText(/No rooms match/)).toHaveTextContent('zzz-no-match');
  });

  it('closes a pristine exam chooser on Escape with no alertdialog', () => {
    renderRoute();
    fireEvent.click(screen.getByRole('button', { name: 'Create room' }));
    expect(screen.getByRole('dialog', { name: 'Create room' })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Create room' })).not.toBeInTheDocument();
  });

  it('keeps the setup open while creation is pending', () => {
    createStateMock.isPending = true;
    renderRoute();
    openSetup();
    fireEvent.change(screen.getByLabelText('Room name'), { target: { value: 'Morning SAT' } });
    fireEvent.click(screen.getByRole('button', { name: 'Close room settings' }));
    expect(screen.getByLabelText('Room name')).toBeInTheDocument();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('returns focus to the Create room trigger after pristine Cancel', () => {
    renderRoute();
    const trigger = screen.getByRole('button', { name: 'Create room' });
    trigger.focus();
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog', { name: 'Create room' })).not.toBeInTheDocument();
    expect(document.activeElement).toBe(trigger);
  });

  it('keeps every room data point on one merged meta line (04A hierarchy guard)', () => {
    const { container } = renderRoute();
    const row = screen.getByText('SAT Published').closest('.sat-list-row');
    expect(row).not.toBeNull();
    expect(row).toHaveTextContent('Morning');
    expect(row).toHaveTextContent('0 joined');
    expect(row).toHaveTextContent('0 active');
    expect(row).toHaveTextContent('Not started');
    const meta = row?.querySelector('.tabular-nums');
    expect(meta).not.toBeNull();
    // Staff metadata never drops below 14px.
    expect(meta?.className).toMatch(/text-\[14px\]/);
    expect(container.innerHTML).not.toMatch(/bg-gradient|backdrop-blur/);
  });
});
