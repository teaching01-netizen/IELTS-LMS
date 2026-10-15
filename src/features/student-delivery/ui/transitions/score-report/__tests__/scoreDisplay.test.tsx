import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ClassroomReport } from "../../SatScoreReport";
import { SatKnowledgeSkills } from "../SatKnowledgeSkills";
import { SatScoreOverview } from "../SatScoreOverview";
import { SatSubjectPerformance } from "../SatSubjectPerformance";
import { buildStudentScoreReportView } from "../scoreReportViewModel";

const unavailableMath: ClassroomReport["sections"][number] = {
  sectionKey: "math",
  rawCorrect: 34,
  total: 44,
  conversionStatus: "unavailable",
  modules: [{ moduleKey: "math-m1", rawCorrect: 20, total: 22 }],
};

describe("SAT score display", () => {
  it("renders a dash for unavailable single-subject conversion and keeps raw correctness visible", () => {
    const view = buildStudentScoreReportView({
      rawCorrect: 34,
      total: 44,
      sections: [unavailableMath],
      conversion: { converterVersion: "v1" },
      domains: [{ sectionKey: "math", domain: "Algebra", correct: 8, total: 10 }],
    });
    const { container } = render(
      <>
        <SatScoreOverview view={view} />
        <SatSubjectPerformance view={view} />
        <SatKnowledgeSkills subjects={view.subjects} />
      </>,
    );

    expect(container.querySelector('span[aria-hidden="true"]')).toHaveTextContent("-");
    expect(screen.getByText("34 of 44 scored questions correct")).toBeInTheDocument();
    expect(screen.getByText("20 of 22 correct")).toBeInTheDocument();
    expect(screen.getByText("8 of 10 · 80%")).toBeInTheDocument();
  });

  it("renders a dash in an unavailable subject slot and keeps its raw and module details", () => {
    const view = buildStudentScoreReportView({
      rawCorrect: 74,
      total: 98,
      sections: [
        { sectionKey: "reading-writing", rawCorrect: 40, total: 54, conversionStatus: "unavailable" },
        { sectionKey: "math", rawCorrect: 34, total: 44, conversionStatus: "converted", scaled: { low: 620, high: 620 } },
      ],
      conversion: { converterVersion: "v1" },
    });
    const { container } = render(<SatSubjectPerformance view={view} />);

    expect(container.querySelector('span[aria-hidden="true"]')).toHaveTextContent("-");
    expect(screen.getByText("40 of 54 scored questions correct")).toBeInTheDocument();
    expect(screen.getByText("620")).toBeInTheDocument();
  });
});
