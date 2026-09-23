import React from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { StudentAppWrapper } from '@components/student/StudentAppWrapper';
import { ErrorSurface, LoadingSurface } from '@components/ui';
import { useAuthSession } from '../../auth/api/authSession';
import { useStudentSessionRouteData } from '@student/hooks/useStudentSessionRouteData';
import { SatStudentSessionRoute } from '../../student-delivery/routes/SatStudentSessionRoute';
import { SatLoadingSurface } from '../../student-delivery/api/satStateSurfaces';
import { StudentExamInteractionScopeProvider } from '@shared/ui/touch-selection/StudentExamInteractionScope';
import { StudentTouchSelectionDiagnosticsProvider } from '@shared/ui/touch-selection/StudentTouchSelectionDiagnostics';
import { clearSatResumeLocator, loadSatResumeLocator, saveSatResumeLocator } from '../../student-delivery/infrastructure/satResumeLocator';
import { getVerifiedTerminalState } from '../domain/exam-session/terminalState';

/**
 * Student Session Route
 *
 * Active student delivery is schedule-backed and keeps pre-check/lobby/exam/complete
 * as internal runtime phases inside a single route module.
 *
 * This module also DECLARES the session's interaction scope, above the point
 * where the two products diverge, and it is deliberately the only place that
 * does. Reaching real delivery means the student is sitting a real, locked exam,
 * so both providers below — SAT and IELTS — get an owned selection gesture from
 * the same declaration instead of each deciding for itself.
 *
 * Nothing else is in scope, and that is the point: the loading, error, and
 * not-found surfaces above return without it, and staff preview mounts
 * `StudentAppWrapper` directly rather than through here, so a preview reads the
 * conservative default and keeps the platform's own selection.
 */
export function StudentSessionRoute() {
  const diagnosticsEnabled = new URLSearchParams(useLocation().search).get('touchSelectionDebug') === '1';
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

  React.useEffect(() => {
    if (providerKey !== 'sat' || !scheduleId || !attemptSnapshot?.id || !attemptSnapshot.candidateId) return;
    const terminal = getVerifiedTerminalState({ attempt: attemptSnapshot, runtime: runtimeSnapshot });
    if (
      terminal !== 'not_terminal' ||
      attemptSnapshot.phase === 'post-exam' ||
      attemptSnapshot.phase === 'submitted' ||
      runtimeSnapshot?.status === 'completed' ||
      runtimeSnapshot?.status === 'cancelled'
    ) {
      clearSatResumeLocator();
      return;
    }
    const prior = loadSatResumeLocator();
    saveSatResumeLocator({
      scheduleId,
      candidateId: attemptSnapshot.candidateId,
      attemptId: attemptSnapshot.id,
      ...(prior?.scheduleId === scheduleId && prior.candidateId === attemptSnapshot.candidateId && prior.accessLinkId
        ? { accessLinkId: prior.accessLinkId }
        : {}),
    });
  }, [attemptSnapshot, providerKey, runtimeSnapshot, scheduleId]);

  const navigateToStudentCheckIn = async () => {
    clearSatResumeLocator();
    try {
      await logoutAll();
    } catch {
      // Continue to the student check-in flow even if the backend logout request fails.
    }

    if (scheduleId) {
      navigate(`/student/${scheduleId}`);
      return;
    }

    navigate('/');
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
      <StudentExamInteractionScopeProvider ownedTouchSelection>
        <StudentTouchSelectionDiagnosticsProvider enabled={diagnosticsEnabled}>
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
        </StudentTouchSelectionDiagnosticsProvider>
      </StudentExamInteractionScopeProvider>
    );
  }

  return (
    <StudentExamInteractionScopeProvider ownedTouchSelection>
      <StudentTouchSelectionDiagnosticsProvider enabled={diagnosticsEnabled}>
        <StudentAppWrapper
          state={state}
          onExit={navigateToStudentCheckIn}
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
      </StudentTouchSelectionDiagnosticsProvider>
    </StudentExamInteractionScopeProvider>
  );
}
