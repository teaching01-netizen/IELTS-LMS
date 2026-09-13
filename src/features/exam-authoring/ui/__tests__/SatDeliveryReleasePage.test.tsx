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
    fireEvent.click(screen.getByRole("button", { name: "Back to builder" }));

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

  it("blocks publishing with an explicit stale-checks banner and reason", () => {
    render(
      <SatDeliveryReleasePage
        {...pageProps({
          readiness: { ...readyReport, versionRevision: shell.versionRevision - 1 },
        })}
      />
    );

    expect(screen.getByRole("button", { name: "Publish" })).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent(/Checks are for revision/);
    expect(screen.getByRole("button", { name: "Publish" })).toHaveAttribute(
      "aria-describedby",
      "release-publish-reasons",
    );
    expect(screen.getByText(/Publish checks are stale/)).toBeInTheDocument();
  });

  it("edits the threshold against the blueprint on threshold-only rows (stuck-at-1 regression)", async () => {
    // Real shells arrive with operationalQuestionCount: 0 (threshold-only
    // policy_config). The Higher-route field must still accept the RW
    // contract range instead of clamping every keystroke back to 1.
    render(
      <SatDeliveryReleasePage
        {...pageProps({
          shell: {
            ...shell,
            sections: [
              {
                ...shell.sections[0]!,
                routingPolicy: { ...shell.sections[0]!.routingPolicy!, operationalQuestionCount: 0 },
              },
            ],
          },
        })}
      />,
    );

    expect(screen.getByText(/25 operational questions/)).toBeInTheDocument();
    const threshold = screen.getByLabelText(/Higher route at/);
    fireEvent.change(threshold, { target: { value: "13" } });
    expect(threshold).toHaveValue(13);
    // Range summary is split across elements (0–12 → Lower · 13–25 → Higher).
    expect(screen.getByText("0–12")).toBeInTheDocument();
    expect(screen.getByText("13–25")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Save section" }));
    await waitFor(() =>
      expect(updateMutation.mutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          request: expect.objectContaining({ minimumCorrectForHigher: 13 }),
        }),
      ),
    );
  });

  it("keeps release checks visible in read-only mode once published", () => {
    render(
      <SatDeliveryReleasePage
        {...pageProps({
          releaseState: publishedCurrentRelease,
          readiness: null,
        })}
      />
    );

    expect(screen.getByText(/Release checks passed for Version 4/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Run checks" })).not.toBeInTheDocument();
  });

  it("blocks publishing without publish permission and names the reason", () => {
    render(
      <SatDeliveryReleasePage
        {...pageProps({ exam: { ...exam, canPublish: false } })}
      />
    );

    expect(screen.getByRole("button", { name: "Publish" })).toBeDisabled();
    expect(screen.getByText(/do not have permission to publish/)).toBeInTheDocument();
  });

  it("disables section save and explains read-only delivery settings", () => {
    render(
      <SatDeliveryReleasePage
        {...pageProps({ exam: { ...exam, canEdit: false } })}
      />
    );

    expect(screen.getByRole("button", { name: "Saved" })).toBeDisabled();
    expect(
      screen.getAllByText(/do not have permission to edit delivery settings/).length,
    ).toBeGreaterThanOrEqual(1);
  });

  it("maps save conflicts to a user-safe alert", async () => {
    updateMutation.mutateAsync.mockRejectedValueOnce(new Error("revision conflict 409"));
    render(<SatDeliveryReleasePage {...pageProps()} />);

    fireEvent.change(screen.getByLabelText(/Module 1/), { target: { value: "33" } });
    fireEvent.click(screen.getByRole("button", { name: "Save section" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/draft changed/i);
  });

  it("submits the publish dialog only once on double click", async () => {
    const onPublish = vi.fn().mockImplementation(() => new Promise(() => {}));
    render(<SatDeliveryReleasePage {...pageProps({ onPublish })} />);

    fireEvent.click(screen.getByRole("button", { name: "Publish" }));
    const publishButtons = screen.getAllByRole("button", { name: "Publish" });
    const dialogButton = publishButtons[publishButtons.length - 1]!;
    fireEvent.click(dialogButton);
    fireEvent.click(dialogButton);

    await waitFor(() => expect(onPublish).toHaveBeenCalledTimes(1));
  });

  it("maps publish failures to user-safe copy instead of raw errors", async () => {
    const onPublish = vi
      .fn()
      .mockRejectedValueOnce(new Error("publish 500 <html>internal stack</html>"));
    render(<SatDeliveryReleasePage {...pageProps({ onPublish })} />);

    fireEvent.click(screen.getByRole("button", { name: "Publish" }));
    const publishButtons = screen.getAllByRole("button", { name: "Publish" });
    fireEvent.click(publishButtons[publishButtons.length - 1]!);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /could not be published/i,
    );
    expect(screen.queryByText(/internal stack/)).not.toBeInTheDocument();
  });

  it("expands long issue lists on demand instead of silently truncating", () => {
    const errors = Array.from({ length: 25 }, (_, index) => ({
      code: `sat.blocker.${index}`,
      path: `section.${index}`,
      message: `Blocking issue ${index}`,
      blocking: true,
    }));
    render(
      <SatDeliveryReleasePage
        {...pageProps({
          readiness: { ...readyReport, valid: false, errors },
        })}
      />,
    );

    expect(screen.getByRole("button", { name: /show all 25 issues/i })).toBeInTheDocument();
    expect(screen.queryByText("Blocking issue 24")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /show all 25 issues/i }));
    expect(screen.getByText("Blocking issue 24")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /show fewer issues/i }));
    expect(screen.queryByText("Blocking issue 24")).not.toBeInTheDocument();
  });

  it("keeps publish reachable by keyboard tab order", () => {
    render(<SatDeliveryReleasePage {...pageProps()} />);

    const publish = screen.getByRole("button", { name: "Publish" });
    publish.focus();
    expect(document.activeElement).toBe(publish);
    expect(publish).toBeEnabled();
  });

  it("pauses publishing while offline with an explicit banner", () => {
    const onlineSpy = vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(false);
    try {
      render(<SatDeliveryReleasePage {...pageProps()} />);

      expect(screen.getByRole("button", { name: "Publish" })).toBeDisabled();
      expect(screen.getAllByText(/you are offline/i).length).toBeGreaterThanOrEqual(1);
    } finally {
      onlineSpy.mockRestore();
    }
  });
});
