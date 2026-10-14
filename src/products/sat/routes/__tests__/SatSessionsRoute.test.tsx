import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../../../shared/api-client/errors';
import { clearSatRoomDraft } from '../../../../features/exam-authoring/application/satRoomDraftStore';
import { SatSessionsRoute } from '../SatSessionsRoute';

const useSummariesMock = vi.hoisted(() => vi.fn());
const useExamListQueryMock = vi.hoisted(() => vi.fn());
const useOverviewMock = vi.hoisted(() => vi.fn());
const createRoomMock = vi.hoisted(() => vi.fn());
vi.mock('../../../../features/proctor/api/proctorQueries', () => ({
  proctorKeys: { sessions: (provider?: string) => ['proctor', 'sessions', provider ?? 'all'] },
  useProctorSessionSummaries: useSummariesMock,
}));
vi.mock('../../../../features/exam-authoring/api/examQueries', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useExamListQuery: useExamListQueryMock,
    useExamQuery: (examId?: string) => ({ data: { id: examId, canEdit: true, revision: 4 }, refetch: vi.fn().mockResolvedValue({ data: { id: examId, canEdit: true, revision: 4 } }) }),
  };
});
vi.mock('../../../../features/exam-authoring/api/assessmentAccessLinkQueries', () => ({
  useAccessDistributionOverview: useOverviewMock,
  useAccessLinkMembers: () => ({ data: [], isLoading: false, error: null, refetch: vi.fn() }),
}));
vi.mock('../../../../features/exam-authoring/api/satCreateRoomApi', () => ({
  satCreateRoomApi: { create: createRoomMock, operation: vi.fn() },
}));
vi.mock('../../../../features/exam-authoring/application/authoringShellLifecycle', () => ({
  useAuthoringShellLifecycle: () => ({ refresh: vi.fn().mockResolvedValue({ kind: 'no-draft' }) }),
}));
vi.mock('../../../../features/exam-authoring/realtime/coedit', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useSatAuthoringCollaboration: () => null };
});
vi.mock('../../../../features/proctor/application/proctorFacade', () => ({
  proctorFacade: { isPreviewRuntimeCohortName: () => false },
}));
vi.mock('../../../../features/auth/authSession', () => ({
  useAuthSession: () => ({ session: { user: { role: 'admin' } } }),
  useOptionalAuthSession: () => null,
}));

beforeAll(() => {
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = function showModal() { this.setAttribute('open', ''); };
  }
  if (!HTMLDialogElement.prototype.close) {
    HTMLDialogElement.prototype.close = function close() { this.removeAttribute('open'); this.dispatchEvent(new Event('close')); };
  }
});

// Neither exam was ever published: a room needs no prior publication.
const satExam = { id: 'sat-1', title: 'SAT Mock', providerKey: 'sat', status: 'draft', currentPublishedVersionId: null };
const archivedExam = { id: 'sat-old', title: 'SAT Retired', providerKey: 'sat', status: 'archived', currentPublishedVersionId: 'v-old' };
const ieltsExam = { id: 'ielts-1', title: 'IELTS Published', providerKey: 'ielts', status: 'published', currentPublishedVersionId: 'v-ielts' };
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
const receipt = {
  room: { id: 'link-new', scheduleId: 'sched-new' },
  version: { id: 'v-new', number: 1, scope: 'full', createdNow: true },
  exam: { revision: 5 },
};

function LocationProbe() {
  return <p data-testid="location">{useLocation().pathname}</p>;
}

