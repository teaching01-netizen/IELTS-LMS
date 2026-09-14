import { useQuery } from "@tanstack/react-query";
import { gradingGateway } from "../../grading/api/gradingGateway";
import type {
  ObjectiveQuestionResult,
  SectionSubmission,
  StudentResult,
  StudentSubmission,
  WritingTaskSubmission,
} from "../../../types/grading";

export interface IeltsModuleRaw {
  key: string;
  label: string;
  correct: number | null;
  total: number | null;
  percentage: number | null;
  status: string;
  overrideCount: number;
  unansweredCount: number;
}

export interface IeltsQuestionRow {
  questionId: string;
  section: string;
  displayOrder: number;
  studentAnswer: unknown;
  correctAnswer: unknown;
  /** Null = unanswered, missing key, or unscored section. Never render null as incorrect. */
  isCorrect: boolean | null;
  awardedScore: number | null;
  maxScore: number | null;
  hasOverride: boolean;
  answered: boolean;
}

export interface IeltsResultDetail {
  submission: StudentSubmission | null;
  sections: SectionSubmission[];
  writingTasks: WritingTaskSubmission[];
  snapshot: StudentResult | null;
  modules: IeltsModuleRaw[];
  questions: IeltsQuestionRow[];
}

export const ieltsResultKeys = {
  all: ["results", "ielts"] as const,
  detail: (submissionId: string) =>
    [...ieltsResultKeys.all, "detail", submissionId] as const,
};

function toFiniteNumber(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value;
}

function questionAnswered(answer: unknown): boolean {
  if (answer === null || answer === undefined) return false;
  if (typeof answer === "string") return answer.trim() !== "";
  if (Array.isArray(answer)) return answer.length > 0;
  if (typeof answer === "object") return Object.keys(answer as Record<string, unknown>).length > 0;
  return true;
}

function deriveQuestionRow(
  section: string,
  index: number,
  row: ObjectiveQuestionResult,
): IeltsQuestionRow {
  const answered = questionAnswered(row.studentAnswer);
  // Null-verdict rule mirrors the backend: unanswered rows stay null even
  // when a key exists; key-less rows stay null even when answered. Key
  // presence is judged on the answer key itself, never on maxScore (a
  // scorable question with an empty key is still key-less).
  const hasKey =
    row.correctAnswer !== null &&
    row.correctAnswer !== undefined &&
    (typeof row.correctAnswer !== "string" || row.correctAnswer.trim() !== "");
  let isCorrect: boolean | null = null;
  if (answered && hasKey && typeof row.isCorrect === "boolean") {
    isCorrect = row.isCorrect;
  }
  return {
    questionId: row.questionId,
    section,
    displayOrder: index + 1,
    studentAnswer: row.studentAnswer,
    correctAnswer: row.correctAnswer,
    isCorrect,
    awardedScore: toFiniteNumber(row.awardedScore),
    maxScore: toFiniteNumber(row.maxScore),
    hasOverride: row.hasOverride === true,
    answered,
  };
}

export function buildIeltsResultDetail(args: {
  submission: StudentSubmission | null;
  sections: SectionSubmission[];
  writingTasks: WritingTaskSubmission[];
  snapshot: StudentResult | null;
}): IeltsResultDetail {
  const modules: IeltsModuleRaw[] = [];
  const questions: IeltsQuestionRow[] = [];
  for (const section of args.sections) {
    const results = section.autoGradingResults;
    const rows = results?.questionResults ?? [];
    let correct: number | null = null;
    let total: number | null = null;
    let percentage: number | null = null;
    if (results && Number.isFinite(results.totalScore) && Number.isFinite(results.maxScore)) {
      correct = results.totalScore;
      total = results.maxScore;
      percentage = results.maxScore > 0 ? (results.totalScore / results.maxScore) * 100 : null;
    } else if (rows.length > 0) {
      // Fallback when aggregates are missing but per-question rows exist:
      // count verdicts, keep null when nothing is decidable.
      let decided = 0;
      let hits = 0;
      for (const row of rows) {
        const derived = deriveQuestionRow(section.section, 0, row);
        if (derived.isCorrect !== null) {
          decided += 1;
          if (derived.isCorrect) hits += 1;
        }
      }
      if (decided > 0) {
        correct = hits;
        total = decided;
        percentage = decided > 0 ? (hits / decided) * 100 : null;
      }
    }
    let overrideCount = 0;
    let unansweredCount = 0;
    rows.forEach((row, index) => {
      const derived = deriveQuestionRow(section.section, index, row);
      questions.push(derived);
      if (derived.hasOverride) overrideCount += 1;
      if (!derived.answered) unansweredCount += 1;
    });
    modules.push({
      key: section.section,
      label: section.section.charAt(0).toUpperCase() + section.section.slice(1),
      correct,
      total,
      percentage,
      status: section.gradingStatus,
      overrideCount,
      unansweredCount,
    });
  }
  return {
    submission: args.submission,
    sections: args.sections,
    writingTasks: args.writingTasks,
    snapshot: args.snapshot,
    modules,
    questions,
  };
}

async function fetchIeltsResultDetail(submissionId: string): Promise<IeltsResultDetail> {
  const [submission, sections, writingTasks] = await Promise.all([
    gradingGateway.repository.getSubmissionById(submissionId),
    gradingGateway.repository.getSectionSubmissionsBySubmissionId(submissionId),
    gradingGateway.repository.getWritingSubmissionsBySubmissionId(submissionId),
  ]);
  let snapshot: StudentResult | null = null;
  try {
    const results =
      await gradingGateway.repository.getStudentResultsBySubmission(submissionId);
    snapshot = results[0] ?? null;
  } catch {
    snapshot = null;
  }
  return buildIeltsResultDetail({ submission, sections, writingTasks, snapshot });
}

export function useIeltsResultDetailQuery(submissionId?: string | null, enabled = true) {
  return useQuery({
    queryKey: submissionId
      ? ieltsResultKeys.detail(submissionId)
      : [...ieltsResultKeys.all, "detail", "none"],
    queryFn: () => fetchIeltsResultDetail(submissionId as string),
    enabled: enabled && Boolean(submissionId),
    staleTime: 15_000,
    gcTime: 2 * 60_000,
  });
}
