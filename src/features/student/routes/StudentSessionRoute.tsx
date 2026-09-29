import React from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { ErrorSurface, LoadingSurface } from '@components/ui';
import { useAuthSession } from '../../auth/api/authSession';
import { useStudentSessionRouteData } from '@student/hooks/useStudentSessionRouteData';
import { SatLoadingSurface } from '../../student-delivery/api/satStateSurfaces';
import { StudentExamInteractionScopeProvider } from '@shared/ui/touch-selection/StudentExamInteractionScope';
import { StudentTouchSelectionDiagnosticsProvider } from '@shared/ui/touch-selection/StudentTouchSelectionDiagnostics';
const SatStudentDeliveryBranch = React.lazy(() =>
  import('./SatStudentDeliveryBranch').then((module) => ({ default: module.SatStudentDeliveryBranch })),
);
const IeltsStudentDeliveryBranch = React.lazy(() =>
  import('./IeltsStudentDeliveryBranch').then((module) => ({ default: module.IeltsStudentDeliveryBranch })),
);

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

  const navigateToStudentCheckIn = () => {
    void import('../../student-delivery/api/satResumeLocator')
      .then(({ clearSatResumeLocator }) => clearSatResumeLocator())
      .catch(() => {
        // The check-in route must stay reachable if a lazy SAT utility chunk fails to load.
      });
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
      <StudentExamInteractionScopeProvider ownedTouchSelection>
        <StudentTouchSelectionDiagnosticsProvider enabled={diagnosticsEnabled}>
          <React.Suspense fallback={<SatLoadingSurface kind="initial" label="Loading Digital SAT…" />}>
            <SatStudentDeliveryBranch
              scheduleId={scheduleId}
              attemptSnapshot={attemptSnapshot}
              runtimeSnapshot={runtimeSnapshot}
              liveSocketConnected={liveSocketConnected}
              satAttemptUpdateToken={satAttemptUpdateToken}
              satBootstrapSeed={satBootstrapSeed}
              onExit={navigateToStudentCheckIn}
            />
          </React.Suspense>
        </StudentTouchSelectionDiagnosticsProvider>
      </StudentExamInteractionScopeProvider>
    );
  }

  return (
    <StudentExamInteractionScopeProvider ownedTouchSelection>
      <StudentTouchSelectionDiagnosticsProvider enabled={diagnosticsEnabled}>
        <React.Suspense fallback={<LoadingSurface label="Loading Exam…" />}>
          <IeltsStudentDeliveryBranch
            state={state}
            onExit={handleCompletedExit}
            scheduleId={scheduleId}
            attemptSnapshot={attemptSnapshot}
            refreshRuntime={refreshRuntime}
            runtimeSnapshot={runtimeSnapshot}
            answerInvariantRollout={answerInvariantRollout}
          />
        </React.Suspense>
      </StudentTouchSelectionDiagnosticsProvider>
    </StudentExamInteractionScopeProvider>
  );
}
