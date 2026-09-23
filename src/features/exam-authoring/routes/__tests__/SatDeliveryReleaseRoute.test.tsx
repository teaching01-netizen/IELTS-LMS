import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExamEntity } from "../../../../types/domain";
import type { AssessmentValidationIssue } from "../../contracts/assessment";
import {
  consumeAuthoringDraftOnEntry,
  peekAuthoringDraftOnEntry,
} from "../../application/authoringEntryIntent";
import { SatDeliveryReleaseRoute } from "../SatDeliveryReleaseRoute";

const mocks = vi.hoisted(() => ({
  publish: vi.fn(),
  refetchReadiness: vi.fn(),
  refetchRelease: vi.fn(),
  refetchDistribution: vi.fn(),
}));

vi.mock("../../api/assessmentQueries", () => ({
  // The shell read answers a lifecycle envelope now; this route renders the
  // release page for a READY draft.
  useAuthoringShell: () => ({
    data: {
      state: "READY",
      shell: {
        examId: "exam-sat-1",
        providerKey: "sat",
        versionId: "draft-v5",
        versionRevision: 42,
        sections: [],
      },
    },
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
  useAssessmentReleaseState: () => ({
    data: {
      examId: "exam-sat-1",
      providerKey: "sat",
      state: "never_published",
      currentPublishedVersion: null,
      workingDraft: { id: "draft-v5", parentVersionId: null, versionNumber: 5, revision: 42 },
      summary: { candidateDurationSeconds: 0, authoredQuestionCount: 0, deliveredQuestionCount: 0 },
      access: { totalLinks: 0, liveLinks: 0, upcomingLinks: 0, linksOnCurrentRelease: 0, liveLinksOnPreviousReleases: 0 },
    },
    isLoading: false,
    error: null,
    refetch: mocks.refetchRelease,
  }),
  useAssessmentReleaseReadiness: () => ({
    data: {
      examId: "exam-sat-1",
      versionId: "draft-v5",
      versionRevision: 42,
      publishScope: "full",
      valid: true,
      errors: [],
      warnings: [],
    },
    isFetching: false,
    error: null,
    refetch: mocks.refetchReadiness,
  }),
  usePublishAssessment: () => ({
    mutateAsync: mocks.publish,
    isPending: false,
    error: null,
  }),
}));

vi.mock("../../api/assessmentAccessLinkQueries", () => ({
  useAccessDistributionOverview: () => ({
    data: null,
    isLoading: false,
    error: null,
    refetch: mocks.refetchDistribution,
  }),
}));
vi.mock("../../ui/access-links/StudentLinksDashboard", () => ({
  StudentLinksDashboard: ({ onBackToRelease }: { onBackToRelease: () => void }) => (
    <div>
      <span>student-links-dashboard</span>
      <button type="button" onClick={onBackToRelease}>Back to release</button>
    </div>
  ),
}));

vi.mock("../../ui/SatDeliveryReleasePage", () => ({
  SatDeliveryReleasePage: ({
    onIssueClick,
    onPublish,
    onOpenStudentAccess,
    onBackToBuilder,
  }: {
    onIssueClick: (issue: AssessmentValidationIssue) => void;
    onPublish: (scope: "full" | "reading-writing" | "math", notes?: string) => Promise<void>;
    onOpenStudentAccess: () => void;
    onBackToBuilder: () => void;
  }) => (
    <div>
      <button type="button" onClick={onBackToBuilder}>
        Back to builder
      </button>
      <button
        type="button"
        onClick={() =>
          onIssueClick({
            code: "sat.metadata.domain.required",
            path: "examQuestion:q-17:metadata.domain",
            message: "Choose domain",
            blocking: true,
          })
        }
      >
        Open issue
      </button>
      <button
        type="button"
        onClick={() =>
          onIssueClick({
            code: "sat.delivery.nonstandard_timing",
            path: "reading-writing.rw-m1.duration",
            message: "Non-standard timing",
            blocking: false,
          })
        }
      >
        Open malformed issue
      </button>
      <button type="button" onClick={onOpenStudentAccess}>
        Student Access
      </button>
      <button type="button" onClick={() => void onPublish("full", "Release notes")}>
        Publish
      </button>
    </div>
  ),
}));

const exam: ExamEntity = {
  id: "exam-sat-1",
  slug: "sat-route-test",
  title: "SAT Route Test",
  providerKey: "sat",
  providerExamType: "sat",
  type: "Academic",
  status: "draft",
  visibility: "organization",
  owner: "builder-1",
  createdAt: "2026-08-28T00:00:00.000Z",
  updatedAt: "2026-08-28T00:00:00.000Z",
  currentDraftVersionId: "draft-v5",
  currentPublishedVersionId: null,
  canEdit: true,
  canPublish: true,
  canDelete: true,
  revision: 9,
  schemaVersion: 4,
};
function LocationProbe() {
  const location = useLocation();
  return (
    <pre data-testid="location">
      {JSON.stringify({
        pathname: location.pathname,
        search: location.search,
        state: location.state,
      })}
    </pre>
  );
}

function renderSatRoute() {
  render(
    <MemoryRouter initialEntries={[`/sat/exams/${exam.id}/release`]}>
      <Routes>
        <Route
          path="/sat/exams/:examId/release"
          element={<SatDeliveryReleaseRoute exam={exam} onExamRefresh={vi.fn()} />}
        />
        <Route path="/sat/exams/:examId" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>
  );
}

function renderRoute(onExamRefresh = vi.fn().mockResolvedValue(undefined)) {
  render(
    <MemoryRouter initialEntries={[`/builder/${exam.id}/review`]}>
      <Routes>
        <Route
          path="/builder/:examId/review"
          element={<SatDeliveryReleaseRoute exam={exam} onExamRefresh={onExamRefresh} />}
        />
        <Route path="/builder/:examId" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>
  );
  return { onExamRefresh };
}

beforeEach(() => {
  mocks.publish.mockReset();
  mocks.refetchReadiness.mockReset();
  mocks.refetchRelease.mockReset();
  mocks.refetchDistribution.mockReset();
  mocks.refetchReadiness.mockResolvedValue(undefined);
  mocks.refetchRelease.mockResolvedValue(undefined);
  mocks.refetchDistribution.mockResolvedValue(undefined);
  mocks.publish.mockResolvedValue({
    id: "draft-v5",
    examId: exam.id,
    versionNumber: 5,
    revision: 43,
    isDraft: false,
    isPublished: true,
    publishNotes: "Release notes",
    publishScope: "full",
    createdAt: "2026-08-28T08:00:00.000Z",
  });
});
describe("SatDeliveryReleaseRoute", () => {
  it("publishes the exact checked draft revision with the current exam revision", async () => {
    const { onExamRefresh } = renderRoute();

    fireEvent.click(screen.getByRole("button", { name: "Publish" }));

    await waitFor(() =>
      expect(mocks.publish).toHaveBeenCalledWith({
        revision: 9,
        expectedDraftVersionId: "draft-v5",
        expectedDraftRevision: 42,
        publishScope: "full",
        publishNotes: "Release notes",
        operationKey: expect.any(String),
      })
    );
    expect(onExamRefresh).toHaveBeenCalledTimes(1);
    expect(mocks.refetchRelease).toHaveBeenCalledTimes(1);
    expect(mocks.refetchDistribution).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("student-links-dashboard")).toBeInTheDocument();
  });

  it("deep-links a release blocker to the exact authoring question and field", () => {
    renderRoute();

    fireEvent.click(screen.getByRole("button", { name: "Open issue" }));

    const location = screen.getByTestId("location").textContent ?? "";
    expect(location).toContain(`"pathname":"/builder/${exam.id}"`);
    expect(location).toContain("question=q-17");
    expect(location).toContain("field=metadata.domain");
    // The legacy builder heals its own draft, so this path arms nothing.
    expect(peekAuthoringDraftOnEntry(exam.id)).toBe(false);
  });

  it("arms the edit gesture when a release blocker deep-links into the SAT workspace", () => {
    renderSatRoute();
    expect(peekAuthoringDraftOnEntry(exam.id)).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Open issue" }));

    expect(peekAuthoringDraftOnEntry(exam.id)).toBe(true);
    const location = screen.getByTestId("location").textContent ?? "";
    expect(location).toContain(`"pathname":"/sat/exams/${exam.id}"`);
    expect(location).toContain("question=q-17");
    expect(location).toContain("field=metadata.domain");

    consumeAuthoringDraftOnEntry(exam.id);
  });

  it("persists Student Access as the canonical URL-addressable review mode", () => {
    renderRoute();
    fireEvent.click(screen.getByRole("button", { name: "Student Access" }));
    expect(screen.getByText("student-links-dashboard")).toBeInTheDocument();
  });

  it("ignores malformed issue paths instead of navigating with empty params", () => {
    renderRoute();

    fireEvent.click(screen.getByRole("button", { name: "Open malformed issue" }));

    // No navigation happens: the review page stays mounted and the builder
    // location probe never appears.
    expect(screen.queryByTestId("location")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Publish" })).toBeInTheDocument();
  });

  it("still opens student access when a post-publish refetch fails", async () => {
    mocks.refetchDistribution.mockRejectedValueOnce(new Error("boom"));
    const { onExamRefresh } = renderRoute();

    fireEvent.click(screen.getByRole("button", { name: "Publish" }));

    expect(await screen.findByText("student-links-dashboard")).toBeInTheDocument();
    expect(onExamRefresh).toHaveBeenCalledTimes(1);
  });

  it("arms the edit gesture when the product's Back to builder returns to the SAT workspace", () => {
    // Publishing sealed the draft, so this click has to continue from the
    // published version instead of landing on "No editable draft".
    renderSatRoute();
    expect(peekAuthoringDraftOnEntry(exam.id)).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Back to builder" }));

    expect(peekAuthoringDraftOnEntry(exam.id)).toBe(true);
    const location = screen.getByTestId("location").textContent ?? "";
    expect(location).toContain(`"pathname":"/sat/exams/${exam.id}"`);

    consumeAuthoringDraftOnEntry(exam.id);
  });

  it("does not arm the gesture for the legacy builder path, which heals its own draft", () => {
    renderRoute();

    fireEvent.click(screen.getByRole("button", { name: "Back to builder" }));

    expect(peekAuthoringDraftOnEntry(exam.id)).toBe(false);
    const location = screen.getByTestId("location").textContent ?? "";
    expect(location).toContain(`"pathname":"/builder/${exam.id}"`);
  });

  it("accepts legacy Student Links URLs and returns to Release", () => {
    render(
      <MemoryRouter initialEntries={[`/builder/${exam.id}/review?view=links`]}>
        <Routes>
          <Route
            path="/builder/:examId/review"
            element={<SatDeliveryReleaseRoute exam={exam} onExamRefresh={vi.fn()} />}
          />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByText("student-links-dashboard")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Back to release" }));
    expect(screen.getByRole("button", { name: "Publish" })).toBeInTheDocument();
  });
});
