import React from 'react';
import { AdminScheduling } from '@components/admin/AdminScheduling';
import { useAdminContext } from './AdminContext';

/**
 * Scheduling Route
 * 
 * Handles exam schedule management including creating, updating, deleting,
 * and starting scheduled sessions.
 */
export function SchedulingRoute() {
  const { schedules, exams, examEntities, onCreateSchedule, onUpdateSchedule, onDeleteSchedule, onStartScheduledSession } = useAdminContext();
  return (
    <AdminScheduling
      schedules={schedules}
      exams={exams}
      examEntities={examEntities}
      onCreateSchedule={onCreateSchedule}
      onUpdateSchedule={onUpdateSchedule}
      onDeleteSchedule={onDeleteSchedule}
      onStartScheduledSession={onStartScheduledSession}
    />
  );
}
