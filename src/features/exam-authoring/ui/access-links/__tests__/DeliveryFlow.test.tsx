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

function dashboard(links: AssessmentAccessLink[], extra: { createRequest?: CreateRequest | null; session?: AccessSessionBindings; highlightLinkId?: string; overview?: AccessDistributionOverview } = {}) {
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
      {...(extra.highlightLinkId ? { highlightLinkId: extra.highlightLinkId } : {})}
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
  it("makes Create room the one next action for an exam with no rooms, with no publish step", () => {
    renderDashboard([]);
    expect(screen.queryByRole("button", { name: /publish/i })).not.toBeInTheDocument();
    fireEvent.click(within(screen.getByRole("region", { name: "Rooms" })).getByRole("button", { name: "Create room" }));
    expect(screen.getByRole("dialog", { name: "Create room" })).toBeInTheDocument();
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

  it("takes staff who run rooms from creation straight to the new room", async () => {
    mocks.created = link("new", "New group");
    const bindings = session({ "sched-new": READY });
    renderDashboard([link("new", "New group")], { createRequest: { id: 1 }, session: bindings });
    fireEvent.click(await screen.findByRole("button", { name: "Finish create" }));
    expect(bindings.onOpenRoom).toHaveBeenCalledWith("sched-new", { created: true });
    // The row confirms in place, should the host keep the viewer here.
    expect(within(screen.getByRole("button", { name: "Open New group" })).getByText("Room created")).toBeInTheDocument();
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
  it("shows the exam phase and a non-open check-in separately on the row", () => {
    renderDashboard([link("a", "Morning class", { status: "paused", lifecycleState: "paused" })], { session: session({ "sched-a": { phase: "live", timingModel: null, joined: 12 } }) });
    const row = screen.getByRole("button", { name: "Open Morning class" });
    // Pausing check-in must not read as pausing the running exam.
    expect(row).toHaveTextContent("Running");
    expect(row).toHaveTextContent("Check-in paused");
    expect(within(screen.getByRole("region", { name: /Live now/ })).getByText("Morning class")).toBeInTheDocument();
  });

  it("sends a not-started room to its room, where the start is reviewed", () => {
    const bindings = session({ "sched-a": READY });
    renderDashboard([link("a", "Morning class"), link("b", "Evening class")], { session: bindings });
    expect(screen.queryByRole("button", { name: "Start exam" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open Morning class" }));
    expect(bindings.onOpenRoom).toHaveBeenCalledWith("sched-a");
  });

  it("offers Retry instead of guessing when room state is stale", () => {
    const bindings = session({}, { stale: true });
    renderDashboard([link("a", "Morning class")], { session: bindings });
    expect(screen.getByRole("button", { name: "Open Morning class" })).not.toHaveTextContent("Running");
    expect(screen.getByText(/Room status could not refresh/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(bindings.onRefresh).toHaveBeenCalledOnce();
  });

  it("keeps sharing for roles that cannot open the room", () => {
    const bindings = session({ "sched-a": READY }, { canRun: false });
    renderDashboard([link("a", "Morning class")], { session: bindings });
    fireEvent.click(screen.getByRole("button", { name: "Open Morning class" }));
    expect(bindings.onOpenRoom).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText("Actions for Morning class"));
    expect(screen.getByRole("menuitem", { name: "Copy student link" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "View results" })).not.toBeInTheDocument();
  });

  it("offers View results and Duplicate setup for a finished room, opening a prefilled create form", () => {
    const bindings = session({ "sched-a": { phase: "finished", timingModel: null, joined: 12 } });
    renderDashboard([link("a", "Morning class")], { session: bindings });
    fireEvent.click(screen.getByLabelText("Actions for Morning class"));
    fireEvent.click(screen.getByRole("menuitem", { name: "View results" }));
    expect(bindings.onOpenResults).toHaveBeenCalledWith("sched-a");

    fireEvent.click(screen.getByLabelText("Actions for Morning class"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Duplicate setup" }));
    expect(screen.getByRole("dialog", { name: "Create room" })).toBeInTheDocument();
    expect(screen.getByTestId("flow-prefill")).toHaveTextContent("Morning class");
  });

  it("resumes a paused room in its room, not from the list", () => {
    const bindings = session({ "sched-a": { phase: "paused", timingModel: null, joined: 12 } });
    renderDashboard([link("a", "Morning class")], { session: bindings });
    expect(screen.queryByRole("button", { name: "Resume exam" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open Morning class" }));
    expect(bindings.onOpenRoom).toHaveBeenCalledWith("sched-a");
  });

  it("keeps a cancelled room distinct from a finished one", () => {
    renderDashboard([link("a", "Morning class")], { session: session({ "sched-a": { phase: "cancelled", timingModel: null, joined: 12 } }) });
    const closed = screen.getByText("Closed rooms (1)").closest("details")!;
    expect(within(closed).getByRole("button", { name: "Open Morning class" })).toHaveTextContent("Cancelled");
    expect(screen.queryByRole("region", { name: /Finished/ })).not.toBeInTheDocument();
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

  it("lists rooms from earlier releases with their version", () => {
    renderDashboard([link("old", "Old class", { publishedVersionId: "v-2", versionNumber: 2 })]);
    expect(screen.getByRole("button", { name: "Open Old class" })).toHaveTextContent("Version 2");
  });

  it("offers earlier rooms inside the create form and reopens it prefilled", async () => {
    renderDashboard([link("a", "Morning class")], { createRequest: { id: 9 } });
    await screen.findByRole("dialog", { name: "Create room" });
    expect(mocks.flowProps?.reuseOptions?.map((option) => option.name)).toEqual(["Morning class"]);
    act(() => mocks.flowProps?.onReuseSetup?.(link("a", "Morning class")));
    expect(screen.getByTestId("flow-prefill")).toHaveTextContent("Morning class");
  });

  it("marks the room the viewer came back from as last opened", () => {
    renderDashboard([link("a", "Morning class"), link("b", "Evening class")], { highlightLinkId: "b" });
    expect(screen.getByRole("button", { name: "Open Evening class (last opened)" })).toHaveFocus();
    expect(screen.getByRole("button", { name: "Open Morning class" })).not.toHaveTextContent("Last opened");
  });

});
