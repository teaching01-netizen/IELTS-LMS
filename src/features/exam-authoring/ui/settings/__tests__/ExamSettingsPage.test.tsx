import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExamEntity } from "../../../../../types/domain";
import type { AssessmentAuthoringShell } from "../../../contracts/assessment";
import type { AuthoringShellState } from "../../../application/authoringShellLifecycle";

const mocks = vi.hoisted(() => ({
  update: { mutateAsync: vi.fn(), isPending: false },
  lifecycleState: { kind: "loading" } as unknown,
  refetch: vi.fn(),
  armDraftIntent: vi.fn(),
}));

vi.mock("../../../api/assessmentQueries", () => ({
  useUpdateSectionDeliverySettings: () => mocks.update,
  useAssessmentReleaseState: () => ({ data: null }),
}));
vi.mock("../../../application/authoringShellLifecycle", () => ({
  useAuthoringShellLifecycle: () => ({ state: mocks.lifecycleState, refetch: mocks.refetch }),
}));
vi.mock("../../../application/authoringEntryIntent", () => ({
  requestAuthoringDraftOnEntry: (examId: string) => mocks.armDraftIntent(examId),
}));
vi.mock("../../collaboration/CollaborationHeaderCluster", () => ({
  CollaborationHeaderCluster: () => null,
}));
vi.mock("../../publish/ExamPublishSheet", () => ({
  ExamPublishSheet: ({ onClose }: { onClose: () => void }) => (
    <div role="dialog" aria-label="Publish exam">
      <button type="button" onClick={onClose}>
        Close publish
      </button>
    </div>
  ),
}));
vi.mock("../../../../auth/api/authSession", () => ({
  useOptionalAuthSession: () => ({ session: { user: { id: "u1", role: "builder" } } }),
}));

import { ExamSettingsPage } from "../ExamSettingsPage";

const exam: ExamEntity = {
  id: "exam-sat-1",
  slug: "sat-settings-test",
  title: "Digital SAT Practice",
  providerKey: "sat",
  providerExamType: "sat",
  type: "Academic",
  status: "draft",
  visibility: "organization",
  owner: "builder-1",
  createdAt: "2026-08-28T00:00:00.000Z",
  updatedAt: "2026-08-28T00:00:00.000Z",
  currentDraftVersionId: "version-1",
  currentPublishedVersionId: null,
  canEdit: true,
  canPublish: true,
  canDelete: true,
  revision: 7,
  schemaVersion: 4,
};

function moduleShell(id: string, key: string, title: string, role: "base" | "lower_branch" | "higher_branch") {
  return {
    id,
    moduleKey: key,
    title,
    displayOrder: role === "base" ? 0 : role === "lower_branch" ? 1 : 2,
    durationSeconds: 32 * 60,
    targetQuestionCount: 27,
    adaptiveRole: role,
    toolPolicy: [],
    revision: 2,
    questions: [],
  };
}

const shell: AssessmentAuthoringShell = {
  examId: exam.id,
  providerKey: "sat",
  versionId: "version-1",
  versionRevision: 12,
  sections: [
    {
      id: "section-rw",
      sectionKey: "reading-writing",
      title: "Reading & Writing",
      displayOrder: 0,
      durationSeconds: 64 * 60,
      breakAfterSeconds: 10 * 60,
      revision: 3,
      routingPolicy: {
        id: "route-rw",
        baseModuleId: "rw-base",
        lowerModuleId: "rw-lower",
        higherModuleId: "rw-higher",
        policyKey: "practice_threshold",
        minimumCorrectForHigher: 18,
        operationalQuestionCount: 0,
        revision: 4,
      },
      modules: [
        moduleShell("rw-base", "rw-m1", "Module 1", "base"),
        moduleShell("rw-lower", "rw-m2-lower", "Module 2 — Lower", "lower_branch"),
        moduleShell("rw-higher", "rw-m2-higher", "Module 2 — Higher", "higher_branch"),
      ],
    },
  ],
};

function Where() {
  return <p data-testid="where">{useLocation().pathname}</p>;
}