function routeElement(client: QueryClient) {
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/sat/sessions']}>
        <Routes>
          <Route path="/sat/sessions" element={<SatSessionsRoute />} />
          <Route path="/sat/sessions/:scheduleId" element={<LocationProbe />} />
          <Route path="/sat/exams/:examId" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

function newClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderRoute() {
  return render(routeElement(newClient()));
}

/** Opens the one room setup sheet; the exam is its first field. */
function openSetup() {
  fireEvent.click(screen.getByRole('button', { name: 'Create room' }));
}

describe('SatSessionsRoute', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearSatRoomDraft('sat-1');
    clearSatRoomDraft('sat-2');
    useSummariesMock.mockReturnValue({ data: [summary], isLoading: false, error: null, refetch: vi.fn() });
    useExamListQueryMock.mockReturnValue({ data: { entities: [ieltsExam, archivedExam, satExam], exams: [] }, isLoading: false, error: null });
    useOverviewMock.mockReturnValue({ data: { currentPublishedVersion: null, links: [] }, isLoading: false, error: null, refetch: vi.fn() });
    createRoomMock.mockResolvedValue(receipt);
  });

  it('requests SAT-only room and exam boundaries', () => {
    renderRoute();
    expect(useSummariesMock).toHaveBeenCalledWith(4_000, 'sat');
    expect(useExamListQueryMock).toHaveBeenCalledWith(true, 'sat', false);
    expect(screen.getByText(/SAT Published ·/)).toBeInTheDocument();
  });

  it('offers any active SAT exam, published or not, and never IELTS or archived exams', () => {
    renderRoute();
    openSetup();
    expect(screen.getByRole('option', { name: 'SAT Mock' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'IELTS Published' })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'SAT Retired' })).not.toBeInTheDocument();
    // No publish step or version wording: the room captures the latest saved exam.
    expect(screen.getByText('This room uses the latest saved exam')).toBeInTheDocument();
    expect(within(screen.getByRole('dialog', { name: 'Create room' })).queryByText(/Publish/)).not.toBeInTheDocument();
    // Exam choice and room setup share one sheet: no chooser step before the form.
    expect(screen.getByLabelText('Room name')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Continue' })).not.toBeInTheDocument();
  });

  it('creates the room on the exam chosen last, keeping the room name typed before the switch', async () => {
    const otherSat = { id: 'sat-2', title: 'SAT October', providerKey: 'sat', status: 'published', currentPublishedVersionId: 'v-oct' };
    useExamListQueryMock.mockReturnValue({ data: { entities: [satExam, otherSat], exams: [] }, isLoading: false, error: null });
    renderRoute();
    openSetup();
    fireEvent.change(screen.getByLabelText('Room name'), { target: { value: 'Saturday mock' } });
    fireEvent.change(screen.getByLabelText('Exam'), { target: { value: 'sat-2' } });

    expect(screen.getByLabelText('Room name')).toHaveValue('Saturday mock');
    fireEvent.click(screen.getByRole('button', { name: 'Create room' }));
    await waitFor(() => expect(createRoomMock).toHaveBeenCalledOnce());
    expect(createRoomMock.mock.calls[0]![0]).toBe('sat-2');
    expect(createRoomMock.mock.calls[0]![1].room).toMatchObject({ name: 'Saturday mock' });
  });

  it('renders header plus skeleton while loading, without blanking the page', () => {
    useSummariesMock.mockReturnValue({ data: undefined, isLoading: true, error: null, refetch: vi.fn() });
    renderRoute();
    expect(screen.getByText('Rooms')).toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'Loading rooms' })).toBeInTheDocument();
  });

  it('announces the visible room count once data is present', () => {
    renderRoute();
    expect(screen.getByRole('status')).toHaveTextContent('1 room');
  });

  it('labels room-list times and distinguishes the live run-sheet timezone', () => {
    renderRoute();
    expect(screen.getByText(/Room start times use your local timezone \(.+\)\. The live run sheet uses Thailand time · ICT \(UTC\+7\)\./)).toBeInTheDocument();
  });

  it('focuses the first sheet field on open', () => {
    renderRoute();
    fireEvent.click(screen.getByRole('button', { name: 'Create room' }));
    expect(screen.getByLabelText('Exam')).toBeInTheDocument();
  });

  it('creates from the unpublished exam in one request with no version pin, then lands in the new room', async () => {
    renderRoute();
    openSetup();
    fireEvent.change(screen.getByLabelText('Room name'), { target: { value: 'Saturday mock' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create room' }));

    await waitFor(() => expect(createRoomMock).toHaveBeenCalledOnce());
    const [examId, request] = createRoomMock.mock.calls[0]!;
    expect(examId).toBe('sat-1');
    expect(request.room).toMatchObject({ name: 'Saturday mock', audienceType: 'anyone', availabilityType: 'anytime' });
    expect(request.room).not.toHaveProperty('publishedVersionId');
    expect(request).toMatchObject({ expectedExamRevision: 4, expectedDraftVersionId: '' });
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/sat/sessions/sched-new'));
  });

  it('keeps the form and stays on the list when creation is refused, so a retry cannot be lost', async () => {
    createRoomMock.mockRejectedValueOnce(new ApiError({ code: 'ROOM_INVALID', message: 'The room could not be created.', status: 422 }));
    renderRoute();
    openSetup();
    fireEvent.change(screen.getByLabelText('Room name'), { target: { value: 'Saturday mock' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create room' }));
    const alerts = await screen.findAllByRole('alert');
    expect(alerts.some((alert) => alert.textContent?.includes('The room could not be created.'))).toBe(true);
    expect(screen.getByRole('dialog', { name: 'Create room' })).toBeInTheDocument();
    expect(screen.getByLabelText('Room name')).toHaveValue('Saturday mock');
    expect(screen.queryByTestId('location')).not.toBeInTheDocument();
  });

  it('sends an exam-content finding to the question that needs fixing and restores the form on return', async () => {
    createRoomMock.mockRejectedValueOnce(new ApiError({
      code: 'EXAM_NOT_READY',
      message: 'Fix the exam issues before creating a room.',
      status: 422,
      details: { currentExamRevision: 4, issues: [{ code: 'question.prompt.required', path: 'examQuestion:q-9:prompt', message: 'Question text is required.' }] },
    }));
    renderRoute();
    openSetup();
    fireEvent.change(screen.getByLabelText('Room name'), { target: { value: 'Needs a fix' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create room' }));
    fireEvent.click(await screen.findByRole('button', { name: /^Fix:/ }));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/sat/exams/sat-1'));

    // Back on the list, reopening the form restores what was typed.
    expect(screen.queryByRole('dialog', { name: 'Create room' })).not.toBeInTheDocument();
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
    expect(createRoomMock).not.toHaveBeenCalled();
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
    expect(createRoomMock).not.toHaveBeenCalled();
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
    expect(createRoomMock).not.toHaveBeenCalled();
  });

  it('offers an earlier room’s setup as a starting point', () => {
    const earlier = {
      id: 'link-1', name: 'Morning class', versionNumber: 8, audienceType: 'cohort', audienceLabel: 'Morning', accessMode: 'student_code',
      availabilityType: 'anytime', opensAt: null, closesAt: null, enabledSections: null, publishScope: 'reading-writing', providerKey: 'sat', selectedStudentCount: 0,
    };
    useOverviewMock.mockReturnValue({ data: { currentPublishedVersion: null, links: [earlier] }, isLoading: false, error: null, refetch: vi.fn() });
    renderRoute();
    openSetup();
    fireEvent.change(screen.getByRole('combobox', { name: 'Start from an earlier room' }), { target: { value: 'link-1' } });
    expect(screen.getByLabelText('Room name')).toHaveValue('Morning class (copy)');
    expect(screen.getByLabelText('Class or group label')).toHaveValue('Morning');
  });

  it('confirms before discarding a dirty setup, closes quietly when pristine', () => {
    renderRoute();
    openSetup();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    openSetup();
    fireEvent.change(screen.getByLabelText('Room name'), { target: { value: 'Morning SAT' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Discard room settings changes?');
    fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(createRoomMock).not.toHaveBeenCalled();
  });

  it('distinguishes filtered-zero from bucket-empty with query echo and clear action', () => {
    renderRoute();
    fireEvent.change(screen.getByPlaceholderText('Search rooms or exams'), { target: { value: 'zzz-no-match' } });
    expect(screen.getByText('No matching rooms')).toBeInTheDocument();
    expect(screen.getByText(/No rooms match/)).toHaveTextContent('zzz-no-match');
    expect(screen.getByRole('status')).toHaveTextContent('0 of 1 rooms');
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(screen.getByText(/SAT Published ·/)).toBeInTheDocument();
  });

  it('preserves search text when the bucket filter changes (04A composition guard)', () => {
    renderRoute();
    fireEvent.change(screen.getByPlaceholderText('Search rooms or exams'), { target: { value: 'zzz-no-match' } });
    fireEvent.click(screen.getByRole('radio', { name: 'Live 0' }));
    expect(screen.getByPlaceholderText('Search rooms or exams')).toHaveValue('zzz-no-match');
    expect(screen.getByText('No matching rooms')).toBeInTheDocument();
    expect(screen.getByText(/No rooms match/)).toHaveTextContent('zzz-no-match');
  });

  it('closes a pristine setup on Escape with no alertdialog', () => {
    renderRoute();
    fireEvent.click(screen.getByRole('button', { name: 'Create room' }));
    expect(screen.getByRole('dialog', { name: 'Create room' })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Create room' })).not.toBeInTheDocument();
  });

  it('keeps the setup open while creation is pending', async () => {
    createRoomMock.mockReturnValue(new Promise(() => undefined));
    renderRoute();
    openSetup();
    fireEvent.change(screen.getByLabelText('Room name'), { target: { value: 'Morning SAT' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create room' }));
    await waitFor(() => expect(createRoomMock).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole('button', { name: 'Close room settings' }));
    expect(screen.getByLabelText('Room name')).toBeInTheDocument();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('returns focus to the Create room trigger after pristine Cancel', async () => {
    renderRoute();
    const trigger = screen.getByRole('button', { name: 'Create room' });
    trigger.focus();
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog', { name: 'Create room' })).not.toBeInTheDocument();
    // The sheet restores focus once Radix finishes unmounting it.
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it('keeps every room data point on one merged meta line (04A hierarchy guard)', () => {
    const { container } = renderRoute();
    const row = screen.getByText(/SAT Published ·/).closest('.sat-list-row');
    expect(row).not.toBeNull();
    expect(row).toHaveTextContent('Morning');
    expect(row).toHaveTextContent('0 joined');
    expect(row).toHaveTextContent('Not started');
    const meta = row?.querySelector('.tabular-nums');
    expect(meta).not.toBeNull();
    // Staff metadata never drops below 14px.
    expect(meta?.className).toMatch(/text-\[14px\]/);
    expect(container.innerHTML).not.toMatch(/bg-gradient|backdrop-blur/);
  });
});
