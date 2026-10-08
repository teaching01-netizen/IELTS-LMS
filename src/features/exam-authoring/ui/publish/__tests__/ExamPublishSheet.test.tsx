import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExamEntity } from "../../../../../types/domain";
import type {
  AssessmentAuthoringShell,
  AssessmentValidationIssue,
  AssessmentValidationReport,
  SatPublishScope,
} from "../../../contracts/assessment";
import type { AssessmentReleaseState } from "../../../contracts/release";

const state = vi.hoisted(() => ({
  exam: null as unknown,
  publish: vi.fn(),
  setPublishScope: vi.fn(),
  refetchReadiness: vi.fn(),
  hook: {} as Record<string, unknown>,
  reportDirty: (_count: number) => undefined as void,
}));

vi.mock("../../../api/examQueries", () => ({
  useExamQuery: () => ({ data: state.exam, error: null, refetch: vi.fn() }),
}));
vi.mock("../useSatPublish", () => ({
  useSatPublish: () => state.hook,
}));
vi.mock("../../settings/DeliverySettingsPanel", () => ({
  DeliverySettingsPanel: ({ onDirtyCountChange }: { onDirtyCountChange?: (count: number) => void }) => {
    state.reportDirty = (count) => onDirtyCountChange?.(count);
    return <div data-testid="settings-panel">editors</div>;
  },
}));

import { ExamPublishSheet } from "../ExamPublishSheet";

const exam: ExamEntity = {
  id: "exam-1",
  slug: "s",
  title: "Practice Test 06",
  providerKey: "sat",
  providerExamType: "sat",
  type: "Academic",
  status: "draft",
  visibility: "organization",
  owner: "u",
  createdAt: "2026-08-28T00:00:00.000Z",
  updatedAt: "2026-08-28T00:00:00.000Z",
  currentDraftVersionId: "v1",
  currentPublishedVersionId: null,
  canEdit: true,
  canPublish: true,
  canDelete: true,
  revision: 7,
  schemaVersion: 4,
};
const shell = {
  examId: "exam-1",
  providerKey: "sat",
  versionId: "v1",
  versionRevision: 12,
  sections: [
    {
      id: "s-rw",
      sectionKey: "reading-writing",
      title: "Reading & Writing",
      displayOrder: 0,
      durationSeconds: 3840,
      breakAfterSeconds: 600,
      revision: 1,
      routingPolicy: null,
      modules: [],
    },
    {
      id: "s-m",
      sectionKey: "math",
      title: "Math",
      displayOrder: 1,
      durationSeconds: 4200,
      breakAfterSeconds: 0,
      revision: 1,
      routingPolicy: null,
      modules: [],
    },
  ],
} as unknown as AssessmentAuthoringShell;
const release = (overrides: Partial<AssessmentReleaseState> = {}): AssessmentReleaseState => ({
  examId: "exam-1",
  providerKey: "sat",
  state: "never_published",
  currentPublishedVersion: null,
  workingDraft: { id: "v1", parentVersionId: null, versionNumber: 1, revision: 12 },
  summary: { candidateDurationSeconds: 0, authoredQuestionCount: 0, deliveredQuestionCount: 0 },
  access: { totalLinks: 0, liveLinks: 0, upcomingLinks: 0, linksOnCurrentRelease: 0, liveLinksOnPreviousReleases: 0 },
  ...overrides,
});
const report = (errors: AssessmentValidationIssue[] = []): AssessmentValidationReport => ({
  examId: "exam-1",
  versionId: "v1",
  versionRevision: 12,
  publishScope: "full",
  valid: errors.length === 0,
  errors,
  warnings: [],
});
const blocker: AssessmentValidationIssue = {
  code: "question.prompt.required",
  path: "examQuestion:q-17:prompt",
  message: "Question text is required.",
  blocking: true,
};

function setHook(overrides: Record<string, unknown> = {}) {
  state.hook = {
    shell,
    shellLoadError: null,
    releaseState: release(),
    readinessQuery: { data: report(), isFetching: false, error: null, refetch: state.refetchReadiness },
    publishScope: "full" as SatPublishScope,
    setPublishScope: state.setPublishScope,
    isPublishing: false,
    publishError: null,
    draftBusy: false,
    publish: state.publish,
    ...overrides,
  };
}

