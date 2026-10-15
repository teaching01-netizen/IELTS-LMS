import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExamEntity } from '../../../../../types/domain';
import type { AccessDistributionOverview, AssessmentAccessLink } from '../../../contracts/accessLinks';
import { StudentLinksDashboard } from '../StudentLinksDashboard';
import type { AccessSessionBindings, SessionPhase } from '../../delivery/sessionState';

const mocks = vi.hoisted(() => ({
  update: vi.fn(),
  lifecycle: vi.fn(),
  duplicate: vi.fn(),
  remove: vi.fn(),
  sharedSetValue: vi.fn(),
  publishCommand: vi.fn(),
  setPresence: vi.fn(),
  flowProps: [] as Array<Record<string, unknown>>,
}));

vi.mock("../../../realtime/coedit", () => ({
  useSatAuthoringCollaboration: () => ({
    workspaceSnapshot: { values: {}, ready: false, localReady: false },
    setValue: mocks.sharedSetValue,
    setValues: vi.fn(),
    publishCommand: mocks.publishCommand,
    setPresence: mocks.setPresence,
    status: "disabled",
  }),
}));

vi.mock('../../../api/assessmentAccessLinkQueries', () => ({
  useUpdateAccessLink: () => ({ mutateAsync: mocks.update, isPending: false }),
  useSetAccessLinkLifecycle: () => ({ mutateAsync: mocks.lifecycle, isPending: false }),
  useDeleteAccessLink: () => ({ mutateAsync: mocks.remove, isPending: false, variables: undefined }),
  useDuplicateAccessLink: () => ({ mutateAsync: mocks.duplicate, isPending: false }),
  useAccessLinkMembers: () => ({ data: [], isLoading: false }),
  useAccessLinkActivity: () => ({ data: [], isLoading: false }),
}));

// Existing rooms still edit in the settings sheet; new rooms go through the one-action flow.
vi.mock('../AccessLinkEditorSheet', () => ({
  AccessLinkEditorSheet: ({ open }: { open: boolean }) => open ? <div data-testid="link-editor">editor</div> : null,
}));
vi.mock('../../publish/SatCreateRoomFlow', () => ({
  SatCreateRoomFlow: (props: Record<string, unknown>) => {
    mocks.flowProps.push(props);
    return <div data-testid="create-room-flow">flow</div>;
  },
}));
const shareSheet = vi.hoisted(() => vi.fn((_props: { open: boolean; link: unknown }) => null));
vi.mock('../AccessLinkShareSheet', () => ({
  AccessLinkShareSheet: shareSheet,
  AccessLinkPresentView: () => null,
}));

function sessionBindings(overrides: Partial<AccessSessionBindings> = {}): AccessSessionBindings {
  return {
    canRun: true,
    infoFor: () => null,
    stale: false,
    refreshing: false,
    onRefresh: vi.fn(),
    onOpenRoom: vi.fn(),
    onOpenResults: vi.fn(),
    ...overrides,
  };
}

const exam: ExamEntity = {
  id: 'exam-1', slug: 'sat', title: 'Digital SAT', providerKey: 'sat', providerExamType: 'sat',
  type: 'Academic', status: 'published', visibility: 'organization', owner: 'builder-1',
  createdAt: '2026-08-20T00:00:00Z', updatedAt: '2026-08-28T00:00:00Z',
  currentDraftVersionId: 'draft-5', currentPublishedVersionId: 'version-5',
  canEdit: true, canPublish: true, canDelete: true, revision: 7, schemaVersion: 4,
};

function link(id: string, name: string, versionId: string, versionNumber: number, status: AssessmentAccessLink['status']): AssessmentAccessLink {
  return {
    id, examId: exam.id, examTitle: exam.title, providerKey: 'sat', publishedVersionId: versionId,
    versionNumber, publishScope: 'full', scheduleId: `schedule-${id}`, name, audienceType: 'cohort', audienceLabel: name,
    accessMode: 'student_code', availabilityType: 'anytime', opensAt: null, closesAt: null,
    lifecycleState: status === 'paused' ? 'paused' : status === 'revoked' ? 'revoked' : 'active', status,
    selectedStudentCount: 0, metrics: { registered: 10, started: 8, submitted: 4 },
    isCurrentRelease: versionId === exam.currentPublishedVersionId, hasParticipation: true, revision: 3,
    createdAt: '2026-08-28T00:00:00Z', updatedAt: '2026-08-28T00:00:00Z',
  };
}

