import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ProctorApp } from '@components/proctor/ProctorApp';
import { ErrorSurface, LoadingSurface } from '@components/ui';
import { useProctorRouteController } from '@proctor/hooks/useProctorRouteController';

/**
 * ProctorRoot Route
 *
 * Active proctor delivery is a single monitoring route. In-progress settings
 * are intentionally excluded from the active route tree until they own real UI.
 */
export function ProctorRoot() {
  const navigate = useNavigate();
  const {
    alerts,
    error,
    isLoading,
    runtimeSnapshots,
    schedules,
    sessions,
    handleCompleteExam,
    handleEndSectionNow,
    handleExtendCurrentSection,
    handlePauseCohort,
    handleResumeCohort,
    handleStartScheduledSession,
    reload,
    setAlerts,
    setSessions,
  } = useProctorRouteController();

  if (isLoading) {
    return <LoadingSurface label="Loading Proctor..." />;
  }

  if (error) {
    return (
      <ErrorSurface
        title="Loading Error"
        description={error}
        actionLabel="Retry"
        onAction={() => {
          void reload();
        }}
      />
    );
  }

  return (
    <ProctorApp
      schedules={schedules}
      runtimeSnapshots={runtimeSnapshots}
      sessions={sessions}
      alerts={alerts}
      onExit={() => navigate('/admin')}
      onUpdateSessions={setSessions}
      onUpdateAlerts={setAlerts}
      onStartScheduledSession={handleStartScheduledSession}
      onPauseCohort={handlePauseCohort}
      onResumeCohort={handleResumeCohort}
      onEndSectionNow={handleEndSectionNow}
      onExtendCurrentSection={handleExtendCurrentSection}
      onCompleteExam={handleCompleteExam}
    />
  );
}
