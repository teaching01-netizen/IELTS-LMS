import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AdminResultRow,
  ResultProviderKey,
} from "../../../features/results/api/resultsQueries";

const mocks = vi.hoisted(() => ({
  useAdminResultsQuery: vi.fn(),
  useResultsAnalyticsQuery: vi.fn(),
  useActScienceDetailQuery: vi.fn(),
}));

vi.mock("../../../features/results/api/resultsQueries", () => mocks);

const ieltsDetailMocks = vi.hoisted(() => ({
  useIeltsResultDetailQuery: vi.fn(),
}));

vi.mock("../../../features/results/api/ieltsResultDetail", () => ieltsDetailMocks);

import { AdminResults } from "../AdminResults";

const ieltsResult: AdminResultRow = {
  id: "result-ielts",
  submissionId: "submission-ielts",
  attemptId: "attempt-ielts",
  providerKey: "ielts",
  outcomeStatus: "scored",
  releaseStatus: "released",
  totalScore: null,
  maxScore: null,
  percentage: null,
  overallBand: 7.5,
  sectionBands: {
    listening: 8,
    reading: 7.5,
    writing: 7,
    speaking: 7.5,
  },
  studentId: "IELTS-001",
  studentName: "Ada IELTS",
  studentEmail: "ada@example.com",
  scheduleId: "schedule-ielts",
  examId: "exam-ielts",
  examTitle: "IELTS Academic",
  cohortName: "Cohort A",
  institution: "Test School",
  versionNumber: 2,
  submittedAt: "2026-09-01T08:00:00Z",
};

const actResult: AdminResultRow = {
  id: "result-act",
  submissionId: null,
  attemptId: "attempt-act",
  providerKey: "act",
  outcomeStatus: "scored",
  releaseStatus: "ready_to_release",
  totalScore: 32,
  maxScore: 40,
  percentage: 80,
  overallBand: null,
  sectionBands: null,
  studentId: "ACT-001",
  studentName: "Bea ACT",
  studentEmail: "bea@example.com",
  scheduleId: "schedule-act",
  examId: "exam-act",
  examTitle: "ACT Science Practice",
  cohortName: "Cohort B",
  institution: "Test School",
  versionNumber: 1,
  submittedAt: "2026-09-02T08:00:00Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.useActScienceDetailQuery.mockReturnValue({ data: undefined, isLoading: false, error: null });
  ieltsDetailMocks.useIeltsResultDetailQuery.mockReturnValue({ data: undefined, isLoading: false, error: null });
  mocks.useAdminResultsQuery.mockImplementation((provider: ResultProviderKey | "all" = "all") => ({
    data:
      provider === "all"
        ? [actResult, ieltsResult]
        : provider === "act"
          ? [actResult]
          : [ieltsResult],
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }));
  mocks.useResultsAnalyticsQuery.mockReturnValue({
    data: {
      totalResults: 2,
      releasedResults: 1,
      readyToRelease: 1,
      averageOverallBand: 7.5,
    },
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  });
});