const overview: AccessDistributionOverview = {
  currentPublishedVersion: {
    id: 'version-5', versionNumber: 5, revision: 1, publishNotes: null, publishScope: 'full', createdAt: '2026-08-28T00:00:00Z',
  },
  links: [
    link('link-current', 'Saturday Class', 'version-5', 5, 'live'),
    link('link-upcoming', 'Monday Class', 'version-5', 5, 'upcoming'),
    link('link-old', 'Old Scholarship', 'version-4', 4, 'live'),
  ],
};

beforeEach(() => {
  mocks.update.mockReset();
  mocks.lifecycle.mockReset();
  mocks.duplicate.mockReset();
  mocks.remove.mockReset();
  mocks.sharedSetValue.mockReset();
  mocks.publishCommand.mockReset();
  mocks.setPresence.mockReset();
  mocks.flowProps.length = 0;
  shareSheet.mockClear();
  window.localStorage.clear();
  mocks.lifecycle.mockResolvedValue(overview.links[0]);
  mocks.duplicate.mockResolvedValue({ ...overview.links[0], id: 'link-copy', name: 'Saturday Class Copy' });
});

const shellNav = { lifecycle: { label: 'Rooms available', detail: null, tone: 'published' as const, state: 'published_current' as const }, showResponses: false, onSelectTab: vi.fn(), onBack: vi.fn(), onPreview: vi.fn() };

function renderDashboard(props: Partial<Parameters<typeof StudentLinksDashboard>[0]> = {}) {
  return render(
    <StudentLinksDashboard
      exam={exam}
      overview={overview}
      isLoading={false}
      error={null}
      onRefresh={vi.fn()}
      canCreate
      onFixIssue={vi.fn()}
      shell={shellNav}
      {...props}
    />,
  );
}

