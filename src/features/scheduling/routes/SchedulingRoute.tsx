import React from 'react';
import { useLocation } from 'react-router-dom';
import { ErrorSurface } from '@components/ui/ErrorSurface';
import { LoadingSurface } from '@components/ui/LoadingSurface';
import { useExamListQuery } from '../../exam-authoring/api/examQueries';
import {
  getScheduleVersion,
  getPlannedDuration,
  resolveScheduleWindow,
  useDeleteScheduleMutation,
  useSaveScheduleMutation,
  useScheduleListQuery,
  useStartScheduleMutation,
} from '../api/scheduleQueries';
import { Scheduling } from '../ui/Scheduling/Scheduling';

export function SchedulingRoute() {
  const location = useLocation();
  const scheduleQuery = useScheduleListQuery();
  const examListQuery = useExamListQuery();
  const saveScheduleMutation = useSaveScheduleMutation();
  const deleteScheduleMutation = useDeleteScheduleMutation();
  const startScheduleMutation = useStartScheduleMutation();
  const initialScheduleDraft = (
    location.state as {
      initialScheduleDraft?: {
        examId?: string;
        openCreateModal?: boolean;
      };
    } | null
  )?.initialScheduleDraft;

  if (scheduleQuery.isLoading || examListQuery.isLoading) {
    return <LoadingSurface label="Loading scheduling data..." />;
  }

  if (scheduleQuery.error || examListQuery.error) {
    const error = scheduleQuery.error ?? examListQuery.error;
    return (
      <ErrorSurface
        title="Unable to load scheduling data"
        description={error instanceof Error ? error.message : 'The scheduling data could not be loaded.'}
        actionLabel="Retry"
        onAction={() => {
          void scheduleQuery.refetch();
          void examListQuery.refetch();
        }}
      />
    );
  }

  return (
    <Scheduling
      schedules={scheduleQuery.data ?? []}
      exams={examListQuery.data?.exams ?? []}
      examEntities={examListQuery.data?.entities ?? []}
      onCreateSchedule={(schedule) => saveScheduleMutation.mutateAsync(schedule)}
      onUpdateSchedule={(schedule) => saveScheduleMutation.mutateAsync(schedule)}
      onDeleteSchedule={(scheduleId) => deleteScheduleMutation.mutateAsync(scheduleId).then(() => undefined)}
      onStartScheduledSession={(scheduleId) => startScheduleMutation.mutateAsync(scheduleId).then(() => undefined)}
      getVersionById={getScheduleVersion}
      resolveScheduleWindow={resolveScheduleWindow}
      getPlannedDuration={getPlannedDuration}
      {...(initialScheduleDraft?.examId ? { initialExamId: initialScheduleDraft.examId } : {})}
      {...(initialScheduleDraft?.openCreateModal !== undefined
        ? { autoOpenCreate: initialScheduleDraft.openCreateModal }
        : {})}
    />
  );
}
