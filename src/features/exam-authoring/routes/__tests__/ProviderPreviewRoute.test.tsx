import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExamEntity } from "../../../../types/domain";
import { ProviderPreviewRoute } from "../ProviderPreviewRoute";

const useExamQueryMock = vi.hoisted(() => vi.fn());

vi.mock("../../api/examQueries", () => ({ useExamQuery: useExamQueryMock }));
vi.mock("../../../student-delivery/routes/SatPreviewRoute", () => ({
  SatPreviewRoute: () => <div>sat-full-preview</div>,
}));
vi.mock("../../../builder/routes/ExamPreviewRoute", () => ({
  ExamPreviewRoute: () => <div>legacy-runtime-preview</div>,
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
  createdAt: "2026-08-30T00:00:00Z",
  updatedAt: "2026-08-30T00:00:00Z",
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
    <MemoryRouter initialEntries={["/builder/exam-1/preview"]}>
      <Routes>
        <Route path="/builder/:examId/preview" element={<ProviderPreviewRoute />} />
      </Routes>
    </MemoryRouter>
  );
}

describe("ProviderPreviewRoute", () => {
  beforeEach(() => useExamQueryMock.mockReset());

  it("routes SAT drafts to the production-fidelity SAT preview", () => {
    useExamQueryMock.mockReturnValue({
      data: baseExam,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderRoute();
    expect(screen.getByText("sat-full-preview")).toBeInTheDocument();
    expect(screen.queryByText("legacy-runtime-preview")).not.toBeInTheDocument();
  });

  it("preserves the existing non-SAT runtime preview", () => {
    useExamQueryMock.mockReturnValue({
      data: { ...baseExam, providerKey: "ielts" },
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderRoute();
    expect(screen.getByText("legacy-runtime-preview")).toBeInTheDocument();
  });
});
