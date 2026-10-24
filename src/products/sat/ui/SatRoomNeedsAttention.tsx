import { AlertTriangle } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { ProctorAlert, StudentSession } from '../../../types';
import { SatDeviceTransferRequests } from './SatDeviceTransferRequests';
import { SatStaffRoutePanel, type SatStaffRouteAssignment } from './SatStaffRoutePanel';
import { SatRoomSectionHeader } from './room/SatRoomSectionHeader';
import { SatRoomSurface } from './room/SatRoomSurface';

/**
 * Open work for this room in one card: current exam issues, device change
 * requests, and Module 2 choices. Each request names its student and keeps its
 * own confirmation; the device and Module 2 queues hide themselves when empty.
 */
export function SatRoomNeedsAttention({
  scheduleId,
  blocked,
  students,
  alerts,
  onSelectStudent,
  onPendingTransfersChange,
  onPendingAssignmentsChange,
}: {
  scheduleId: string;
  blocked: boolean;
  students: readonly StudentSession[];
  alerts: readonly ProctorAlert[];
  onSelectStudent: (studentId: string, trigger: HTMLElement) => void;
  onPendingTransfersChange: (attemptIds: ReadonlySet<string>) => void;
  onPendingAssignmentsChange: (assignments: readonly SatStaffRouteAssignment[]) => void;
}) {
  const currentAlerts = alerts.filter((alert) => !alert.isAcknowledged);
  const recoveryItems = students.filter((student) => student.satRecoveryPhase === 'blocked');
  const [recoveryPage, setRecoveryPage] = useState(0);
  const pageSize = 8;
  const pageCount = Math.max(1, Math.ceil(recoveryItems.length / pageSize));
  const visibleRecoveryItems = recoveryItems.slice(recoveryPage * pageSize, (recoveryPage + 1) * pageSize);
  useEffect(() => setRecoveryPage(0), [scheduleId]);
  useEffect(() => setRecoveryPage((page) => Math.min(page, pageCount - 1)), [pageCount]);

  return (
    <SatRoomSurface aria-label="Needs attention" className="p-4">
      <SatRoomSectionHeader
        title="Needs attention"
        description="Exam issues, device changes, and Module 2 choices."
        action={(
          <span className="text-[14px] font-medium tabular-nums text-[var(--sat-staff-text-tertiary,#6e6e73)]" aria-live="polite">
            {currentAlerts.length ? `${currentAlerts.length} open alert${currentAlerts.length === 1 ? '' : 's'}` : 'No open alerts'}
          </span>
        )}
      />
      {currentAlerts.length ? <ul className="mt-3 divide-y divide-[var(--sat-staff-border-hairline,rgba(0,0,0,0.06))] border-t border-[var(--sat-staff-border-hairline,rgba(0,0,0,0.06))]" aria-label="Open exam issues">
        {currentAlerts.map((alert) => {
          const student = students.find((item) => item.studentId === alert.studentId);
          return <li key={alert.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2 text-[14px] leading-5">
            <p className="flex min-w-0 flex-1 basis-40 items-start gap-2">
              <AlertTriangle size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-[var(--sat-staff-warning-dot,#d97706)]" />
              <span className="min-w-0"><strong className="font-semibold text-[var(--sat-staff-text-primary,#1d1d1f)]">{alert.studentName || 'Room issue'}:</strong> <span className="text-[var(--sat-staff-warning-text,#92400e)]">{alert.message}</span></span>
            </p>
            {student ? <button type="button" onClick={(event) => onSelectStudent(student.id, event.currentTarget)} className="sat-btn sat-btn--quiet sat-press -mr-2 shrink-0 px-3">View student</button> : null}
          </li>;
        })}
      </ul> : null}
      {recoveryItems.length ? (
        <section className="mt-3 border-t border-[var(--sat-staff-border-hairline,rgba(0,0,0,0.06))] pt-3" aria-labelledby="sat-recovery-exceptions-heading">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h3 id="sat-recovery-exceptions-heading" className="text-[14px] font-semibold text-[var(--sat-staff-text-primary,#1d1d1f)]">Expired SAT recovery</h3>
              <p className="text-[14px] text-[var(--sat-staff-text-secondary,#515154)]">{recoveryItems.length} student{recoveryItems.length === 1 ? '' : 's'} need an authorized decision.</p>
            </div>
            {pageCount > 1 ? (
              <div className="flex items-center gap-2 text-[14px]">
                <button type="button" className="sat-btn sat-btn--quiet sat-press px-2" disabled={recoveryPage === 0} onClick={() => setRecoveryPage((page) => Math.max(0, page - 1))} aria-label="Previous recovery exceptions">Previous</button>
                <span aria-live="polite">{recoveryPage + 1} of {pageCount}</span>
                <button type="button" className="sat-btn sat-btn--quiet sat-press px-2" disabled={recoveryPage >= pageCount - 1} onClick={() => setRecoveryPage((page) => Math.min(pageCount - 1, page + 1))} aria-label="Next recovery exceptions">Next</button>
              </div>
            ) : null}
          </div>
          <ul className="mt-2 divide-y divide-[var(--sat-staff-border-hairline,rgba(0,0,0,0.06))] border-t border-[var(--sat-staff-border-hairline,rgba(0,0,0,0.06))]" aria-label="Students with expired SAT recovery">
            {visibleRecoveryItems.map((student) => (
              <li key={student.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-[14px] leading-5">
                <span className="min-w-0 flex-1 basis-48">
                  <strong className="font-semibold text-[var(--sat-staff-text-primary,#1d1d1f)]">{student.name}</strong>
                  <span className="block text-[var(--sat-staff-text-secondary,#515154)]">
                    {student.satRecoveryKind === 'entry' ? 'Entry recovery expired' : 'Answer recovery expired'}
                    {student.satRecoveryModuleTitle ? ` · ${student.satRecoveryModuleTitle}` : ''}
                  </span>
                </span>
                <button type="button" onClick={(event) => onSelectStudent(student.id, event.currentTarget)} className="sat-btn sat-btn--quiet sat-press -mr-2 shrink-0 px-3">Review</button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <SatDeviceTransferRequests scheduleId={scheduleId} blocked={blocked} onPendingChange={onPendingTransfersChange} />
      <SatStaffRoutePanel scheduleId={scheduleId} blocked={blocked} onPendingAssignmentsChange={onPendingAssignmentsChange} />
    </SatRoomSurface>
  );
}
