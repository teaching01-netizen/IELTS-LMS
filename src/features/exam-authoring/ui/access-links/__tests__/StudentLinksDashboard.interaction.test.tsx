import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useEffect, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExamEntity } from "../../../../../types/domain";
import type { AccessDistributionOverview, AssessmentAccessLink } from "../../../contracts/accessLinks";
import { StudentLinksDashboard } from "../StudentLinksDashboard";

/**
 * AT-06/07/08/09/10/12/13/17/19 — the Student Access page's interaction
 * contract, asserted at the orchestration layer.
 *
 * The rules under test:
 *   - a write in flight is announced on ITS OWN row and settles there,
 *   - acknowledgement happens where the action happened (never in a channel
 *     that is not mounted),
 *   - failures surface once, with the stale-revision path intact,
 *   - typing echoes in the same keystroke for a normal-size link library,
 *   - keyboard selection follows the eye, and Escape hands focus back.
 */
const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
  lifecycle: vi.fn(),
  duplicate: vi.fn(),
  lifecyclePending: false,
  lifecycleVariables: undefined as unknown,
  duplicatePending: false,
  duplicateVariables: undefined as unknown,
}));

vi.mock("../../../api/assessmentAccessLinkQueries", () => ({
  useCreateAccessLink: () => ({ mutateAsync: mocks.create, isPending: false, variables: undefined }),
  useUpdateAccessLink: () => ({ mutateAsync: mocks.update, isPending: false, variables: undefined }),
  useSetAccessLinkLifecycle: () => ({
    mutateAsync: mocks.lifecycle,
    isPending: mocks.lifecyclePending,
    variables: mocks.lifecycleVariables,
  }),
  useDuplicateAccessLink: () => ({
    mutateAsync: mocks.duplicate,
    isPending: mocks.duplicatePending,
    variables: mocks.duplicateVariables,
  }),
  useAccessLinkMembers: () => ({ data: [], isLoading: false }),
  useAccessLinkActivity: () => ({ data: [], isLoading: false }),
}));

vi.mock("../AccessLinkEditorSheet", () => ({
  AccessLinkEditorSheet: ({ open }: { open: boolean }) => (open ? <div data-testid="link-editor">editor</div> : null),
}));
vi.mock("../AccessLinkShareSheet", () => ({
  AccessLinkShareSheet: () => null,
  AccessLinkPresentView: () => null,
}));

const exam: ExamEntity = {
  id: "exam-1",
  slug: "sat",
  title: "Digital SAT",
  providerKey: "sat",
  providerExamType: "sat",
  type: "Academic",
  status: "published",
  visibility: "organization",
  owner: "builder-1",
  createdAt: "2026-08-20T00:00:00Z",
  updatedAt: "2026-08-28T00:00:00Z",
  currentDraftVersionId: "draft-5",
  currentPublishedVersionId: "version-5",
  canEdit: true,
  canPublish: true,
  canDelete: true,
  revision: 7,
  schemaVersion: 4,
};

function link(id: string, name: string, status: AssessmentAccessLink["status"]): AssessmentAccessLink {
  return {
    id,
    examId: exam.id,
    examTitle: exam.title,
    providerKey: "sat",
    publishedVersionId: "version-5",
    versionNumber: 5,
    scheduleId: `schedule-${id}`,
    name,
    audienceType: "cohort",
    audienceLabel: name,
    accessMode: "student_code",
    availabilityType: "anytime",
    opensAt: null,
    closesAt: null,
    lifecycleState: status === "paused" ? "paused" : "active",
    status,
    selectedStudentCount: 0,
    metrics: { registered: 10, started: 8, submitted: 4 },
    isCurrentRelease: true,
    hasParticipation: true,
    revision: 3,
    createdAt: "2026-08-28T00:00:00Z",
    updatedAt: "2026-08-28T00:00:00Z",
  };
}

const overview: AccessDistributionOverview = {
  currentPublishedVersion: {
    id: "version-5",
    versionNumber: 5,
    revision: 1,
    publishNotes: null,
    createdAt: "2026-08-28T00:00:00Z",
  },
  links: [link("link-current", "Saturday Class", "live"), link("link-monday", "Monday Class", "live")],
};

// The dashboard re-renders when the mutation hook's state flips; the mock
// cannot push that itself, so the harness exposes a re-render handle the test
// drives — exactly the render TanStack performs when isPending becomes true.
let rerenderDashboard: (() => void) | null = null;

function DashboardHarness(props: { onRefresh: () => Promise<unknown> }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    rerenderDashboard = () => setTick((tick) => tick + 1);
    return () => {
      rerenderDashboard = null;
    };
  }, []);
  return (
    <StudentLinksDashboard
      exam={exam}
      overview={overview}
      isLoading={false}
      error={null}
      onRefresh={props.onRefresh}
      onBackToRelease={vi.fn()}
    />
  );
}

const flushPendingFlip = () => act(async () => { rerenderDashboard?.(); });

beforeEach(() => {
  mocks.create.mockReset();
  mocks.update.mockReset();
  mocks.lifecycle.mockReset();
  mocks.duplicate.mockReset();
  mocks.lifecyclePending = false;
  mocks.lifecycleVariables = undefined;
  mocks.duplicatePending = false;
  mocks.duplicateVariables = undefined;
  mocks.lifecycle.mockResolvedValue(overview.links[0]);
  mocks.duplicate.mockResolvedValue(overview.links[0]);
});

