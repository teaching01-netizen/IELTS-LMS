import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ProctorApp } from '@components/proctor/ProctorApp';
import { ErrorSurface, LoadingSurface } from '@components/ui';
import { useProctorRouteController } from '@proctor/hooks/useProctorRouteController';

/**
 * ProctorRoot Route
 *
 * Active proctor delivery owns both monitoring and schedule-scoped automatic
 * violation-response configuration.
 */
export function ProctorRoot() {
  const navigate = useNavigate();
  const {
    alerts,
    auditLogs,
    degradedLiveMode,
    error,
    isLoading,
    lastSuccessfulRefreshAt,
    notes,
    wsConnected,
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
    setViolationRules,
    setSessions,
    violationRules,
  } = useProctorRouteController();

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
      violationRules={violationRules}
      connectionError={error}
      degradedLiveMode={degradedLiveMode}
      wsConnected={wsConnected}
      lastSuccessfulRefreshAt={lastSuccessfulRefreshAt}
      selectedScheduleId={selectedScheduleId}
      onSelectScheduleId={setSelectedScheduleId}
      onExit={() => navigate('/admin')}
      onSwitchToSat={() => navigate('/sat/sessions')}
      onUpdateSessions={setSessions}
      onUpdateAlerts={setAlerts}
      onUpdateNotes={setNotes}
      onUpdateRules={setViolationRules}
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
