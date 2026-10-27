import React, { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { GradingSessionList } from '@components/admin/GradingSessionList';
import { GradingSessionDetail } from '@components/admin/GradingSessionDetail';
import { StudentReviewWorkspace } from '@components/admin/StudentReviewWorkspace';
import { useOptionalAuthSession } from '../../auth/api/authSession';

/** Session and submission ids as the grading API issues them; anything else is ignored. */
const GRADING_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

function readGradingId(params: URLSearchParams, key: 'session' | 'submission'): string | null {
  const value = params.get(key);
  return value && GRADING_ID.test(value) ? value : null;
}

/**
 * Grading Route
 *
 * The URL owns the selected grading session and submission
 * (`?session=…&submission=…`), so back, refresh, and shared links reopen the
 * same view. Unrelated search parameters are preserved.
 */
export function GradingRoute() {
  const [searchParams, setSearchParams] = useSearchParams();
  const sessionId = readGradingId(searchParams, 'session');
  const submissionId = readGradingId(searchParams, 'submission');

  // Real grader identity from the session (S2-C14). Never attribute grading
  // actions to a hardcoded name when no session identity exists. Missing
  // provider/session falls back to an explicit Unknown label and disables
  // release actions downstream (never a false name).
  const authSession = useOptionalAuthSession();
  const session = authSession?.session ?? null;
  const currentTeacherId = session?.user.id ?? '';
  const currentTeacherName = session?.user.displayName?.trim() || 'Unknown grader';
  const isGraderUnknown = currentTeacherId.trim() === '';

  const select = useCallback(
    (changes: { session?: string | null; submission?: string | null }) => {
      setSearchParams((current) => {
        const next = new URLSearchParams(current);
        for (const [key, value] of Object.entries(changes)) {
          if (value) next.set(key, value);
          else next.delete(key);
        }
        return next;
      });
    },
    [setSearchParams],
  );

  const handleSessionSelect = (selected: string) => select({ session: selected, submission: null });
  const handleStudentSelect = (selected: string) => select({ submission: selected });
  const handleGradingBack = () =>
    submissionId ? select({ submission: null }) : select({ session: null, submission: null });

  if (submissionId) {
    return (
      <>
        {isGraderUnknown && (
          <div role="status" className="mx-auto mt-4 max-w-3xl rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            Signed in grader identity is unavailable — showing as “Unknown grader”. Release
            actions are disabled until you sign in. No grading action will be attributed to a
            placeholder name.
          </div>
        )}
        <StudentReviewWorkspace
          submissionId={submissionId}
          onBack={handleGradingBack}
          currentTeacherId={currentTeacherId}
          currentTeacherName={currentTeacherName}
          releaseActionsDisabled={isGraderUnknown}
        />
      </>
    );
  }

  if (sessionId) {
    return (
      <GradingSessionDetail
        sessionId={sessionId}
        onBack={handleGradingBack}
        onStudentSelect={handleStudentSelect}
      />
    );
  }

  return <GradingSessionList onSessionSelect={handleSessionSelect} />;
}
