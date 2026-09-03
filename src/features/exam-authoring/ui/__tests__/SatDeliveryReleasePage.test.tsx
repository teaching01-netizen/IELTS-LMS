import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExamEntity } from "../../../../types/domain";
import type {
  AssessmentAuthoringShell,
  AssessmentValidationIssue,
  AssessmentValidationReport,
} from "../../contracts/assessment";
import type { AssessmentReleaseState } from "../../contracts/release";
import { SatDeliveryReleasePage } from "../SatDeliveryReleasePage";

const updateMutation = vi.hoisted(() => ({
  mutateAsync: vi.fn(),
  isPending: false,
}));

vi.mock("../../api/assessmentQueries", () => ({
  useUpdateSectionDeliverySettings: () => updateMutation,
}));

const exam: ExamEntity = {
  id: "exam-sat-1",
  slug: "sat-release-test",
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
        operationalQuestionCount: 25,
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

function moduleShell(
  id: string,
  moduleKey: string,
  title: string,
  adaptiveRole: "base" | "lower_branch" | "higher_branch"
) {
  return {
    id,
    moduleKey,
    title,
    displayOrder: adaptiveRole === "base" ? 0 : adaptiveRole === "lower_branch" ? 1 : 2,
    durationSeconds: 32 * 60,
    targetQuestionCount: 27,
    adaptiveRole,
    toolPolicy: [],
    revision: 2,
    questions: [],
  };
}
const readyReport: AssessmentValidationReport = {
  examId: exam.id,
  versionId: shell.versionId,
  versionRevision: shell.versionRevision,
  valid: true,
  errors: [],
  warnings: [],
};

const neverPublishedRelease: AssessmentReleaseState = {
  examId: exam.id,
  providerKey: "sat",
  state: "never_published",
  currentPublishedVersion: null,
  workingDraft: { id: shell.versionId, parentVersionId: null, versionNumber: 1, revision: 12 },
  summary: { candidateDurationSeconds: 4440, authoredQuestionCount: 81, deliveredQuestionCount: 54 },
  access: { totalLinks: 0, liveLinks: 0, upcomingLinks: 0, linksOnCurrentRelease: 0, liveLinksOnPreviousReleases: 0 },
};

const publishedCurrentRelease: AssessmentReleaseState = {
  ...neverPublishedRelease,
  state: "published_current",
  currentPublishedVersion: {
    id: "published-v4",
    versionNumber: 4,
    revision: 1,
    publishNotes: null,
    publishedAt: "2026-08-29T03:26:24.000Z",
  },
  workingDraft: { id: shell.versionId, parentVersionId: "published-v4", versionNumber: 5, revision: 0 },
  access: { totalLinks: 1, liveLinks: 1, upcomingLinks: 0, linksOnCurrentRelease: 0, liveLinksOnPreviousReleases: 1 },
};

const unpublishedChangesRelease: AssessmentReleaseState = {
  ...publishedCurrentRelease,
  state: "unpublished_changes",
  workingDraft: { ...publishedCurrentRelease.workingDraft!, revision: 1 },
};

const blockingIssue: AssessmentValidationIssue = {
  code: "sat.metadata.domain.required",
  path: "examQuestion:q-17:metadata.domain",
  message: "Choose the SAT domain for this question.",
  blocking: true,
};

function pageProps(overrides: Partial<ComponentProps<typeof SatDeliveryReleasePage>> = {}) {
  return {
    exam,
    shell,
    releaseState: neverPublishedRelease,
    isLoading: false,
    loadError: null,
    readiness: readyReport,
    isChecking: false,
    readinessError: null,
    isPublishing: false,
    publishError: null,
    onBackToBuilder: vi.fn(),
    onBackToExams: vi.fn(),
    onRefreshReadiness: vi.fn().mockResolvedValue(undefined),
    onPublish: vi.fn().mockResolvedValue(undefined),
    onIssueClick: vi.fn(),
    onOpenStudentAccess: vi.fn(),
    ...overrides,
  };
}

beforeAll(() => {
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = function showModal() {
      this.setAttribute("open", "");
    };
  }
  if (!HTMLDialogElement.prototype.close) {
    HTMLDialogElement.prototype.close = function close() {
      this.removeAttribute("open");
      this.dispatchEvent(new Event("close"));
    };
  }
});

