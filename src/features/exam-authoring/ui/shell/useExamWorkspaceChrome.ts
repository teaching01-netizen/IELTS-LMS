import { useMemo } from "react";
import { useAssessmentReleaseState } from "../../api/assessmentQueries";
import { useOptionalAuthSession } from "../../../auth/api/authSession";
import { canViewExamResponses, describeExamLifecycle, type ExamLifecycleCopy } from "./examLifecycle";

export interface ExamWorkspaceChrome {
  lifecycle: ExamLifecycleCopy;
  showResponses: boolean;
  /** A published version exists, so a session can be prepared from any exam surface. */
  canCreateSession: boolean;
}

/** Data every exam surface's header needs, derived from existing queries only. */
export function useExamWorkspaceChrome(examId: string): ExamWorkspaceChrome {
  const release = useAssessmentReleaseState(examId);
  const role = useOptionalAuthSession()?.session?.user.role ?? null;
  const releaseState = release.data ?? null;
  return useMemo(
    () => ({
      lifecycle: describeExamLifecycle(releaseState),
      showResponses: canViewExamResponses(role),
      canCreateSession: Boolean(releaseState?.currentPublishedVersion),
    }),
    [releaseState, role],
  );
}
