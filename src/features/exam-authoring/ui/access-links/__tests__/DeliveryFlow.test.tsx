import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExamEntity } from "../../../../../types/domain";
import type { AccessDistributionOverview, AssessmentAccessLink } from "../../../contracts/accessLinks";
import type { AccessSessionBindings, AccessSessionInfo } from "../../delivery/sessionState";

const mocks = vi.hoisted(() => ({
  flowProps: null as null | {
    examId: string;
    prefill?: { name: string } | null;
    reuseOptions?: ReadonlyArray<{ name: string }>;
    onReuseSetup?: (link: AssessmentAccessLink) => void;
    onClose: () => void;
    onRoomCreated: (link: AssessmentAccessLink, receipt: unknown) => void;
  },
  created: null as null | AssessmentAccessLink,
}));

vi.mock("../../../realtime/coedit", () => ({
  useSatAuthoringCollaboration: () => null,
}));
vi.mock("../../../api/assessmentAccessLinkQueries", () => ({
  useUpdateAccessLink: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useSetAccessLinkLifecycle: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteAccessLink: () => ({ mutateAsync: vi.fn(), isPending: false, variables: undefined }),
  useDuplicateAccessLink: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useAccessLinkMembers: () => ({ data: [], isLoading: false }),
  useAccessLinkActivity: () => ({ data: [], isLoading: false }),
}));
vi.mock("../AccessLinkEditorSheet", () => ({
  AccessLinkEditorSheet: ({ open }: { open: boolean }) => (open ? <div role="dialog" aria-label="Room settings">edit</div> : null),
}));
// The one-action create flow is covered by its own tests; here it is a stub so
// the dashboard's hand-offs (open, prefill, completion) can be asserted.
vi.mock("../../publish/SatCreateRoomFlow", () => ({
  SatCreateRoomFlow: (props: NonNullable<typeof mocks.flowProps>) => {
    mocks.flowProps = props;
    return (
      <div role="dialog" aria-label="Create room">
        <p data-testid="flow-prefill">{props.prefill?.name ?? "none"}</p>
        <button type="button" onClick={() => mocks.created && props.onRoomCreated(mocks.created, {})}>
          Finish create
        </button>
      </div>
    );
  },
}));
vi.mock("../AccessLinkShareSheet", () => ({ AccessLinkShareSheet: () => null, AccessLinkPresentView: () => null }));
vi.mock("../../collaboration/CollaborationHeaderCluster", () => ({ CollaborationHeaderCluster: () => null }));

import { StudentLinksDashboard, type CreateRequest } from "../StudentLinksDashboard";

const exam = {
  id: "exam-1", title: "Practice Test 06", providerKey: "sat", canEdit: true, canPublish: true,
} as unknown as ExamEntity;

function link(id: string, name: string, over: Partial<AssessmentAccessLink> = {}): AssessmentAccessLink {
  return {
    id, examId: "exam-1", examTitle: "Practice Test 06", providerKey: "sat", publishedVersionId: "v-3", versionNumber: 3,
    publishScope: "full", scheduleId: `sched-${id}`, name, enabledSections: null, audienceType: "cohort", audienceLabel: name,
    accessMode: "student_code", availabilityType: "anytime", opensAt: null, closesAt: null, lifecycleState: "active",
    status: "live", selectedStudentCount: 0, metrics: { registered: 12, started: 0, submitted: 0 }, isCurrentRelease: true,
    hasParticipation: false, revision: 1, createdAt: "2026-09-01T00:00:00Z", updatedAt: "2026-09-01T00:00:00Z", ...over,
  } as AssessmentAccessLink;
}

const version = { id: "v-3", versionNumber: 3, revision: 1, publishNotes: null, publishScope: "full", createdAt: "2026-09-01T00:00:00Z" } as const;
const overviewWith = (links: AssessmentAccessLink[]): AccessDistributionOverview => ({ currentPublishedVersion: version, links });

const shell = { lifecycle: { label: "Rooms available", detail: null, tone: "published" as const, state: "published_current" as const }, showResponses: true, onSelectTab: vi.fn(), onBack: vi.fn(), onPreview: vi.fn() };

function session(infos: Record<string, AccessSessionInfo>, over: Partial<AccessSessionBindings> = {}): AccessSessionBindings {
  return {
    canRun: true,
    infoFor: (scheduleId) => infos[scheduleId] ?? null,
    stale: false,
    refreshing: false,
    onRefresh: vi.fn(),
    onOpenRoom: vi.fn(),
    onOpenResults: vi.fn(),
    ...over,
  };
}