describe("AdminResults", () => {
  it("renders provider-backed IELTS and ACT results and opens the real report", () => {
    render(<AdminResults />);

    expect(screen.getByText("Ada IELTS")).toBeInTheDocument();
    expect(screen.getByText("Bea ACT")).toBeInTheDocument();
    expect(screen.getByText("Band 7.5")).toBeInTheDocument();
    expect(screen.getByText("32/40")).toBeInTheDocument();
    expect(screen.getAllByText("ACT Science").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("7.5")).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: "View Report" })[0]);

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("ACT Science result");
    expect(dialog).toHaveTextContent("32/40");
    expect(dialog).toHaveTextContent("80.0% correct");
    expect(dialog).not.toHaveTextContent("IELTS section bands");
  });

  it("does not crash when optional provider scores are omitted from the wire response", () => {
    mocks.useAdminResultsQuery.mockReturnValue({
      data: [
        {
          ...actResult,
          totalScore: undefined,
          maxScore: undefined,
          percentage: undefined,
        } as unknown as AdminResultRow,
      ],
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });

    render(<AdminResults />);
    expect(screen.getByText("—")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "View Report" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getAllByText("Ready to release").length).toBeGreaterThan(0);
  });

  it("filters the backend provider selection and local search without fabricating rows", () => {
    render(<AdminResults />);

    fireEvent.change(screen.getByLabelText("Filter by provider"), {
      target: { value: "act" },
    });
    expect(mocks.useAdminResultsQuery).toHaveBeenLastCalledWith("act");
    expect(screen.getByText("Bea ACT")).toBeInTheDocument();
    expect(screen.queryByText("Ada IELTS")).not.toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("Search results..."), {
      target: { value: "does-not-exist" },
    });
    expect(screen.getByRole("heading", { name: "No matching results" })).toBeInTheDocument();
    expect(screen.queryByText("Bea ACT")).not.toBeInTheDocument();
  });

  it("shows a truthful empty state when the backend has no sealed or released results", () => {
    mocks.useAdminResultsQuery.mockReturnValue({
      data: [],
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });

    render(<AdminResults />);

    expect(screen.getByRole("heading", { name: "No results yet" })).toBeInTheDocument();
    expect(
      screen.getByText(/A result appears here after an attempt is sealed/)
    ).toBeInTheDocument();
  });

  it("renders retryable loading and error states", () => {
    mocks.useAdminResultsQuery.mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
      refetch: vi.fn(),
    });
    const { unmount } = render(<AdminResults />);
    expect(screen.getByRole("status")).toHaveTextContent("Opening results");
    unmount();

    const refetch = vi.fn();
    mocks.useAdminResultsQuery.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error("backend unavailable"),
      refetch,
    });
    render(<AdminResults />);
    expect(screen.getByRole("alert")).toHaveTextContent("backend unavailable");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("shows IELTS module raw and per-question raw without fabricating verdicts", () => {
    ieltsDetailMocks.useIeltsResultDetailQuery.mockReturnValue({
      data: {
        submission: null,
        sections: [],
        writingTasks: [],
        snapshot: null,
        modules: [
          { key: "listening", label: "Listening", correct: 30, total: 40, percentage: 75, status: "auto_graded", overrideCount: 1, unansweredCount: 2 },
          { key: "reading", label: "Reading", correct: null, total: null, percentage: null, status: "needs_review", overrideCount: 0, unansweredCount: 0 },
        ],
        questions: [
          { questionId: "L1", section: "listening", displayOrder: 1, studentAnswer: "A", correctAnswer: "A", isCorrect: true, awardedScore: 1, maxScore: 1, hasOverride: false, answered: true },
          { questionId: "L2", section: "listening", displayOrder: 2, studentAnswer: "B", correctAnswer: "C", isCorrect: false, awardedScore: 0, maxScore: 1, hasOverride: true, answered: true },
          { questionId: "L3", section: "listening", displayOrder: 3, studentAnswer: "", correctAnswer: "D", isCorrect: null, awardedScore: null, maxScore: 1, hasOverride: false, answered: false },
        ],
      },
      isLoading: false,
      error: null,
    });
    render(<AdminResults />);
    fireEvent.click(screen.getAllByRole("button", { name: "View Report" })[1]);
    fireEvent.click(screen.getByRole("tab", { name: "Modules" }));
    expect(screen.getByText("30 / 40")).toBeInTheDocument();
    expect(screen.getByText("1 override")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Questions" }));
    expect(screen.getByText("L1")).toBeInTheDocument();
    expect(screen.getByText("Correct")).toBeInTheDocument();
    expect(screen.getByText("Incorrect")).toBeInTheDocument();
    expect(screen.getByText("Override")).toBeInTheDocument();
    // Null verdict renders as Not scored, never as Incorrect.
    expect(screen.getByText("Not scored")).toBeInTheDocument();
    expect(screen.getByText("Unanswered")).toBeInTheDocument();
  });

  it("shows ACT science per-question raw answers", () => {
    mocks.useActScienceDetailQuery.mockReturnValue({
      data: {
        attemptId: "attempt-act", scheduleId: "schedule-act", studentId: "ACT-001",
        studentName: "Bea ACT", totalScore: 2, maxScore: 3, percentage: 66.7,
        outcomeStatus: "scored", releaseStatus: "ready_to_release",
        questions: [
          { questionId: "q1", displayOrder: 1, response: "A", correctAnswer: "A", isCorrect: true, answered: true },
          { questionId: "q2", displayOrder: 2, response: "", correctAnswer: "B", isCorrect: null, answered: false },
        ],
      },
      isLoading: false,
      error: null,
    });
    render(<AdminResults />);
    fireEvent.click(screen.getAllByRole("button", { name: "View Report" })[0]);
    fireEvent.click(screen.getByRole("tab", { name: "Questions" }));
    expect(screen.getByText("q1")).toBeInTheDocument();
    expect(screen.getByText("Correct")).toBeInTheDocument();
    expect(screen.getByText("Unanswered")).toBeInTheDocument();
  });

  it("keeps the report dialog accessible and closable", () => {
    render(<AdminResults />);
    fireEvent.click(screen.getAllByRole("button", { name: "View Report" })[1]);

    const dialog = screen.getByRole("dialog", { name: "Ada IELTS" });
    expect(within(dialog).getByText("IELTS section bands")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close result report" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