function renderSheet(handlers: Partial<Parameters<typeof ExamPublishSheet>[0]> = {}) {
  const props = {
    examId: "exam-1",
    open: true,
    onClose: vi.fn(),
    onOpenIssue: vi.fn(),
    onOpenStudentAccess: vi.fn(),
    onOpenSettings: vi.fn(),
    ...handlers,
  };
  return { props, ...render(<ExamPublishSheet {...props} />) };
}

beforeEach(() => {
  state.exam = exam;
  state.publish.mockReset();
  state.publish.mockResolvedValue({ versionId: "pv-3", versionNumber: 3, publishScope: "full" });
  state.setPublishScope.mockReset();
  state.refetchReadiness.mockReset();
  setHook();
});

describe("ExamPublishSheet", () => {
  it("publishes the chosen scope with trimmed notes once every check has passed", async () => {
    renderSheet();
    expect(screen.getByText("All checks passed.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Publish notes/), { target: { value: "  Fixed Module 2  " } });
    fireEvent.click(screen.getByRole("button", { name: "Publish Full SAT" }));
    await waitFor(() => expect(state.publish).toHaveBeenCalledWith("full", "Fixed Module 2"));
  });

  it("lists blocking issues with a Fix action and refuses to publish", () => {
    setHook({ readinessQuery: { data: report([blocker]), isFetching: false, error: null, refetch: state.refetchReadiness } });
    const { props } = renderSheet();
    expect(screen.getByText("1 issue to fix before publishing")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Publish Full SAT" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Fix" }));
    expect(props.onOpenIssue).toHaveBeenCalledWith(blocker);
    expect(props.onClose).toHaveBeenCalledOnce();
    expect(state.publish).not.toHaveBeenCalled();
  });

  it("will not publish on stale checks and offers to re-run them", () => {
    setHook({
      readinessQuery: {
        data: { ...report(), versionRevision: 11 },
        isFetching: false,
        error: null,
        refetch: state.refetchReadiness,
      },
    });
    renderSheet();
    expect(screen.getByText(/checks are out of date/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Publish Full SAT" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Run checks" }));
    expect(state.refetchReadiness).toHaveBeenCalledOnce();
  });

  it("waits while the latest changes are still being saved", () => {
    setHook({ draftBusy: true });
    renderSheet();
    expect(screen.getByRole("button", { name: "Publish Full SAT" })).toBeDisabled();
    expect(screen.getByText("Your latest changes are still being saved")).toBeInTheDocument();
  });

  it("blocks publishing for someone without publish permission and says why", () => {
    state.exam = { ...exam, canPublish: false };
    renderSheet();
    expect(screen.getByRole("button", { name: "Publish Full SAT" })).toBeDisabled();
    expect(screen.getByText(/do not have permission to publish/)).toBeInTheDocument();
  });

  it("lets the author change scope and shows only the included sections", () => {
    setHook({ publishScope: "math" as SatPublishScope });
    renderSheet();
    fireEvent.click(screen.getByRole("radio", { name: "Reading & Writing" }));
    expect(state.setPublishScope).toHaveBeenCalledWith("reading-writing");
    const included = screen.getByLabelText("Included content");
    expect(included).toHaveTextContent("Math");
    expect(included).not.toHaveTextContent("Reading & Writing");
  });

  it("sends timing edits to Settings instead of editing them inline", () => {
    const { props } = renderSheet();
    fireEvent.click(screen.getByRole("button", { name: /Edit timing and routing in Settings/ }));
    expect(props.onClose).toHaveBeenCalledOnce();
    expect(props.onOpenSettings).toHaveBeenCalledOnce();
  });

  it("shows a user-safe failure and keeps the sheet open for a retry", async () => {
    state.publish.mockRejectedValueOnce(new Error("publish 500 <html>internal stack</html>"));
    const { props } = renderSheet();
    fireEvent.click(screen.getByRole("button", { name: "Publish Full SAT" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/could not be published/i);
    expect(screen.queryByText(/internal stack/)).not.toBeInTheDocument();
    expect(props.onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Publish Full SAT" })).toBeEnabled();
  });

  it("submits only once on a double click", async () => {
    state.publish.mockImplementation(() => new Promise(() => undefined));
    renderSheet();
    const button = screen.getByRole("button", { name: "Publish Full SAT" });
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => expect(state.publish).toHaveBeenCalledTimes(1));
  });

  it("after publishing, makes session creation the next step for the exact version published", async () => {
    const { props, rerender } = renderSheet();
    fireEvent.click(screen.getByRole("button", { name: "Publish Full SAT" }));
    await waitFor(() => expect(state.publish).toHaveBeenCalled());
    setHook({
      releaseState: release({
        state: "published_current",
        currentPublishedVersion: {
          id: "pv",
          versionNumber: 3,
          revision: 1,
          publishNotes: null,
          publishScope: "full",
          publishedAt: "2026-09-01T00:00:00.000Z",
        },
      }),
    });
    rerender(<ExamPublishSheet {...props} />);
    expect(await screen.findByText("Version 3 is published and ready to use in a session.")).toBeInTheDocument();
    expect(screen.getByText(/Existing sessions continue using their current version/)).toBeInTheDocument();
    // Three connected steps, with step 2 marked as the next one.
    const steps = within(screen.getByRole("list", { name: "Setup progress" }));
    expect(steps.getByText(/1\. Publish/)).toHaveTextContent("✓");
    expect(steps.getByText(/2\. Create session/).closest("li")).toHaveAttribute("aria-current", "step");
    // Publishing alone opens access to nobody and navigates nowhere.
    expect(props.onOpenStudentAccess).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Create session" }));
    // The form opens for the exact version this publish returned, not "whatever is current".
    expect(props.onOpenStudentAccess).toHaveBeenCalledWith({ versionId: "pv-3", versionNumber: 3, publishScope: "full" });
    expect(props.onClose).toHaveBeenCalled();
  });

  it("offers only Create session and Done after publishing, even when sessions already exist", async () => {
    const { props, rerender } = renderSheet();
    fireEvent.click(screen.getByRole("button", { name: "Publish Full SAT" }));
    await waitFor(() => expect(state.publish).toHaveBeenCalled());
    setHook({
      releaseState: release({
        state: "published_current",
        currentPublishedVersion: { id: "pv-3", versionNumber: 3, revision: 1, publishNotes: null, publishScope: "full", publishedAt: "2026-09-01T00:00:00.000Z" },
        access: { totalLinks: 2, liveLinks: 1, upcomingLinks: 0, linksOnCurrentRelease: 0, liveLinksOnPreviousReleases: 1 },
      }),
    });
    rerender(<ExamPublishSheet {...props} />);
    expect(await screen.findByRole("button", { name: "Create session" })).toBeInTheDocument();
    // Reusing an earlier setup belongs to session creation, not to a second branch here.
    expect(screen.queryByRole("button", { name: "Use an existing setup" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(props.onClose).toHaveBeenCalled();
    expect(props.onOpenStudentAccess).not.toHaveBeenCalled();
  });

  describe("editing timing without leaving the sheet", () => {
    function openInline() {
      const view = renderSheet({ onOpenSettings: undefined });
      fireEvent.click(screen.getByRole("button", { name: "Edit timing and routing" }));
      return view;
    }

    it("swaps to the settings editors inside the same sheet, with no navigation", () => {
      const { props } = openInline();
      expect(screen.getByRole("dialog", { name: "Exam settings" })).toBeInTheDocument();
      expect(screen.getByTestId("settings-panel")).toBeInTheDocument();
      expect(props.onClose).not.toHaveBeenCalled();
      expect(screen.queryByRole("button", { name: /Publish Full SAT/ })).not.toBeInTheDocument();
    });

    it("returns to publishing and re-runs the checks against the revised draft", () => {
      openInline();
      fireEvent.click(screen.getByRole("button", { name: "Back to publish" }));
      expect(screen.getByRole("dialog", { name: "Publish exam" })).toBeInTheDocument();
      expect(state.refetchReadiness).toHaveBeenCalledOnce();
    });

    it("holds the author on the editors until unsaved changes are saved", () => {
      openInline();
      act(() => state.reportDirty(1));
      expect(screen.getByRole("button", { name: "Back to publish" })).toBeDisabled();
      expect(screen.getByText("Save your changes to return to publishing.")).toBeInTheDocument();
      act(() => state.reportDirty(0));
      expect(screen.getByRole("button", { name: "Back to publish" })).toBeEnabled();
    });

    it("asks before closing the sheet over unsaved timing changes", () => {
      const { props } = openInline();
      act(() => state.reportDirty(1));
      fireEvent.keyDown(screen.getByRole("dialog", { name: "Exam settings" }), { key: "Escape" });
      expect(props.onClose).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
      expect(props.onClose).toHaveBeenCalledOnce();
    });
  });
});
