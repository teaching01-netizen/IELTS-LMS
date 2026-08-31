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
    auditLogs,
    error,
    isLoading,
    notes,
    runtimeSnapshots,
    schedules,
    scheduleMetrics,
    sessions,
    selectedScheduleId,
    setSelectedScheduleId,
    handleCompleteExam,
    handleEndSectionNow,
    handleExtendCurrentSection,
    handlePauseCohort,
    handleResumeCohort,
    handleStartScheduledSession,
    reload,
    setAlerts,
    setNotes,
    setSessions,
  } = useProctorRouteController({ providerKey: 'ielts' });

  if (isLoading) {
    return <LoadingSurface label="Loading Proctor..." />;
  }

  if (error && schedules.length === 0 && runtimeSnapshots.length === 0) {
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
      scheduleMetrics={scheduleMetrics}
      sessions={sessions}
      alerts={alerts}
      auditLogs={auditLogs}
      notes={notes}
      connectionError={error}
      selectedScheduleId={selectedScheduleId}
      onSelectScheduleId={setSelectedScheduleId}
      onExit={() => navigate('/admin')}
      onSwitchToSat={() => navigate('/sat/sessions')}
      onUpdateSessions={setSessions}
      onUpdateAlerts={setAlerts}
      onUpdateNotes={setNotes}
      onStartScheduledSession={handleStartScheduledSession}
      onPauseCohort={handlePauseCohort}
      onResumeCohort={handleResumeCohort}
      onEndSectionNow={handleEndSectionNow}
      onExtendCurrentSection={handleExtendCurrentSection}
      onCompleteExam={handleCompleteExam}
      onOpenAnswerHistory={(attemptId) => navigate(`/proctor/answer-history/${attemptId}`)}
    />
  );
}
