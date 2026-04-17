import React from 'react';
import { ChevronRight, Clock, MessageSquare, Users } from 'lucide-react';
import { ExamGroup } from '../../types';

interface ExamGroupCardProps {
  group: ExamGroup;
  onClick: () => void;
  hasNotes?: boolean;
}

export const ExamGroupCard = React.memo(function ExamGroupCard({ group, onClick, hasNotes = false }: ExamGroupCardProps) {
  const statusLabel = group.runtimeStatus === 'not_started' && group.isReadyToStart ? 'ready' : group.runtimeStatus;
  return (
    <div onClick={onClick} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onClick(); } }} role="button" tabIndex={0} aria-label={`Monitor ${group.examTitle} for cohort ${group.cohortName}`} className="grid gap-4 rounded-md border border-slate-200 bg-white p-5 transition hover:border-slate-300 hover:bg-slate-50">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-lg font-semibold text-slate-950">{group.examTitle}</h3>
          <p className="mt-1 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">
            <Clock size={12} />
            {new Date(group.scheduledStartTime).toLocaleString([], { hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short' })}
          </p>
          <p className="mt-1 text-sm text-slate-500">Cohort {group.cohortName}</p>
        </div>
        <div className="flex items-center gap-2">
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
        <span>Monitor Session</span>
        <ChevronRight size={18} />
      </div>
    </div>
  );
});
