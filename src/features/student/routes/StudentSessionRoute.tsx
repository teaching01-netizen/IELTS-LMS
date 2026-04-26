import React from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { StudentAppWrapper } from '@components/student/StudentAppWrapper';
import { ErrorSurface, LoadingSurface } from '@components/ui';
import { useAuthSession } from '../../auth/authSession';
import { useStudentSessionRouteData } from '@student/hooks/useStudentSessionRouteData';

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
    attemptSnapshot,
    error,
    isLoading,
    retry,
    runtimeSnapshot,
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
    const isInvalidAccessCode = error.toLowerCase().includes('invalid access code');
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

  return (
    <StudentAppWrapper
      state={state}
      onExit={navigateToStudentCheckIn}
      scheduleId={scheduleId}
      attemptSnapshot={attemptSnapshot}
      onRuntimeRefresh={refreshRuntime}
      runtimeSnapshot={runtimeSnapshot}
      showSubmitControls={false}
    />
  );
}