describe('StudentLinksDashboard', () => {
  it('keeps older-release rooms visible and labels every row with its version', () => {
    renderDashboard();

    expect(screen.getByText('Saturday Class')).toBeInTheDocument();
    expect(screen.getByText('Monday Class')).toBeInTheDocument();
    expect(screen.getByText('Old Scholarship')).toBeInTheDocument();
    expect(screen.getByText('Version 4')).toBeInTheDocument();
    expect(screen.getAllByText('Version 5')).toHaveLength(2);
  });

  it('narrows the list by search and offers Clear search when nothing matches', async () => {
    renderDashboard();
    fireEvent.change(screen.getByLabelText('Search rooms'), { target: { value: 'Monday' } });
    await waitFor(() => expect(screen.queryByText('Old Scholarship')).not.toBeInTheDocument());
    expect(screen.getByText('Monday Class')).toBeInTheDocument();
    expect(screen.getByText('1 of 3 rooms')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Search rooms'), { target: { value: 'zzz' } });
    expect(await screen.findByText('No rooms match “zzz”')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(screen.getByText('Old Scholarship')).toBeInTheDocument();
  });

  it('groups rooms by exam phase and keeps closed rooms collapsed', () => {
    const phases: Record<string, SessionPhase> = { 'schedule-link-current': 'live', 'schedule-link-upcoming': 'ready', 'schedule-link-old': 'finished' };
    const revoked = { ...link('link-gone', 'Revoked Class', 'version-5', 5, 'revoked') };
    renderDashboard({
      overview: { ...overview, links: [...overview.links, revoked] },
      session: sessionBindings({ infoFor: (scheduleId) => phases[scheduleId] ? { phase: phases[scheduleId]!, joined: 3, timingModel: null } : null }),
    });
    const live = screen.getByRole('region', { name: /Live now/ });
    expect(within(live).getByText('Saturday Class')).toBeInTheDocument();
    expect(within(live).getByText('Running')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: /Ready to start/ })).getByText('Monday Class')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: /Finished/ })).getByText('Old Scholarship')).toBeInTheDocument();
    const closed = screen.getByText('Closed rooms (1)').closest('details')!;
    expect(closed).not.toHaveAttribute('open');
    expect(within(closed).getByText('Revoked Class')).toBeInTheDocument();
  });

  it('opens the room from the row, and offers View results for a finished room', () => {
    const session = sessionBindings({ infoFor: (scheduleId) => ({ phase: scheduleId === 'schedule-link-old' ? 'finished' : 'ready', joined: 0, timingModel: null }) });
    renderDashboard({ session });
    fireEvent.click(screen.getByRole('button', { name: 'Open Monday Class' }));
    expect(session.onOpenRoom).toHaveBeenCalledWith('schedule-link-upcoming');

    fireEvent.click(screen.getByLabelText('Actions for Old Scholarship'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'View results' }));
    expect(session.onOpenResults).toHaveBeenCalledWith('schedule-link-old');
  });

  it('opens Share instead of the room for staff who cannot run rooms', () => {
    const session = sessionBindings({ canRun: false });
    renderDashboard({ session });
    fireEvent.click(screen.getByRole('button', { name: 'Open Monday Class' }));
    expect(session.onOpenRoom).not.toHaveBeenCalled();
    expect(shareSheet.mock.lastCall?.[0]).toMatchObject({ open: true, link: { id: 'link-upcoming' } });
  });

  it('shows Jump back in for this exam only, newest first', () => {
    window.localStorage.setItem('sat-recent-rooms', JSON.stringify([
      { scheduleId: 'schedule-link-old', examId: 'exam-1', at: Date.now() - 5 * 60_000 },
      { scheduleId: 'schedule-other', examId: 'exam-2', at: Date.now() - 60_000 },
      { scheduleId: 'schedule-link-upcoming', examId: 'exam-1', at: Date.now() - 2 * 3_600_000 },
    ]));
    const session = sessionBindings();
    renderDashboard({ session });
    const recent = screen.getByRole('region', { name: 'Jump back in' });
    const cards = within(recent).getAllByRole('button');
    expect(cards.map((card) => card.textContent)).toEqual([
      expect.stringContaining('Old Scholarship'),
      expect.stringContaining('Monday Class'),
    ]);
    expect(cards[0]).toHaveTextContent('Opened 5 minutes ago');
    fireEvent.click(cards[0]!);
    expect(session.onOpenRoom).toHaveBeenCalledWith('schedule-link-old');
  });

  it('hides Jump back in when this browser opened no room of the exam', () => {
    renderDashboard();
    expect(screen.queryByRole('region', { name: 'Jump back in' })).not.toBeInTheDocument();
  });

  it('marks and focuses the room the viewer came back from', () => {
    renderDashboard({ highlightLinkId: 'link-upcoming' });
    const row = screen.getByRole('button', { name: 'Open Monday Class (last opened)' });
    expect(row).toHaveFocus();
    expect(screen.getByText('Last opened')).toBeInTheDocument();
  });

  it('opens the edit sheet once for ?edit=1 and reports it handled', () => {
    const onEditHandled = vi.fn();
    renderDashboard({ editLinkId: 'link-upcoming', onEditHandled });
    expect(screen.getByTestId('link-editor')).toBeInTheDocument();
    expect(onEditHandled).toHaveBeenCalledOnce();
  });

  it('links to the global Rooms list for this exam', () => {
    const onOpenAllRooms = vi.fn();
    renderDashboard({ onOpenAllRooms });
    fireEvent.click(screen.getByRole('button', { name: 'All rooms' }));
    expect(onOpenAllRooms).toHaveBeenCalledOnce();
  });

  it('runs lifecycle and duplicate actions without mutating a release, opening the one-action form for a duplicate', async () => {
    renderDashboard();

    fireEvent.click(screen.getByLabelText('Actions for Saturday Class'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Pause check-in' }));
    await waitFor(() => expect(mocks.lifecycle).toHaveBeenCalledWith({
      linkId: 'link-current', request: { revision: 3, state: 'paused' },
    }));

    fireEvent.click(screen.getByLabelText('Actions for Saturday Class'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Duplicate setup' }));
    expect(screen.getByTestId('create-room-flow')).toBeInTheDocument();
    expect(mocks.flowProps.at(-1)).toMatchObject({ examId: 'exam-1', prefill: expect.objectContaining({ id: 'link-current' }) });
    expect(mocks.duplicate).not.toHaveBeenCalled();
  });

  it('reviews a replacement setup in the create form instead of creating a group directly', () => {
    renderDashboard();
    fireEvent.click(screen.getByLabelText('Actions for Old Scholarship'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Duplicate setup' }));

    expect(screen.getByTestId('create-room-flow')).toBeInTheDocument();
    expect(mocks.flowProps.at(-1)).toMatchObject({ prefill: expect.objectContaining({ id: 'link-old' }) });
    expect(mocks.duplicate).not.toHaveBeenCalled();
  });

  it("confirms permanent deletion, sends the displayed revision, and removes the link", async () => {
    mocks.remove.mockResolvedValue({ ok: true });
    const revisionZeroOverview = {
      ...overview,
      links: overview.links.map((item) => item.id === "link-current" ? { ...item, revision: 0 } : item),
    };
    renderDashboard({ overview: revisionZeroOverview });

    fireEvent.click(screen.getByLabelText("Actions for Saturday Class"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete permanently" }));
    const dialog = screen.getByRole("alertdialog", { name: "Delete this student link permanently?" });
    expect(dialog).toHaveTextContent("URL will no longer let students enter");
    expect(dialog).toHaveTextContent("Schedules, exam attempts, scores, and exam history will be preserved");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(mocks.remove).not.toHaveBeenCalled();

    fireEvent.click(screen.getByLabelText("Actions for Saturday Class"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete permanently" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete permanently" }));

    await waitFor(() => expect(mocks.remove).toHaveBeenCalledWith({
      linkId: "link-current", request: { revision: 0 },
    }));
    expect(mocks.sharedSetValue).toHaveBeenCalledWith("access/link-current", undefined);
    expect(mocks.publishCommand).toHaveBeenCalledWith("access.deleted", { linkId: "link-current" });
    await waitFor(() => expect(screen.queryByText("Saturday Class")).not.toBeInTheDocument());
    expect(screen.getByText("Monday Class")).toBeInTheDocument();
  });

  it("keeps a link and offers refresh when deletion loses the revision race", async () => {
    mocks.remove.mockRejectedValue(new Error("409 revision conflict: Student Link changed while you were editing it"));
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    renderDashboard({ onRefresh });

    fireEvent.click(screen.getByLabelText("Actions for Saturday Class"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete permanently" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete permanently" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Refresh the link list before trying again");
    expect(screen.getAllByText("Saturday Class").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(onRefresh).toHaveBeenCalledOnce();
  });

  it('makes room creation the primary empty-state action', () => {
    renderDashboard({ overview: { ...overview, links: [] } });
    expect(screen.queryByRole('button', { name: 'New access group' })).not.toBeInTheDocument();
    // The header offers the same action, so the empty state's button is scoped to the Rooms region.
    fireEvent.click(within(screen.getByRole('region', { name: 'Rooms' })).getByRole('button', { name: 'Create room' }));
    expect(screen.getByTestId('create-room-flow')).toBeInTheDocument();
  });

  it('lets staff create the very first room before anything was ever published', () => {
    renderDashboard({ overview: { currentPublishedVersion: null, links: [] } });
    expect(screen.queryByRole('button', { name: /publish/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'Create room' })[0]!);
    expect(screen.getByTestId('create-room-flow')).toBeInTheDocument();
  });

  it('hides Create room from staff who cannot create rooms', () => {
    renderDashboard({ canCreate: false, overview: { currentPublishedVersion: null, links: [] } });
    expect(screen.queryByRole('button', { name: 'Create room' })).not.toBeInTheDocument();
  });

  it('passes the exam issue a create-room check named up to the host', () => {
    const onFixIssue = vi.fn();
    renderDashboard({ onFixIssue, overview: { ...overview, links: [] } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Create room' })[0]!);
    const flow = mocks.flowProps.at(-1) as { onFixIssue: (issue: unknown) => void };
    flow.onFixIssue({ code: 'x', path: 'examQuestion:q1:prompt', message: 'm', blocking: true });
    expect(onFixIssue).toHaveBeenCalledWith(expect.objectContaining({ path: 'examQuestion:q1:prompt' }));
  });
});
