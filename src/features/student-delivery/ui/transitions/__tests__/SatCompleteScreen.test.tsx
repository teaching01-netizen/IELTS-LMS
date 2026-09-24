import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SAT_COPY } from "../../../domain/satCopy";
import type { AssessmentResult } from "../../../contracts/assessmentDelivery";
import { SatCompleteScreen } from "../SatCompleteScreen";

function result(overrides: Partial<AssessmentResult> = {}): AssessmentResult {
  return {
    id: "result-1",
    submissionId: "attempt-1",
    providerKey: "sat",
    totalScore: 1180,
    scorePayload: {},
    scoreKind: "practice",
    sections: [
      {
        sectionKey: "reading-writing",
        route: "lower",
        rawCorrect: 20,
        operationalQuestionCount: 27,
        scaledScore: 560,
        details: {},
      },
      {
        sectionKey: "math",
        route: "higher",
        rawCorrect: 22,
        operationalQuestionCount: 27,
        scaledScore: 620,
        details: {},
      },
    ],
    ...overrides,
  };
}

describe("SatCompleteScreen", () => {
  it("shows completion messaging without scores for a full sitting", () => {
    render(<SatCompleteScreen result={result()} onExit={vi.fn()} />);
    expect(screen.getByRole("heading", { name: SAT_COPY.transitions.completeTitle })).toBeInTheDocument();
    expect(screen.getByText(SAT_COPY.transitions.completeSubtitle)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: SAT_COPY.transitions.backToDashboard })).toBeInTheDocument();
    expect(screen.queryByText("1180")).not.toBeInTheDocument();
    expect(screen.queryByText("560")).not.toBeInTheDocument();
    expect(screen.queryByText("620")).not.toBeInTheDocument();
  });

  it("shows completion messaging without a score for a one-section Student Link", () => {
    render(
      <SatCompleteScreen
        result={result({
          totalScore: null,
          sections: [
            {
              sectionKey: "reading-writing",
              route: "lower",
              rawCorrect: 20,
              operationalQuestionCount: 27,
              scaledScore: 560,
              details: {},
            },
          ],
        })}
        onExit={vi.fn()}
      />,
    );

    expect(screen.getByText(SAT_COPY.transitions.completeSubtitle)).toBeInTheDocument();
    expect(screen.queryByText("560")).not.toBeInTheDocument();
    expect(screen.queryByText(/section score|practice result/i)).not.toBeInTheDocument();
  });

  it("shows completion messaging without scores when no result is available", () => {
    render(
      <SatCompleteScreen result={null} onExit={vi.fn()} />,
    );
    expect(screen.getByText(SAT_COPY.transitions.completeTitle)).toBeInTheDocument();
    expect(screen.getByText(SAT_COPY.transitions.completeSubtitle)).toBeInTheDocument();
    expect(screen.queryByText(/score/i)).not.toBeInTheDocument();
  });

  it("shows no alert region on the completed screen", () => {
    // The unsynced-draft warning used to live here; quarantined drafts are
    // routine during finalization, so the terminal surface stays free of alert
    // regions rather than decorating a clean sitting with one.
    render(<SatCompleteScreen result={result()} onExit={vi.fn()} />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
