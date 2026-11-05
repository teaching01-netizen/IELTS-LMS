import React from 'react';
import { Check, ChevronRight, Clock, MessageSquare, Users } from 'lucide-react';
import { ExamGroup } from '../../types';
import { formatExamGroupScheduledStartTime } from '../../features/proctor/api/proctorRoomApi';

interface ExamGroupCardProps {
  group: ExamGroup;
  onClick: () => void;
  hasNotes?: boolean;
  /** Overview selection mode: the card toggles instead of opening the room. */
  selectionMode?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
  /** False for rooms that cannot be ended (not running/paused). */
  selectionEnabled?: boolean;
}

export const ExamGroupCard = React.memo(function ExamGroupCard({
  group,
  onClick,
  hasNotes = false,
  selectionMode = false,
  selected = false,
  onToggleSelect,
  selectionEnabled = true,
}: ExamGroupCardProps) {
  const statusLabel = group.runtimeStatus === 'not_started' && group.isReadyToStart ? 'ready' : group.runtimeStatus;
  const selectable = selectionMode && selectionEnabled;
  const selectionHint = selectionMode && !selectionEnabled ? 'This room has finished and cannot be ended.' : undefined;
  return (
    <button
      type="button"
      onClick={selectionMode ? (selectable ? onToggleSelect : undefined) : onClick}
      aria-label={
        selectionMode
          ? `${selected ? 'Deselect' : 'Select'} ${group.examTitle} for cohort ${group.cohortName}`
          : `Monitor ${group.examTitle} for cohort ${group.cohortName}`
      }
      aria-pressed={selectionMode ? selected : undefined}
      disabled={selectionMode && !selectable}
      title={selectionHint}
      className={
        'grid w-full gap-4 rounded-md border bg-white p-5 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-50 ' +
        (selected
          ? 'border-slate-950 bg-slate-50 ring-1 ring-slate-950'
          : selectionMode
            ? 'border-slate-200 ' + (selectable ? 'hover:border-slate-300 hover:bg-slate-50' : 'border-dashed opacity-60')
            : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50')
      }
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-lg font-semibold text-slate-950">{group.examTitle}</h3>
          <p className="mt-1 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">
            <Clock size={12} />
            {formatExamGroupScheduledStartTime(group.scheduledStartTime)}
          </p>
          <p className="mt-1 text-sm text-slate-500">Cohort {group.cohortName}</p>
        </div>
        <div className="flex items-center gap-2">
          {selectionMode ? (
            <span
              aria-hidden="true"
              className={
                'flex h-6 w-6 shrink-0 items-center justify-center rounded border ' +
                (selected ? 'border-slate-950 bg-slate-950 text-white' : 'border-slate-300 bg-white text-transparent')
              }
            >
              <Check size={14} strokeWidth={3} />
            </span>
          ) : null}
          {hasNotes ? <div className="rounded-sm bg-orange-100 p-1.5 text-orange-700"><MessageSquare size={14} /></div> : null}
          <div className={`rounded-sm border px-2 py-1 text-[10px] font-bold uppercase tracking-wider ${statusLabel === 'live' ? 'border-emerald-200 bg-emerald-100 text-emerald-800' : statusLabel === 'paused' ? 'border-blue-200 bg-blue-100 text-blue-800' : statusLabel === 'completed' ? 'border-slate-200 bg-slate-100 text-slate-700' : statusLabel === 'ready' ? 'border-blue-200 bg-blue-100 text-blue-800' : 'border-amber-200 bg-amber-100 text-amber-800'}`}>
            {statusLabel}
          </div>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-4 border-y border-slate-100 py-4">
        <div>
          <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">Students</p>
          <div className="flex items-center gap-1.5 text-slate-900"><Users size={14} className="text-slate-400" /><span className="font-semibold">{group.studentCount}</span></div>
          <p className="mt-1 text-[11px] font-medium text-slate-500">
            Joined {group.joinReadyCount}/{group.joinTotalCount}
          </p>
        </div>
        <div>
          <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">Live Section</p>
          <div className="text-sm font-semibold capitalize text-slate-900">{group.currentLiveSection ?? 'Waiting'}</div>
        </div>
        <div>
          <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">Violations</p>
          <div className="text-sm font-semibold text-slate-900">{group.violationCount}</div>
        </div>
      </div>
      <div className="flex items-center justify-between text-sm font-semibold uppercase tracking-wider text-slate-700">
        <span>{selectionMode ? (selected ? 'Selected' : selectable ? 'Select room' : 'Can’t end') : 'Monitor Session'}</span>
        {selectionMode ? <Check size={18} className={selected ? 'text-slate-950' : 'text-slate-300'} /> : <ChevronRight size={18} />}
      </div>
    </button>
  );
});
