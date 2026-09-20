import React from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { StudentAppWrapper } from '@components/student/StudentAppWrapper';
import { ErrorSurface, LoadingSurface } from '@components/ui';
import { useAuthSession } from '../../auth/api/authSession';
import { useStudentSessionRouteData } from '@student/hooks/useStudentSessionRouteData';
import { SatStudentSessionRoute } from '../../student-delivery/routes/SatStudentSessionRoute';
import { SatLoadingSurface } from '../../student-delivery/api/satStateSurfaces';

/**
 * Student Session Route
 *
 * Active student delivery is schedule-backed and keeps pre-check/lobby/exam/complete
 * as internal runtime phases inside a single route module.
 */
export function StudentSessionRoute() {
  const { scheduleId, studentId } = useParams<{ scheduleId: string; studentId?: string }>();
  const navigate = useNavigate();
  const { logoutAll, status: authStatus } = useAuthSession();
  const {
    answerInvariantRollout,
    attemptSnapshot,
    error,
    isLoading,
    providerKey,
    retry,
    runtimeSnapshot,
    liveSocketConnected,
    satAttemptUpdateToken,
    state,
    refreshRuntime,
    satBootstrapSeed,
  } =
    useStudentSessionRouteData(scheduleId, studentId);

  const navigateToStudentCheckIn = () => {
    if (scheduleId) {
      navigate(`/student/${scheduleId}`);
    } else {
      navigate('/');
    }

    void logoutAll().catch(() => {
      // Route transition is already complete; auth cleanup is best-effort.
    });
  };

  const handleCompletedExit = () => {
    // ACT completion is the terminal student surface. Navigating back to the
    // check-in route after logout would immediately reload this route without
    // auth and show a misleading "Session expired" error. Keep the completed
    // surface visible so the user can close the tab after exiting.
    if (providerKey === 'act') {
      void logoutAll().catch(() => {
        // Completion is already settled; auth cleanup is best-effort.
      });
      return;
    }
    navigateToStudentCheckIn();
  };

  // Auth window stays provider-agnostic (excluded from the flicker assertion).
  if (authStatus === 'loading' && isLoading) {
    return <LoadingSurface label="Loading Exam…" />;
  }

  // SAT-known window: NEVER the admin skeleton again (single-surface rule).
  // Static resolving OR live/attempt pending (Option A): single SAT skin.
  if (isLoading && providerKey === 'sat') {
    return <SatLoadingSurface kind="initial" label="Loading Digital SAT…" />;
  }

  // Provider not yet known (static snapshot still resolving): NEITHER product
  // skin may claim this window. A neutral blank holds the frame — no admin
  // skeleton grey, no SAT spinner — until the provider resolves, so a SAT
  // cold open can never flash IELTS chrome. Single sr-only live region.
  if (isLoading && providerKey === 'unknown') {
    return (
      <div role="status" aria-live="polite" aria-label="Loading">
        <p className="sr-only">Loading…</p>
      </div>
    );
  }

  if (isLoading) {
    return <LoadingSurface label="Loading Exam…" />;
  }

  if (error) {
    const loweredError = error.toLowerCase();
    const isInvalidAccessCode =
      loweredError.includes('invalid wcode') || loweredError.includes('invalid access code');
    const isSessionExpired =
      error.toLowerCase().includes('authentication is required') ||
      error.toLowerCase().includes('unauthorized');
    return (
      <ErrorSurface
        title={
          isInvalidAccessCode
            ? 'Access code invalid'
            : isSessionExpired
              ? 'Session expired'
              : 'Loading Error'
        }
        description={error}
        actionLabel={isInvalidAccessCode || isSessionExpired ? 'Back to Check-in' : 'Retry'}
        onAction={
          isInvalidAccessCode || isSessionExpired
            ? navigateToStudentCheckIn
            : () => void retry()
        }
      />
    );
  }

  // Settled with an unrecognized provider: the load path normally throws the
  // unsupported-provider error first (error branch above), but never fall
  // through to the IELTS shell on an unknown provider.
  if (providerKey === 'unknown') {
    return (
      <ErrorSurface
        title="Exam Not Found"
        description="This exam uses an unsupported provider. Ask your proctor to check the published version."
        actionLabel="Back to Check-in"
        onAction={navigateToStudentCheckIn}
      />
    );
  }

  if (!state) {
    return (
      <ErrorSurface
        title="Exam Not Found"
        description="Student delivery requires a valid schedule-backed route."
        actionLabel="Back to Check-in"
        onAction={navigateToStudentCheckIn}
      />
    );
  }

  if (providerKey === 'sat') {
    // Option A: attempt id is the mount gate. While live is still pending we
    // already returned the SAT loader above, so reaching here with no attempt
    // id means the load settled with no attempt -> Back to Check-in.
    if (isLoading && !attemptSnapshot?.id) {
      return <SatLoadingSurface kind="initial" label="Loading Digital SAT…" />;
    }
    if (!scheduleId || !attemptSnapshot?.id) {
      return (
        <ErrorSurface
          title="SAT attempt unavailable"
          description="Digital SAT delivery requires a schedule-backed attempt."
          actionLabel="Back to Check-in"
          onAction={navigateToStudentCheckIn}
        />
      );
    }

    return (
      <SatStudentSessionRoute
        scheduleId={scheduleId}
        attemptId={attemptSnapshot.id}
        candidateId={attemptSnapshot.candidateId}
        attemptSnapshot={attemptSnapshot}
        runtimeSnapshot={runtimeSnapshot}
        liveSocketConnected={liveSocketConnected}
        attemptUpdateToken={satAttemptUpdateToken}
        leaseEpoch={attemptSnapshot.leaseEpoch}
        controlEpoch={attemptSnapshot.controlEpoch}
        bootstrapSeed={satBootstrapSeed}
        initialIsLoading={false}
        onExit={navigateToStudentCheckIn}
      />
    );
  }

    return (
      <StudentAppWrapper
        state={state}
        onExit={handleCompletedExit}
      scheduleId={scheduleId}
      attemptSnapshot={attemptSnapshot}
      onRuntimeRefresh={refreshRuntime}
      runtimeSnapshot={runtimeSnapshot}
      answerInvariantRollout={answerInvariantRollout}
      // Cohort/runtime-backed IELTS sessions are completed by the proctor or
      // authoritative timeout. The student can save answers but must not
      // locally advance or terminalize the shared runtime.
      showSubmitControls={false}
      allowExitDuringExam={false}
    />
  );
}
