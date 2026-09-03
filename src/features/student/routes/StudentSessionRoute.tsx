import React from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { StudentAppWrapper } from '@components/student/StudentAppWrapper';
import { ErrorSurface, LoadingSurface } from '@components/ui';
import { useAuthSession } from '../../auth/api/authSession';
import { useStudentSessionRouteData } from '@student/hooks/useStudentSessionRouteData';
import { SatStudentSessionRoute } from '../../student-delivery/routes/SatStudentSessionRoute';

/**
 * Student Session Route
 *
 * Active student delivery is schedule-backed and keeps pre-check/lobby/exam/complete
 * as internal runtime phases inside a single route module.
 */
export function StudentSessionRoute() {
  const { scheduleId, studentId } = useParams<{ scheduleId: string; studentId?: string }>();
  const navigate = useNavigate();
  const { logoutAll } = useAuthSession();
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
  } =
    useStudentSessionRouteData(scheduleId, studentId);

  const navigateToStudentCheckIn = async () => {
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

  if (isLoading) {
    return <LoadingSurface label="Loading Exam…" />;
  }

  if (error) {
    const isInvalidAccessCode = error.toLowerCase().includes('invalid wcode');
    const isSessionExpired =
      error.toLowerCase().includes('authentication is required') ||
      error.toLowerCase().includes('unauthorized');
    return (
      <ErrorSurface
        title={
          isInvalidAccessCode
            ? 'Wcode invalid'
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

    const v2DurabilityEnabled =
      String(import.meta.env['VITE_USE_V2_DURABILITY_ENGINE'] ?? 'false') === 'true' &&
      attemptSnapshot.protocolVersion === 2;
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
        useV2DurabilityEngine={v2DurabilityEnabled}
        onExit={navigateToStudentCheckIn}
      />
    );
  }

  const v2DurabilityEnabled =
    String(import.meta.env['VITE_USE_V2_DURABILITY_ENGINE'] ?? 'false') === 'true' &&
    attemptSnapshot?.protocolVersion === 2;

  return (
    <StudentAppWrapper
      state={state}
      onExit={navigateToStudentCheckIn}
      scheduleId={scheduleId}
      attemptSnapshot={attemptSnapshot}
      onRuntimeRefresh={refreshRuntime}
      runtimeSnapshot={runtimeSnapshot}
      answerInvariantRollout={answerInvariantRollout}
      useV2DurabilityEngine={v2DurabilityEnabled}
      showSubmitControls={false}
      allowExitDuringExam={false}
    />
  );
}
