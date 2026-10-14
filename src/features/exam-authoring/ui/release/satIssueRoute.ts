import type { AssessmentValidationIssue } from "../../contracts/assessment";
import {
  publishModuleDeepLink,
  resolvePublishIssueDestination,
} from "./releaseSelectors";
import { examWorkspacePath } from "../shell/examLifecycle";

/**
 * Where a create-room finding sends the author, as an in-app path, or null when
 * the finding names nothing that can be opened. `needsDraft` tells the caller
 * to arm the one-shot "continue editing" gesture before navigating, because
 * opening a question or module is an explicit request to edit.
 */
export function satIssueRoute(
  examId: string,
  issue: Pick<AssessmentValidationIssue, "path" | "code">,
): { path: string; needsDraft: boolean } | null {
  const destination = resolvePublishIssueDestination(issue, null);
  if (destination.kind === "unresolved") return null;
  // Converter findings are fixed in Settings (Results & scoring).
  if (destination.kind === "score-policy") {
    return { path: `${examWorkspacePath(examId, "settings")}?panel=scoring`, needsDraft: false };
  }
  const params = new URLSearchParams();
  if (destination.kind === "question") {
    params.set("question", destination.questionId);
    if (destination.field) params.set("field", destination.field);
  } else {
    params.set("module", publishModuleDeepLink(destination));
  }
  return { path: `${examWorkspacePath(examId, "questions")}?${params.toString()}`, needsDraft: true };
}
