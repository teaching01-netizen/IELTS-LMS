import React from 'react';
import { useLocation } from 'react-router-dom';
import { AdminScheduling } from '@components/admin/AdminScheduling';
import { useAdminContext } from './AdminContext';

/**
 * Scheduling Route
 * 
 * Handles exam schedule management including creating, updating, deleting,
 * and starting scheduled sessions.
 */
export function SchedulingRoute() {
  const location = useLocation();
  const { schedules, exams, examEntities, onCreateSchedule, onUpdateSchedule, onDeleteSchedule, onStartScheduledSession } = useAdminContext();
  const initialScheduleDraft = (
    location.state as {
      initialScheduleDraft?: {
        examId?: string;
        openCreateModal?: boolean;
      };
    } | null
  )?.initialScheduleDraft;
  const initialExamId = initialScheduleDraft?.examId;
  const autoOpenCreate = initialScheduleDraft?.openCreateModal;

  return (
    <AdminScheduling
      schedules={schedules}
      exams={exams}
      examEntities={examEntities}
      onCreateSchedule={onCreateSchedule}
      onUpdateSchedule={onUpdateSchedule}
      onDeleteSchedule={onDeleteSchedule}
      onStartScheduledSession={onStartScheduledSession}
      {...(initialExamId ? { initialExamId } : {})}
      {...(autoOpenCreate !== undefined ? { autoOpenCreate } : {})}
    />
  );
}
