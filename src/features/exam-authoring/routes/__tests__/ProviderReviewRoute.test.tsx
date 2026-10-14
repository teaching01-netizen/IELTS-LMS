import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExamEntity } from "../../../../types/domain";
import { ProviderReviewRoute } from "../ProviderReviewRoute";

const useExamQueryMock = vi.hoisted(() => vi.fn());

vi.mock("../../api/examQueries", () => ({
  useExamQuery: useExamQueryMock,
}));
vi.mock("../../../builder/routes/ExamReviewRoute", () => ({
  ExamReviewRoute: () => <div>legacy-review-route</div>,
}));

const baseExam: ExamEntity = {
  id: "exam-1",
  slug: "exam-1",
  title: "Exam",
  providerKey: "sat",
  type: "Academic",
  status: "draft",
  visibility: "organization",
  owner: "builder-1",
  createdAt: "2026-08-28T00:00:00Z",
  updatedAt: "2026-08-28T00:00:00Z",
  currentDraftVersionId: "version-1",
  currentPublishedVersionId: null,
  canEdit: true,
  canPublish: true,
  canDelete: true,
  revision: 7,
  schemaVersion: 4,
};

function Where() {
  const location = useLocation();
  return <div data-testid="where">{`${location.pathname}${location.search}`}</div>;
}

function renderRoute(entry: string) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/builder/:examId/review" element={<ProviderReviewRoute />} />
        <Route path="/sat/exams/:examId/release" element={<ProviderReviewRoute />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>
  );
}

describe("ProviderReviewRoute", () => {
  beforeEach(() => {
    useExamQueryMock.mockReset();
  });

  it("sends a legacy SAT release URL to Settings, keeping the scoring deep link", () => {
    useExamQueryMock.mockReturnValue({ data: baseExam, isLoading: false, error: null, refetch: vi.fn() });
    renderRoute("/sat/exams/exam-1/release?panel=scoring");
    expect(screen.getByTestId("where")).toHaveTextContent("/sat/exams/exam-1/settings?panel=scoring");
  });

  it("sends the old student-access view to Rooms", () => {
    useExamQueryMock.mockReturnValue({ data: baseExam, isLoading: false, error: null, refetch: vi.fn() });
    renderRoute("/sat/exams/exam-1/release?view=access");
    expect(screen.getByTestId("where")).toHaveTextContent("/sat/exams/exam-1/access");
    expect(screen.getByTestId("where")).not.toHaveTextContent("view=");
  });

  it("keeps non-SAT exams on the legacy review route", () => {
    useExamQueryMock.mockReturnValue({
      data: { ...baseExam, providerKey: "ielts" },
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderRoute("/builder/exam-1/review");
    expect(screen.getByText("legacy-review-route")).toBeInTheDocument();
  });
});
