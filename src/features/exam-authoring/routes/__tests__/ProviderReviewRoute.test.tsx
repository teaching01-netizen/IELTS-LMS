import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExamEntity } from "../../../../types/domain";
import { ProviderReviewRoute } from "../ProviderReviewRoute";

const useExamQueryMock = vi.hoisted(() => vi.fn());

vi.mock("../../api/examQueries", () => ({
  useExamQuery: useExamQueryMock,
}));
vi.mock("../SatDeliveryReleaseRoute", () => ({
  SatDeliveryReleaseRoute: () => <div>sat-release-route</div>,
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

function renderRoute() {
  return render(
    <MemoryRouter initialEntries={["/builder/exam-1/review"]}>
      <Routes>
        <Route path="/builder/:examId/review" element={<ProviderReviewRoute />} />
      </Routes>
    </MemoryRouter>
  );
}

describe("ProviderReviewRoute", () => {
  beforeEach(() => {
    useExamQueryMock.mockReset();
  });

  it("dispatches SAT exams to the SAT Delivery & Release route", () => {
    useExamQueryMock.mockReturnValue({
      data: baseExam,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderRoute();
    expect(screen.getByText("sat-release-route")).toBeInTheDocument();
    expect(screen.queryByText("legacy-review-route")).not.toBeInTheDocument();
  });

  it("keeps non-SAT exams on the legacy review route", () => {
    useExamQueryMock.mockReturnValue({
      data: { ...baseExam, providerKey: "ielts" },
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderRoute();
    expect(screen.getByText("legacy-review-route")).toBeInTheDocument();
    expect(screen.queryByText("sat-release-route")).not.toBeInTheDocument();
  });
});
