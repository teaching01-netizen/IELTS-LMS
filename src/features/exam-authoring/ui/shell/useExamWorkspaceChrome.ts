import { useMemo } from "react";
import { useAssessmentReleaseState } from "../../api/assessmentQueries";
import { useOptionalAuthSession } from "../../../auth/api/authSession";
import { canViewExamResponses, describeExamLifecycle, type DeliveryTarget, type ExamLifecycleCopy } from "./examLifecycle";

export interface ExamWorkspaceChrome {
  lifecycle: ExamLifecycleCopy;
  showResponses: boolean;
  /** A published version exists, so a session can be prepared from any exam surface. */
  canCreateSession: boolean;
  /** Authoritative current version, used for direct/reloaded published workspaces. */
  publishedTarget: DeliveryTarget | null;
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
      publishedTarget: releaseState?.currentPublishedVersion
        ? {
            versionId: releaseState.currentPublishedVersion.id,
            versionNumber: releaseState.currentPublishedVersion.versionNumber,
            publishScope: releaseState.currentPublishedVersion.publishScope,
          }
        : null,
    }),
    [releaseState, role],
  );
}