function renderPage(entity: ExamEntity = exam) {
  return render(
    <MemoryRouter initialEntries={["/sat/exams/exam-sat-1/settings"]}>
      <Routes>
        <Route path="/sat/exams/:examId/settings" element={<ExamSettingsPage exam={entity} />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mocks.update.mutateAsync.mockReset();
  mocks.update.mutateAsync.mockResolvedValue(shell);
  mocks.update.isPending = false;
  mocks.refetch.mockReset();
  mocks.armDraftIntent.mockReset();
  mocks.lifecycleState = { kind: "ready", shell } satisfies AuthoringShellState;
});

describe("ExamSettingsPage", () => {
  it("marks Settings as the current tab inside the shared exam header", () => {
    renderPage();
    const tabs = screen.getByRole("navigation", { name: "Exam sections" });
    expect(within(tabs).getByRole("button", { name: "Settings" })).toHaveAttribute("aria-current", "page");
    expect(within(tabs).getByRole("button", { name: "Questions" })).not.toHaveAttribute("aria-current");
    // A builder is never offered the results tab.
    expect(within(tabs).queryByRole("button", { name: "Responses" })).not.toBeInTheDocument();
  });

  it("edits the threshold against the blueprint on threshold-only rows (stuck-at-1 regression)", async () => {
    // Real shells arrive with operationalQuestionCount: 0 (threshold-only
    // policy_config). The Higher-route field must still accept the RW
    // contract range instead of clamping every keystroke back to 1.
    renderPage();
    expect(screen.getByText(/25 operational questions/)).toBeInTheDocument();
    const threshold = screen.getByLabelText(/Higher route at/);
    fireEvent.change(threshold, { target: { value: "13" } });
    expect(threshold).toHaveValue(13);
    expect(screen.getByText("0–12")).toBeInTheDocument();
    expect(screen.getByText("13–25")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Save section" }));
    await waitFor(() =>
      expect(mocks.update.mutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({ request: expect.objectContaining({ minimumCorrectForHigher: 13 }) }),
      ),
    );
  });

  it("maps save conflicts to a user-safe alert", async () => {
    mocks.update.mutateAsync.mockRejectedValueOnce(new Error("revision conflict 409"));
    renderPage();
    fireEvent.change(screen.getByLabelText(/Module 1/), { target: { value: "33" } });
    fireEvent.click(screen.getByRole("button", { name: "Save section" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/draft changed/i);
  });

  it("explains read-only delivery settings and disables saving", () => {
    renderPage({ ...exam, canEdit: false });
    expect(screen.getByRole("button", { name: "Saved" })).toBeDisabled();
    expect(
      screen.getAllByText(/do not have permission to edit delivery settings/).length,
    ).toBeGreaterThanOrEqual(1);
  });

  it("protects unsaved timing when changing tabs, and leaves on confirmation", () => {
    renderPage();
    fireEvent.change(screen.getByLabelText(/Module 1/), { target: { value: "33" } });
    expect(screen.getByRole("button", { name: "Publish version" })).toBeDisabled();

    fireEvent.click(within(screen.getByRole("navigation", { name: "Exam sections" })).getByRole("button", { name: "Questions" }));
    expect(screen.getByRole("alertdialog", { name: "Leave with unsaved changes?" })).toBeInTheDocument();
    expect(screen.queryByTestId("where")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Leave without saving" }));
    expect(screen.getByTestId("where")).toHaveTextContent("/sat/exams/exam-sat-1");
  });

  it("navigates straight away when nothing is unsaved", () => {
    renderPage();
    fireEvent.click(within(screen.getByRole("navigation", { name: "Exam sections" })).getByRole("button", { name: "Rooms" }));
    expect(screen.getByTestId("where")).toHaveTextContent("/sat/exams/exam-sat-1/access");
  });

  it("opens the publish sheet over Settings", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Publish version" }));
    expect(screen.getByRole("dialog", { name: "Publish exam" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close publish" }));
    expect(screen.queryByRole("dialog", { name: "Publish exam" })).not.toBeInTheDocument();
  });

  it("offers an explicit Edit this exam action when only a published version exists", () => {
    mocks.lifecycleState = { kind: "no-draft" } satisfies AuthoringShellState;
    renderPage();
    expect(screen.getByText("This exam is published.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Edit this exam" }));
    // Only an explicit click arms the one-shot draft-open gesture.
    expect(mocks.armDraftIntent).toHaveBeenCalledWith("exam-sat-1");
    expect(screen.getByTestId("where")).toHaveTextContent("/sat/exams/exam-sat-1");
  });

  it("never creates a draft just by rendering the no-draft state", () => {
    mocks.lifecycleState = { kind: "no-draft" } satisfies AuthoringShellState;
    renderPage();
    expect(mocks.armDraftIntent).not.toHaveBeenCalled();
  });

  it("shows a retry for a failed draft read", () => {
    mocks.lifecycleState = { kind: "error", error: new Error("Server unavailable") } satisfies AuthoringShellState;
    renderPage();
    expect(screen.getByRole("alert")).toHaveTextContent("Server unavailable");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(mocks.refetch).toHaveBeenCalledOnce();
  });
});
