import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExamEntity } from "../../../../../types/domain";
import type { AccessDistributionOverview, AssessmentAccessLink } from "../../../contracts/accessLinks";
import type { AccessSessionBindings, AccessSessionInfo } from "../../delivery/sessionState";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  editorProps: null as null | {
    prefill?: { name: string } | null;
    targetVersionNumber?: number | null;
    publishScope?: string;
    reuseOptions?: ReadonlyArray<{ name: string }>;
    onReuseSetup?: (link: AssessmentAccessLink) => void;
    onCreate: (request: Record<string, unknown>) => Promise<void>;
  },
}));

vi.mock("../../../realtime/coedit", () => ({
  useSatAuthoringCollaboration: () => null,
}));
vi.mock("../../../api/assessmentAccessLinkQueries", () => ({
  useCreateAccessLink: () => ({ mutateAsync: mocks.create, isPending: false }),
  useUpdateAccessLink: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useSetAccessLinkLifecycle: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteAccessLink: () => ({ mutateAsync: vi.fn(), isPending: false, variables: undefined }),
  useDuplicateAccessLink: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useAccessLinkMembers: () => ({ data: [], isLoading: false }),
  useAccessLinkActivity: () => ({ data: [], isLoading: false }),
}));
vi.mock("../AccessLinkEditorSheet", () => ({
  AccessLinkEditorSheet: (props: NonNullable<typeof mocks.editorProps> & { open: boolean }) => {
    mocks.editorProps = props;
    return props.open ? (
      <div role="dialog" aria-label="Student link editor">
        <p data-testid="editor-target">Version {props.targetVersionNumber}</p>
        <p data-testid="editor-prefill">{props.prefill?.name ?? "none"}</p>
        <button type="button" onClick={() => void props.onCreate({ name: "New group" })}>
          Submit form
        </button>
      </div>
    ) : null;
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

const shell = { lifecycle: { label: "Published · Version 3", detail: null, tone: "published" as const }, showResponses: true, onSelectTab: vi.fn(), onBack: vi.fn(), onPreview: vi.fn() };

function session(infos: Record<string, AccessSessionInfo>, over: Partial<AccessSessionBindings> = {}): AccessSessionBindings {
  return {
    canRun: true,
    infoFor: (scheduleId) => infos[scheduleId] ?? null,
    stale: false,
    refreshing: false,
    onRefresh: vi.fn(),
    onStart: vi.fn().mockResolvedValue(undefined),
    onResume: vi.fn().mockResolvedValue(undefined),
    onOpenRoom: vi.fn(),
    onOpenResponses: vi.fn(),
    ...over,
  };
}

function renderDashboard(links: AssessmentAccessLink[], extra: { createRequest?: CreateRequest | null; session?: AccessSessionBindings } = {}) {
  return render(
    <StudentLinksDashboard
      exam={exam}
      overview={overviewWith(links)}
      isLoading={false}
      error={null}
      onRefresh={vi.fn()}
      onBackToRelease={vi.fn()}
      shell={shell}
      {...(extra.createRequest !== undefined ? { createRequest: extra.createRequest } : {})}
      {...(extra.session ? { session: extra.session } : {})}
    />,
  );
}

const READY: AccessSessionInfo = { phase: "ready", timingModel: "sat_personal_v1", joined: 12 };

beforeEach(() => {
  mocks.create.mockReset();
  mocks.editorProps = null;
});

describe("Delivery: first-time setup", () => {
  it("leads a new exam with a three-step guide and a single obvious next action", () => {
    renderDashboard([]);
    const steps = within(screen.getByRole("list", { name: "Session setup steps" }));
    expect(steps.getByText("Publish").closest("li")).not.toHaveAttribute("aria-current");
    expect(steps.getByText("Create session").closest("li")).toHaveAttribute("aria-current", "step");
    fireEvent.click(within(screen.getByRole("region", { name: "Set up a session" })).getByRole("button", { name: "Create session" }));
    expect(screen.getByRole("dialog", { name: "Student link editor" })).toBeInTheDocument();
  });

  it("collapses the guide once access exists, but keeps it reopenable", () => {
    renderDashboard([link("a", "Morning class")]);
    expect(screen.queryByRole("region", { name: "Set up a session" })).not.toBeInTheDocument();
    const guide = screen.getByText("Setup guide").closest("details");
    expect(guide).not.toHaveAttribute("open");
  });

  it("opens the create form straight away for a publish request and pins the exact published version", async () => {
    mocks.create.mockResolvedValue(link("new", "New group"));
    renderDashboard([link("new", "New group")], {
      createRequest: { id: 1, versionId: "v-4", versionNumber: 4, publishScope: "math" },
    });
    expect(await screen.findByRole("dialog", { name: "Student link editor" })).toBeInTheDocument();
    // The form states its target version and scope; nothing is implicit.
    expect(screen.getByTestId("editor-target")).toHaveTextContent("Version 4");
    expect(mocks.editorProps?.publishScope).toBe("math");

    fireEvent.click(screen.getByRole("button", { name: "Submit form" }));
    await waitFor(() => expect(mocks.create).toHaveBeenCalled());
    // Even though Version 3 is current, the group is created on the version the author just published.
    expect(mocks.create).toHaveBeenCalledWith({ name: "New group", publishedVersionId: "v-4" });
  });

  it("opens the form once per request, not again on every re-render", async () => {
    const request: CreateRequest = { id: 7 };
    const view = renderDashboard([link("a", "Morning class")], { createRequest: request });
    expect(await screen.findByRole("dialog", { name: "Student link editor" })).toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: "Escape" });
    act(() => mocks.editorProps?.["onClose" as never]?.());
    view.rerender(
      <StudentLinksDashboard exam={exam} overview={overviewWith([link("a", "Morning class")])} isLoading={false} error={null} onRefresh={vi.fn()} onBackToRelease={vi.fn()} shell={shell} createRequest={request} />,
    );
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Student link editor" })).not.toBeInTheDocument());
  });

  it("continues from creation into Share and run, and lets the author finish later", async () => {
    mocks.create.mockResolvedValue(link("new", "New group"));
    const bindings = session({ "sched-new": READY });
    renderDashboard([link("new", "New group")], { createRequest: { id: 1 }, session: bindings });
    fireEvent.click(await screen.findByRole("button", { name: "Submit form" }));
    const panel = within(await screen.findByRole("region", { name: "Session" }));
    const next = await panel.findByText("Session created");
    expect(next.closest("[role=status]")).toHaveTextContent("Copying is optional");
    // Staff who can run sessions are taken straight to the new session's waiting room.
    expect(bindings.onOpenRoom).toHaveBeenCalledWith("sched-new");
    // Starting is offered right there; copying is not a prerequisite.
    expect(screen.getByRole("button", { name: "Start session" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(within(screen.getByRole("region", { name: "Session" })).queryByText("Session created")).not.toBeInTheDocument();
  });

  it("keeps staff who cannot run sessions on the page after creating one", async () => {
    mocks.create.mockResolvedValue(link("new", "New group"));
    const bindings = session({ "sched-new": READY }, { canRun: false });
    renderDashboard([link("new", "New group")], { createRequest: { id: 1 }, session: bindings });
    fireEvent.click(await screen.findByRole("button", { name: "Submit form" }));
    await waitFor(() => expect(mocks.create).toHaveBeenCalled());
    expect(bindings.onOpenRoom).not.toHaveBeenCalled();
  });
});

describe("Delivery: running a group", () => {
  it("shows entry and session separately on the row and in the panel", () => {
    renderDashboard([link("a", "Morning class", { status: "paused" })], { session: session({ "sched-a": { phase: "live", timingModel: null, joined: 12 } }) });
    expect(screen.getByRole("button", { name: "Open Morning class" })).toHaveTextContent("Session: Running");
    const panel = within(screen.getByRole("region", { name: "Session" }));
    // Pausing check-in must not read as pausing the running exam.
    expect(panel.getByText("Check-in paused · Exam running")).toBeInTheDocument();
    expect(panel.getByRole("button", { name: "Open live session" })).toBeInTheDocument();
  });

  it("reviews the scoped start, explains the stored timing model, and opens that group's room on success", async () => {
    const bindings = session({ "sched-a": READY });
    renderDashboard([link("a", "Morning class"), link("b", "Evening class")], { session: bindings });
    fireEvent.click(screen.getByRole("button", { name: "Start session" }));
    const dialog = await screen.findByRole("dialog", { name: "Start Morning class?" });
    expect(dialog).toHaveTextContent("Version 3");
    expect(within(dialog).getByText("12")).toBeInTheDocument();
    expect(dialog).toHaveTextContent("Personal timing");
    expect(bindings.onStart).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("button", { name: "Start and open session" }));
    await waitFor(() => expect(bindings.onStart).toHaveBeenCalledWith("sched-a"));
    await waitFor(() => expect(bindings.onOpenRoom).toHaveBeenCalledWith("sched-a"));
    expect(bindings.onStart).toHaveBeenCalledTimes(1);
  });

  it("keeps the review open with a retryable error when the start is refused", async () => {
    const bindings = session({ "sched-a": READY }, { onStart: vi.fn().mockRejectedValueOnce(new Error("Another session is running")).mockResolvedValue(undefined) });
    renderDashboard([link("a", "Morning class")], { session: bindings });
    fireEvent.click(screen.getByRole("button", { name: "Start session" }));
    const dialog = await screen.findByRole("dialog", { name: "Start Morning class?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Start and open session" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Another session is running");
    expect(bindings.onOpenRoom).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Start and open session" }));
    await waitFor(() => expect(bindings.onOpenRoom).toHaveBeenCalledWith("sched-a"));
  });

  it("offers Refresh status instead of guessing when session state is stale", () => {
    const bindings = session({}, { stale: true });
    renderDashboard([link("a", "Morning class")], { session: bindings });
    expect(screen.queryByRole("button", { name: "Start session" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Refresh status" }));
    expect(bindings.onRefresh).toHaveBeenCalledOnce();
    expect(screen.getByText(/could not be refreshed/i)).toBeInTheDocument();
  });

  it("hides session actions for roles that cannot open the session room", () => {
    renderDashboard([link("a", "Morning class")], { session: session({ "sched-a": READY }, { canRun: false }) });
    expect(screen.queryByRole("button", { name: "Start session" })).not.toBeInTheDocument();
    expect(screen.getByText(/available to administrators/i)).toBeInTheDocument();
    // Sharing still works for them.
    expect(screen.getByRole("button", { name: "Copy link" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open Morning class" })).not.toHaveTextContent("Session:");
  });

  it("turns a finished session into View responses with Duplicate setup, opening a prefilled form", () => {
    const bindings = session({ "sched-a": { phase: "finished", timingModel: null, joined: 12 } });
    renderDashboard([link("a", "Morning class")], { session: bindings });
    expect(screen.getByRole("button", { name: "View responses" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "View responses" }));
    expect(bindings.onOpenResponses).toHaveBeenCalledWith("sched-a");

    fireEvent.click(screen.getByRole("button", { name: "Duplicate setup" }));
    expect(screen.getByRole("dialog", { name: "Student link editor" })).toBeInTheDocument();
    expect(screen.getByTestId("editor-prefill")).toHaveTextContent("Morning class");
    expect(screen.getByTestId("editor-target")).toHaveTextContent("Version 3");
  });

  it("resumes a paused session directly", async () => {
    const bindings = session({ "sched-a": { phase: "paused", timingModel: null, joined: 12 } });
    renderDashboard([link("a", "Morning class")], { session: bindings });
    fireEvent.click(screen.getByRole("button", { name: "Resume exam" }));
    await waitFor(() => expect(bindings.onResume).toHaveBeenCalledWith("sched-a"));
  });
});


describe("Delivery continuity and action safety", () => {
  it("keeps workspace navigation before publishing and opens Publish in place", () => {
    const onPublish = vi.fn();
    render(<StudentLinksDashboard exam={exam} overview={{ currentPublishedVersion: null, links: [] }} isLoading={false} error={null} onRefresh={vi.fn()} onBackToRelease={vi.fn()} shell={{ ...shell, onPublish }} />);
    expect(screen.getByRole("navigation", { name: "Exam sections" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Publish exam" }));
    expect(onPublish).toHaveBeenCalledOnce();
    expect(screen.queryByText("Return to Release")).not.toBeInTheDocument();
  });

  it("does not mark Version 3 access configured just because Version 2 has a group", () => {
    renderDashboard([link("old", "Old class", { publishedVersionId: "v-2", versionNumber: 2 })]);
    expect(screen.getByRole("region", { name: "Set up a session" })).toHaveTextContent("Version 3 has no session yet");
  });

  it("preserves the reviewed group when arrow keys are pressed inside Start review", async () => {
    const bindings = session({ "sched-a": READY, "sched-b": READY });
    renderDashboard([link("a", "Morning class"), link("b", "Evening class")], { session: bindings });
    fireEvent.click(screen.getByRole("button", { name: "Start session" }));
    const dialog = screen.getByRole("dialog", { name: "Start Morning class?" });
    fireEvent.keyDown(within(dialog).getByRole("button", { name: "Cancel" }), { key: "ArrowDown" });
    expect(screen.getByRole("dialog", { name: "Start Morning class?" })).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Start and open session" }));
    await waitFor(() => expect(bindings.onStart).toHaveBeenCalledWith("sched-a"));
  });

  it("disables an open Start review when its status read fails", () => {
    const group = link("a", "Morning class");
    const bindings = session({ "sched-a": READY });
    const view = renderDashboard([group], { session: bindings });
    fireEvent.click(screen.getByRole("button", { name: "Start session" }));
    view.rerender(<StudentLinksDashboard exam={exam} overview={overviewWith([group])} isLoading={false} error={null} onRefresh={vi.fn()} onBackToRelease={vi.fn()} shell={shell} session={{ ...bindings, stale: true }} />);
    const dialog = screen.getByRole("dialog", { name: "Start Morning class?" });
    expect(within(dialog).getByRole("button", { name: "Start and open session" })).toBeDisabled();
    expect(bindings.onStart).not.toHaveBeenCalled();
  });

  it("pins ordinary new groups to the version displayed when the form opens", async () => {
    mocks.create.mockResolvedValue(link("new", "New group"));
    const view = renderDashboard([link("a", "Morning class")]);
    fireEvent.click(screen.getByRole("button", { name: "Create session" }));
    view.rerender(<StudentLinksDashboard exam={exam} overview={{ currentPublishedVersion: { ...version, id: "v-4", versionNumber: 4 }, links: [link("a", "Morning class")] }} isLoading={false} error={null} onRefresh={vi.fn()} onBackToRelease={vi.fn()} shell={shell} />);
    expect(screen.getByTestId("editor-target")).toHaveTextContent("Version 3");
    fireEvent.click(screen.getByRole("button", { name: "Submit form" }));
    await waitFor(() => expect(mocks.create).toHaveBeenCalledWith({ name: "New group", publishedVersionId: "v-3" }));
  });

  it("offers earlier sessions inside the create form, keeping the exact newly published version", async () => {
    renderDashboard([link("a", "Morning class")], { createRequest: { id: 9, versionId: "v-4", versionNumber: 4, publishScope: "math" } });
    await screen.findByRole("dialog", { name: "Student link editor" });
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.editorProps?.reuseOptions?.map((option) => option.name)).toEqual(["Morning class"]);
    act(() => mocks.editorProps?.onReuseSetup?.(link("a", "Morning class")));
    expect(screen.getByTestId("editor-prefill")).toHaveTextContent("Morning class");
    expect(screen.getByTestId("editor-target")).toHaveTextContent("Version 4");
    expect(mocks.editorProps?.publishScope).toBe("math");
  });

  it("restores the requested access group and reports a newly selected group", () => {
    const onSelectionChange = vi.fn();
    render(<StudentLinksDashboard exam={exam} overview={overviewWith([link("a", "Morning class"), link("b", "Evening class")])} isLoading={false} error={null} onRefresh={vi.fn()} onBackToRelease={vi.fn()} shell={shell} selectedLinkId="b" onSelectionChange={onSelectionChange} />);
    expect(screen.getByRole("button", { name: "Open Evening class" })).toHaveAttribute("aria-current", "true");
    fireEvent.click(screen.getByRole("button", { name: "Open Morning class" }));
    expect(onSelectionChange).toHaveBeenCalledWith("a");
  });
});
