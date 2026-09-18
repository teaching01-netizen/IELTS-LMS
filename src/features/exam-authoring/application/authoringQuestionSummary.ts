import type { AssessmentQuestionSummary, QuestionRevision } from "../contracts/assessment";
import {
  hasStructuredContent,
  plainTextFromContent,
  supportsFastPlainEditing,
} from "../editor/richContent";
import { validateSatQuestion } from "../providers/sat/satProvider";

// The queue row's projection of a saved revision.
//
// This is a domain transformation, not a view concern: the readiness status it
// derives is the SAME provider validation the backend enforces at publish time,
// and the writer that installs a saved revision into the cache needs it. It
// lives in `application/` (rather than beside the presentational surfaces that
// used to own it) so the cache-effect owner can install a saved question
// without the effects module reaching into `ui/`.

export function summaryFromRevision(
  summary: AssessmentQuestionSummary,
  question: QuestionRevision
): AssessmentQuestionSummary {
  const issues = validateSatQuestion(question.metadata.sectionKey, question);
  const blockingIssueCount = issues.filter((issue) => issue.blocking).length;
  const hasInvalid = issues.some(
    (issue) =>
      issue.blocking && !issue.code.endsWith(".required") && issue.code !== "sat.choice.count"
  );
  const readiness = blockingIssueCount === 0 ? "ready" : hasInvalid ? "error" : "incomplete";
  const answerKeyPreview =
    question.answer.kind === "single_choice"
      ? question.answer.correctOptionId
      : (question.answer.acceptedResponses.find((value) => value.trim()) ?? null);
  const choicePlain =
    question.answer.kind !== "single_choice" ||
    question.answer.options.every((option) => supportsFastPlainEditing(option.content));
  const contentComplexity =
    supportsFastPlainEditing(question.stimulus) &&
    supportsFastPlainEditing(question.prompt) &&
    supportsFastPlainEditing(question.rationale) &&
    choicePlain
      ? "plain"
      : "rich";
  return {
    ...summary,
    questionRevisionId: question.id,
    questionType: question.questionType,
    revision: question.revision,
    semanticRevision: question.semanticRevision,
    promptPreview: truncatePreview(plainTextFromContent(question.prompt), 180),
    answerKeyPreview,
    domain: question.metadata.domain,
    skill: question.metadata.skill,
    difficulty: question.metadata.difficulty,
    tags: question.metadata.tags,
    hasStimulus: hasStructuredContent(question.stimulus),
    contentComplexity,
    readiness: {
      status: readiness,
      blockingIssueCount,
      warningCount: issues.filter((issue) => !issue.blocking).length,
    },
  };
}

export function truncatePreview(value: string, limit: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length <= limit
    ? normalized
    : `${normalized.slice(0, Math.max(0, limit - 1))}…`;
}
