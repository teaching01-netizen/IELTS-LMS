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
  it("shows the composite total for a full sitting", () => {
    render(<SatCompleteScreen result={result()} onExit={vi.fn()} />);
    expect(screen.getByText("1180")).toBeInTheDocument();
    expect(screen.queryByText(SAT_COPY.transitions.sectionScoreHeading)).not.toBeInTheDocument();
  });

  it("shows the section score and no total for a one-section Student Link", () => {
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

    expect(screen.getByText(SAT_COPY.transitions.sectionScoreHeading)).toBeInTheDocument();
    expect(screen.getByText(SAT_COPY.transitions.sectionLabelReadingWriting)).toBeInTheDocument();
    expect(screen.getByText("560")).toBeInTheDocument();
    expect(screen.getByText(SAT_COPY.transitions.sectionScoreOnlyNote)).toBeInTheDocument();
    // The section count comes from the payload: no Math row for a verbal-only run.
    expect(screen.queryByText(SAT_COPY.transitions.sectionLabelMath)).not.toBeInTheDocument();
  });

  it("renders nothing score-shaped when neither a total nor a section score exists", () => {
    render(
      <SatCompleteScreen
        result={result({ totalScore: null, sections: [] })}
        onExit={vi.fn()}
      />,
    );
    expect(screen.queryByText(SAT_COPY.transitions.sectionScoreHeading)).not.toBeInTheDocument();
    expect(screen.getByText(SAT_COPY.transitions.completeTitle)).toBeInTheDocument();
  });
});
