import React from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { StudentAppWrapper } from '@components/student/StudentAppWrapper';
import { ErrorSurface, LoadingSurface } from '@components/ui';
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

  if (isLoading) {
    return <LoadingSurface label="Loading Exam..." />;
  }

  if (error) {
    return (
      <ErrorSurface
        title="Loading Error"
        description={error}
        actionLabel="Retry"
        onAction={() => {
          void retry();
        }}
      />
    );
  }

  if (!state) {
    return (
      <ErrorSurface
        title="Exam Not Found"
        description="Student delivery requires a valid schedule-backed route."
        actionLabel="Return to Admin"
        onAction={() => navigate('/admin')}
      />
    );
  }

  return (
    <StudentAppWrapper
      state={state}
      onExit={() => navigate('/admin')}
      scheduleId={scheduleId}
      attemptSnapshot={attemptSnapshot}
      onRuntimeRefresh={refreshRuntime}
      runtimeSnapshot={runtimeSnapshot}
    />
  );
}
