import { useMemo } from "react";
import { useAssessmentReleaseState } from "../../api/assessmentQueries";
import { useOptionalAuthSession } from "../../../auth/api/authSession";
import { canViewExamResponses, describeExamLifecycle, type DeliveryTarget, type ExamLifecycleCopy } from "./examLifecycle";

export interface ExamWorkspaceChrome {
  lifecycle: ExamLifecycleCopy;
  showResponses: boolean;
  /**
   * Staff who may create rooms (the server gate: admin and builder). Creating a
   * room needs no prior publication: it captures the latest saved exam.
   */
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
      canCreateSession: role === "admin" || role === "builder",
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