beforeEach(() => {
  updateMutation.mutateAsync.mockReset();
  updateMutation.mutateAsync.mockResolvedValue(shell);
  updateMutation.isPending = false;
});
describe("SatDeliveryReleasePage", () => {
  it("enables publishing only for a checked, current, clean draft", () => {
    render(<SatDeliveryReleasePage {...pageProps()} />);

    expect(screen.getByRole("button", { name: "Publish" })).toBeEnabled();
    expect(screen.getByText("Ready to publish")).toBeInTheDocument();
  });

  it("blocks publishing as soon as delivery settings become dirty", () => {
    render(<SatDeliveryReleasePage {...pageProps()} />);

    fireEvent.change(screen.getByLabelText(/Module 1/), { target: { value: "33" } });

    expect(screen.getByRole("button", { name: "Publish" })).toBeDisabled();
    expect(screen.getByText("Save all delivery changes before publishing.")).toBeInTheDocument();
  });

  it("protects unsaved delivery settings when leaving release", () => {
    const onBackToBuilder = vi.fn();
    render(<SatDeliveryReleasePage {...pageProps({ onBackToBuilder })} />);

    fireEvent.change(screen.getByLabelText(/Module 1/), { target: { value: "33" } });
    fireEvent.click(screen.getByRole("button", { name: "Questions" }));

    expect(onBackToBuilder).not.toHaveBeenCalled();
    expect(
      screen.getByRole("alertdialog", { name: "Leave with unsaved changes?" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Leave without saving" }));

    expect(onBackToBuilder).toHaveBeenCalledOnce();
  });

  it("keeps warning-only drafts publishable", () => {
    const warning: AssessmentValidationIssue = {
      code: "sat.delivery.nonstandard_timing",
      path: "reading-writing.rw-m1.duration",
      message: "Module 1 uses non-standard timing.",
      blocking: false,
    };
    render(
      <SatDeliveryReleasePage
        {...pageProps({ readiness: { ...readyReport, warnings: [warning] } })}
      />
    );

    expect(screen.getByRole("button", { name: "Publish" })).toBeEnabled();
    expect(screen.getByText("1 recommendation")).toBeInTheDocument();
  });
  it("surfaces blockers and forwards question issue navigation", () => {
    const onIssueClick = vi.fn();
    render(
      <SatDeliveryReleasePage
        {...pageProps({
          readiness: {
            ...readyReport,
            valid: false,
            errors: [blockingIssue],
          },
          onIssueClick,
        })}
      />
    );

    expect(screen.getByRole("button", { name: "Publish" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /Choose the SAT domain/ }));
    expect(onIssueClick).toHaveBeenCalledWith(blockingIssue);
  });

  it("publishes through the confirmation dialog and preserves optional notes", async () => {
    const onPublish = vi.fn().mockResolvedValue(undefined);
    render(<SatDeliveryReleasePage {...pageProps({ onPublish })} />);

    fireEvent.click(screen.getByRole("button", { name: "Publish" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("What changed in this release?"), {
      target: { value: "Delivery thresholds reviewed" },
    });
    const publishButtons = screen.getAllByRole("button", { name: "Publish" });
    fireEvent.click(publishButtons[publishButtons.length - 1]!);

    await waitFor(() => expect(onPublish).toHaveBeenCalledWith("Delivery thresholds reviewed"));
  });
  it("treats an untouched continuation draft as already published", () => {
    const onOpenStudentAccess = vi.fn();
    render(
      <SatDeliveryReleasePage
        {...pageProps({
          releaseState: publishedCurrentRelease,
          readiness: null,
          onOpenStudentAccess,
        })}
      />
    );

    expect(screen.getByRole("heading", { name: "Published" })).toBeInTheDocument();
    expect(screen.getByText("Version 4 is what students receive.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Publish" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Publish Update" })).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "Student Access" }).at(-1)!);
    expect(onOpenStudentAccess).toHaveBeenCalledTimes(1);
  });

  it("labels a changed continuation draft as an update while preserving the live release", () => {
    render(
      <SatDeliveryReleasePage
        {...pageProps({ releaseState: unpublishedChangesRelease })}
      />
    );

    expect(screen.getByText("Unpublished changes")).toBeInTheDocument();
    expect(screen.getByText("Students still receive Version 4.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Publish Update" })).toBeEnabled();
  });
});
