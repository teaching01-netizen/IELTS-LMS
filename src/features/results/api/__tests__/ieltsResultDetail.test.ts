import { describe, expect, it } from "vitest";
import { buildIeltsResultDetail } from "../ieltsResultDetail";
import type { SectionSubmission } from "../../../../types/grading";

function section(section: string, rows: any[]): SectionSubmission {
  return {
    id: `${section}-1`,
    submissionId: "sub-1",
    section: section as SectionSubmission["section"],
    answers: { type: section } as any,
    autoGradingResults: {
      totalScore: 0,
      maxScore: rows.length,
      percentage: 0,
      questionResults: rows,
      generatedAt: new Date().toISOString(),
    },
    gradingStatus: "auto_graded",
    submittedAt: new Date().toISOString(),
  };
}

describe("buildIeltsResultDetail", () => {
  it("keeps unanswered and key-less rows at a null verdict", () => {
    const detail = buildIeltsResultDetail({
      submission: null,
      sections: [
        section("listening", [
          { questionId: "L1", studentAnswer: "A", correctAnswer: "A", isCorrect: true, awardedScore: 1, maxScore: 1, scoringRule: "exact", hasOverride: false },
          { questionId: "L2", studentAnswer: "", correctAnswer: "B", isCorrect: false, awardedScore: 0, maxScore: 1, scoringRule: "exact", hasOverride: false },
          { questionId: "L3", studentAnswer: "X", correctAnswer: "", isCorrect: true, awardedScore: 1, maxScore: 1, scoringRule: "exact", hasOverride: false },
        ]),
      ],
      writingTasks: [],
      snapshot: null,
    });
    const byId = Object.fromEntries(detail.questions.map((row) => [row.questionId, row]));
    expect(byId["L1"]?.isCorrect).toBe(true);
    // Unanswered stays null even though the backend row claimed false.
    expect(byId["L2"]?.isCorrect).toBeNull();
    expect(byId["L2"]?.answered).toBe(false);
    // Key-less stays null even though answered.
    expect(byId["L3"]?.isCorrect).toBeNull();
    expect(detail.modules[0]?.overrideCount).toBe(0);
    expect(detail.modules[0]?.unansweredCount).toBe(1);
  });
});
