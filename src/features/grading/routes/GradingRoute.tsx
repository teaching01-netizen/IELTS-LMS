import React from 'react';
import { GradingSessionList } from '@components/admin/GradingSessionList';
import { GradingSessionDetail } from '@components/admin/GradingSessionDetail';
import { StudentReviewWorkspace } from '@components/admin/StudentReviewWorkspace';
import { AdminShellProvider, useAdminShell } from '@components/admin/providers/AdminShellProvider';
import { useOptionalAuthSession } from '../../auth/api/authSession';

/**
 * Grading Route
 *
 * Handles grading workflow including session list, session detail,
 * and student review workspace.
 */
function GradingRouteContent() {
  const { state: shellState, actions: shellActions } = useAdminShell();
  // Real grader identity from the session (S2-C14). Never attribute grading
  // actions to a hardcoded name when no session identity exists. Missing
  // provider/session falls back to an explicit Unknown label and disables
  // release actions downstream (never a false name).
  const authSession = useOptionalAuthSession();
  const session = authSession?.session ?? null;
  const currentTeacherId = session?.user.id ?? '';
  const currentTeacherName = session?.user.displayName?.trim() || 'Unknown grader';
  const isGraderUnknown = currentTeacherId.trim() === '';

  const handleSessionSelect = (sessionId: string) => {
    shellActions.selectSession(sessionId);
  };

  const handleStudentSelect = (submissionId: string) => {
    shellActions.selectSubmission(submissionId);
  };

  return (
    <>
      {shellState.gradingLevel === 'list' && (
        <GradingSessionList onSessionSelect={handleSessionSelect} />
      )}
      {shellState.gradingLevel === 'session' && shellState.selectedSessionId && (
        <GradingSessionDetail
          sessionId={shellState.selectedSessionId}
          onBack={shellActions.handleGradingBack}
          onStudentSelect={handleStudentSelect}
        />
      )}
      {shellState.gradingLevel === 'student' && shellState.selectedSubmissionId && (
        <>
          {isGraderUnknown && (
            <div role="status" className="mx-auto mt-4 max-w-3xl rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              Signed in grader identity is unavailable — showing as “Unknown grader”. Release
              actions are disabled until you sign in. No grading action will be attributed to a
              placeholder name.
            </div>
          )}
          <StudentReviewWorkspace
            submissionId={shellState.selectedSubmissionId}
            onBack={shellActions.handleGradingBack}
            currentTeacherId={currentTeacherId}
            currentTeacherName={currentTeacherName}
            releaseActionsDisabled={isGraderUnknown}
          />
        </>
      )}
    </>
  );
}

export function GradingRoute() {
  return (
    <AdminShellProvider>
      <GradingRouteContent />
    </AdminShellProvider>
  );
}