afterEach(() => {
  rerenderDashboard = null;
  vi.restoreAllMocks();
});

describe("StudentLinksDashboard interaction contract", () => {
  it("AT-07/08/09: a lifecycle write is acknowledged on its own row and settles in place", async () => {
    let resolveLifecycle: ((value: unknown) => void) | undefined;
    mocks.lifecycle.mockImplementation(
      () => new Promise((resolve) => { resolveLifecycle = resolve; }),
    );
    render(<DashboardHarness onRefresh={vi.fn()} />);

    fireEvent.click(screen.getByLabelText("Actions for Saturday Class"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Pause Link" }));
    await waitFor(() =>
      expect(mocks.lifecycle).toHaveBeenCalledWith({
        linkId: "link-current",
        request: { revision: 3, state: "paused" },
      }),
    );

    mocks.lifecyclePending = true;
    mocks.lifecycleVariables = { linkId: "link-current", request: { revision: 3, state: "paused" } };
    await flushPendingFlip();

    const pausedRow = screen.getByRole("button", { name: "Open Saturday Class" });
    expect(pausedRow).toHaveAttribute("aria-busy", "true");
    expect(screen.getByText("Pausing…")).toBeInTheDocument();
    expect(screen.getByTestId("access-link-pending-link-current")).toBeInTheDocument();
    // AT-09: pending is per link — the neighbour stays fully interactive.
    expect(screen.getByRole("button", { name: "Open Monday Class" })).not.toHaveAttribute("aria-busy");
    expect(screen.getByLabelText("Actions for Monday Class")).toBeInTheDocument();

    mocks.lifecyclePending = false;
    mocks.lifecycleVariables = undefined;
    await act(async () => { resolveLifecycle?.(overview.links[0]); });

    const settledRow = screen.getByRole("button", { name: "Open Saturday Class" });
    expect(settledRow).not.toHaveAttribute("aria-busy");
    // The settled acknowledgement lands on the row itself (plus the single
    // polite announcement for assistive tech).
    expect(settledRow).toHaveTextContent("Paused");
    expect(screen.getAllByText("Paused").length).toBeGreaterThan(0);
    // No refresh was needed to see the settled state.
    expect(mocks.lifecycle).toHaveBeenCalledTimes(1);
  });

  it("AT-12/13: a failed action surfaces one banner and keeps the stale-revision recovery", async () => {
    mocks.lifecycle.mockRejectedValue(new Error("revision conflict (409): this link changed elsewhere"));
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    render(<DashboardHarness onRefresh={onRefresh} />);

    fireEvent.click(screen.getByLabelText("Actions for Saturday Class"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Pause Link" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("This link changed elsewhere. Refresh and retry.");
    // AT-12: the banner enters through the shared fade, never a bare pop-in.
    expect(alert).toHaveClass("sat-banner-enter");
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    // The row did not stay stuck in its pending look.
    expect(screen.getByRole("button", { name: "Open Saturday Class" })).not.toHaveAttribute("aria-busy");

    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("AT-10: copying confirms at the control, at the row, and once for assistive tech", async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
    render(<DashboardHarness onRefresh={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Copy" }));

    expect(await screen.findByText("Copied")).toBeInTheDocument();
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining("/join/link-current"));
    expect(screen.getAllByText("Link copied").length).toBeGreaterThan(0);
    const announcement = screen.getAllByRole("status").find((node) => node.textContent === "Link copied");
    expect(announcement).toBeDefined();
  });

  it("AT-19: filtering echoes in the same keystroke for a normal-size library", () => {
    render(<DashboardHarness onRefresh={vi.fn()} />);
    expect(screen.getAllByText("Monday Class").length).toBeGreaterThan(0);

    fireEvent.change(screen.getByLabelText("Search Student Links"), { target: { value: "Monday" } });

    // No waitFor: the row set moved with the keystroke, not behind a timer.
    expect(screen.queryByText("Saturday Class")).not.toBeInTheDocument();
    expect(screen.getAllByText("Monday Class").length).toBeGreaterThan(0);
  });

  it("AT-06: arrow-key selection brings the newly selected row into view", async () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView as unknown as typeof Element.prototype.scrollIntoView;
    render(<DashboardHarness onRefresh={vi.fn()} />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Open Saturday Class" })).toHaveAttribute("aria-current", "true"),
    );

    fireEvent.keyDown(document.body, { key: "ArrowDown" });

    const mondayRow = screen.getByRole("button", { name: "Open Monday Class" });
    expect(mondayRow).toHaveAttribute("aria-current", "true");
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });
  });

  it("AT-17: Escape in the detail pane hands focus back to the selected row", async () => {
    render(<DashboardHarness onRefresh={vi.fn()} />);
    const saturdayRow = await screen.findByRole("button", { name: "Open Saturday Class" });
    expect(saturdayRow).toHaveAttribute("aria-current", "true");

    fireEvent.keyDown(screen.getByTestId("access-link-detail"), { key: "Escape" });

    expect(document.activeElement).toBe(saturdayRow);
  });
});