function dashboard(links: AssessmentAccessLink[], extra: { createRequest?: CreateRequest | null; session?: AccessSessionBindings; selectedLinkId?: string; onSelectionChange?: (id: string | null) => void; overview?: AccessDistributionOverview } = {}) {
  return (
    <StudentLinksDashboard
      exam={exam}
      overview={extra.overview ?? overviewWith(links)}
      isLoading={false}
      error={null}
      onRefresh={vi.fn()}
      canCreate
      onFixIssue={vi.fn()}
      shell={shell}
      {...(extra.createRequest !== undefined ? { createRequest: extra.createRequest } : {})}
      {...(extra.session ? { session: extra.session } : {})}
      {...(extra.selectedLinkId ? { selectedLinkId: extra.selectedLinkId } : {})}
      {...(extra.onSelectionChange ? { onSelectionChange: extra.onSelectionChange } : {})}
    />
  );
}

function renderDashboard(links: AssessmentAccessLink[], extra: Parameters<typeof dashboard>[1] = {}) {
  return render(dashboard(links, extra));
}

const READY: AccessSessionInfo = { phase: "ready", timingModel: "sat_personal_v1", joined: 12 };

beforeEach(() => {
  mocks.flowProps = null;
  mocks.created = null;
});

describe("Delivery: first-time setup", () => {
  it("leads a new exam with a two-step guide, no publish step, and a single obvious next action", () => {
    renderDashboard([]);
    const steps = within(screen.getByRole("list", { name: "Room settings steps" }));
    expect(steps.queryByText("Publish")).not.toBeInTheDocument();
    expect(steps.getByText("Create room").closest("li")).toHaveAttribute("aria-current", "step");
    fireEvent.click(within(screen.getByRole("region", { name: "Set up a room" })).getByRole("button", { name: "Create room" }));
    expect(screen.getByRole("dialog", { name: "Create room" })).toBeInTheDocument();
  });

  it("collapses the guide once access exists, but keeps it reopenable", () => {
    renderDashboard([link("a", "Morning class")]);
    expect(screen.queryByRole("region", { name: "Set up a room" })).not.toBeInTheDocument();
    const guide = screen.getByText("How rooms work").closest("details");
    expect(guide).not.toHaveAttribute("open");
  });

  it("opens the create form straight away for a request from another page", async () => {
    renderDashboard([link("a", "Morning class")], { createRequest: { id: 1 } });
    expect(await screen.findByRole("dialog", { name: "Create room" })).toBeInTheDocument();
    expect(mocks.flowProps?.examId).toBe("exam-1");
  });

  it("opens the form once per request, not again on every re-render", async () => {
    const request: CreateRequest = { id: 7 };
    const view = renderDashboard([link("a", "Morning class")], { createRequest: request });
    expect(await screen.findByRole("dialog", { name: "Create room" })).toBeInTheDocument();
    act(() => mocks.flowProps?.onClose());
    view.rerender(dashboard([link("a", "Morning class")], { createRequest: request }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Create room" })).not.toBeInTheDocument());
  });

  it("continues from creation into Share and run, and lets the author finish later", async () => {
    mocks.created = link("new", "New group");
    const bindings = session({ "sched-new": READY });
    renderDashboard([link("new", "New group")], { createRequest: { id: 1 }, session: bindings });
    fireEvent.click(await screen.findByRole("button", { name: "Finish create" }));
    const panel = within(await screen.findByRole("region", { name: "Room" }));
    const next = await panel.findByText("Room created");
    expect(next.closest("[role=status]")).toHaveTextContent("Copying is optional");
    // Staff who can run sessions are taken straight to the new session's waiting room.
    expect(bindings.onOpenRoom).toHaveBeenCalledWith("sched-new");
    // The panel leads back to the room, where starting happens; copying is not a prerequisite.
    expect(screen.getByRole("button", { name: "Open room" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(within(screen.getByRole("region", { name: "Room" })).queryByText("Room created")).not.toBeInTheDocument();
  });

  it("keeps staff who cannot run rooms on the page after creating one", async () => {
    mocks.created = link("new", "New group");
    const bindings = session({ "sched-new": READY }, { canRun: false });
    renderDashboard([link("new", "New group")], { createRequest: { id: 1 }, session: bindings });
    fireEvent.click(await screen.findByRole("button", { name: "Finish create" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Create room" })).not.toBeInTheDocument());
    expect(bindings.onOpenRoom).not.toHaveBeenCalled();
  });
});

describe("Delivery: running a group", () => {
  it("shows entry and room separately on the row and in the panel", () => {
    renderDashboard([link("a", "Morning class", { status: "paused" })], { session: session({ "sched-a": { phase: "live", timingModel: null, joined: 12 } }) });
    expect(screen.getByRole("button", { name: "Open Morning class" })).toHaveTextContent("Exam: Running");
    const panel = within(screen.getByRole("region", { name: "Room" }));
    // Pausing check-in must not read as pausing the running exam.
    expect(panel.getByText("Check-in").nextElementSibling).toHaveTextContent("Paused");
    expect(panel.getByText("Exam").nextElementSibling).toHaveTextContent("Running");
    expect(panel.getByRole("button", { name: "Open live room" })).toBeInTheDocument();
  });

  it("sends a not-started room to its room, where the start is reviewed", () => {
    const bindings = session({ "sched-a": READY });
    renderDashboard([link("a", "Morning class"), link("b", "Evening class")], { session: bindings });
    expect(screen.queryByRole("button", { name: "Start exam" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open room" }));
    expect(bindings.onOpenRoom).toHaveBeenCalledWith("sched-a");
  });

  it("offers Refresh status instead of guessing when room state is stale", () => {
    const bindings = session({}, { stale: true });
    renderDashboard([link("a", "Morning class")], { session: bindings });
    expect(screen.queryByRole("button", { name: "Start exam" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Refresh status" }));
    expect(bindings.onRefresh).toHaveBeenCalledOnce();
    expect(screen.getByText(/could not be refreshed/i)).toBeInTheDocument();
  });

  it("hides room actions for roles that cannot open the room", () => {
    renderDashboard([link("a", "Morning class")], { session: session({ "sched-a": READY }, { canRun: false }) });
    expect(screen.queryByRole("button", { name: "Start exam" })).not.toBeInTheDocument();
    expect(screen.getByText(/available to administrators/i)).toBeInTheDocument();
    // Sharing still works for them.
    expect(screen.getByRole("button", { name: "Copy student link" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open Morning class" })).not.toHaveTextContent("Room:");
  });

  it("turns a finished room into View results with Duplicate setup, opening a prefilled create form", () => {
    const bindings = session({ "sched-a": { phase: "finished", timingModel: null, joined: 12 } });
    renderDashboard([link("a", "Morning class")], { session: bindings });
    fireEvent.click(screen.getByRole("button", { name: "View results" }));
    expect(bindings.onOpenResults).toHaveBeenCalledWith("sched-a");

    fireEvent.click(screen.getByRole("button", { name: "Duplicate setup" }));
    expect(screen.getByRole("dialog", { name: "Create room" })).toBeInTheDocument();
    expect(screen.getByTestId("flow-prefill")).toHaveTextContent("Morning class");
  });

  it("resumes a paused room in its room, not from the list", () => {
    const bindings = session({ "sched-a": { phase: "paused", timingModel: null, joined: 12 } });
    renderDashboard([link("a", "Morning class")], { session: bindings });
    expect(screen.queryByRole("button", { name: "Resume exam" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open room" }));
    expect(bindings.onOpenRoom).toHaveBeenCalledWith("sched-a");
  });

  it("keeps a cancelled room distinct from a finished one", () => {
    const bindings = session({ "sched-a": { phase: "cancelled", timingModel: null, joined: 12 } });
    renderDashboard([link("a", "Morning class")], { session: bindings });
    expect(screen.getByRole("button", { name: "Open Morning class" })).toHaveTextContent("Exam: Cancelled");
    fireEvent.click(screen.getByRole("button", { name: "Review room" }));
    expect(bindings.onOpenRoom).toHaveBeenCalledWith("sched-a");
  });
});

describe("Delivery continuity and action safety", () => {
  it("lets staff create the first room before anything is published, keeping workspace navigation", () => {
    renderDashboard([], { overview: { currentPublishedVersion: null, links: [] } });
    expect(screen.getByRole("navigation", { name: "Exam sections" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /publish/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "Create room" })[0]!);
    expect(screen.getByRole("dialog", { name: "Create room" })).toBeInTheDocument();
  });

  it("counts rooms from earlier releases toward configured setup", () => {
    renderDashboard([link("old", "Old class", { publishedVersionId: "v-2", versionNumber: 2 })]);
    expect(screen.queryByRole("region", { name: "Set up a room" })).not.toBeInTheDocument();
  });

  it("offers earlier rooms inside the create form and reopens it prefilled", async () => {
    renderDashboard([link("a", "Morning class")], { createRequest: { id: 9 } });
    await screen.findByRole("dialog", { name: "Create room" });
    expect(mocks.flowProps?.reuseOptions?.map((option) => option.name)).toEqual(["Morning class"]);
    act(() => mocks.flowProps?.onReuseSetup?.(link("a", "Morning class")));
    expect(screen.getByTestId("flow-prefill")).toHaveTextContent("Morning class");
  });

  it("restores the requested access group and reports a newly selected group", () => {
    const onSelectionChange = vi.fn();
    renderDashboard([link("a", "Morning class"), link("b", "Evening class")], { selectedLinkId: "b", onSelectionChange });
    expect(screen.getByRole("button", { name: "Open Evening class" })).toHaveAttribute("aria-current", "true");
    fireEvent.click(screen.getByRole("button", { name: "Open Morning class" }));
    expect(onSelectionChange).toHaveBeenCalledWith("a");
  });
});
