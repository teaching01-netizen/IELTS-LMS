import React from 'react';
import { AlertTriangle, Check, Clock, MoreHorizontal, Pause, Play, XCircle } from 'lucide-react';
import { StudentSession } from '../../types';
import { Badge } from '../ui/Badge';

interface StudentCardProps {
  session: StudentSession;
  isSelected: boolean;
  isSelectionEnabled: boolean;
  isMultiSelected: boolean;
  compact?: boolean;
  onClick: () => void;
  onAction: (action: 'warn' | 'pause' | 'resume' | 'terminate') => void;
  onToggleSelection: (e: React.MouseEvent) => void;
}

export const StudentCard = React.memo(function StudentCard({
  session,
  isSelected,
  isSelectionEnabled,
  isMultiSelected,
  compact = true,
  onClick,
  onAction,
  onToggleSelection,
}: StudentCardProps) {
  const formatTime = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return `${h > 0 ? `${h}:` : ''}${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const initials = session.name.split(' ').map((part) => part[0]).join('').toUpperCase();
  const runtimeSection = session.runtimeCurrentSection ?? session.currentSection;
  const runtimeTimeRemaining = session.runtimeTimeRemainingSeconds ?? session.timeRemaining;
  const badgeVariant =
    session.status === 'active'
      ? 'success'
      : session.status === 'warned'
        ? 'warning'
        : session.status === 'paused'
          ? 'paused'
          : session.status === 'terminated'
            ? 'danger'
            : 'neutral';

  const handleAction = (event: React.MouseEvent, action: 'warn' | 'pause' | 'resume' | 'terminate') => {
    event.stopPropagation();
    onAction(action);
  };

  return (
    <div
      onClick={onClick}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onClick();
        }
      }}
      role="button"
      tabIndex={0}
      aria-label={`Open ${session.name} session details`}
      className={`group grid cursor-pointer items-center gap-3 px-4 ${compact ? 'py-3' : 'py-4'} transition ${isSelected ? 'bg-slate-50' : 'bg-white hover:bg-slate-50'} ${isMultiSelected ? 'bg-blue-50' : ''} grid-cols-[minmax(0,2fr)_minmax(0,1.1fr)_120px_120px_120px]`}
    >
      <div className="flex min-w-0 items-center gap-3">
        {isSelectionEnabled ? (
          <button
            onClick={onToggleSelection}
            className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded border transition-colors ${isMultiSelected ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-300 bg-white'}`}
            title={isMultiSelected ? 'Deselect student' : 'Select student'}
          >
            {isMultiSelected ? <Check size={13} /> : null}
          </button>
        ) : null}
        <div className={`grid h-9 w-9 flex-shrink-0 place-items-center rounded-full text-xs font-semibold ${isSelected ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-700'}`}>{initials}</div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h4 className="truncate font-medium text-slate-900">{session.name}</h4>
            {session.warnings > 0 ? <span className="text-xs text-amber-600">warn {session.warnings}</span> : null}
          </div>
          <p className="truncate text-xs text-slate-500">{session.studentId} · {session.email}</p>
        </div>
      </div>

      <div className="min-w-0">
        <p className="truncate text-sm font-medium capitalize text-slate-900">{runtimeSection ?? 'Waiting'}</p>
        <div className="mt-1 flex items-center gap-2 text-xs text-slate-500">
          <Clock size={12} />
          <span className={runtimeTimeRemaining < 600 ? 'font-medium text-red-700' : ''}>{formatTime(runtimeTimeRemaining)}</span>
          {session.runtimeWaiting ? <span>waiting</span> : null}
        </div>
      </div>

      <div>
        <Badge variant={badgeVariant}>{session.status}</Badge>
      </div>

      <div className="flex items-center gap-2 text-sm text-slate-700">
        {session.violations.length > 0 ? <AlertTriangle size={14} className="text-amber-600" /> : null}
        <span>{session.violations.length}</span>
      </div>

      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0 text-xs text-slate-500">
          <p className="truncate">{new Date(session.lastActivity).toLocaleTimeString()}</p>
        </div>
        <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          <button onClick={(event) => handleAction(event, 'warn')} className="rounded p-1 text-amber-700 hover:bg-amber-100" title="Warn Student"><AlertTriangle size={14} /></button>
          {session.status === 'paused' ? (
            <button onClick={(event) => handleAction(event, 'resume')} className="rounded p-1 text-emerald-700 hover:bg-emerald-100" title="Resume Session"><Play size={14} /></button>
          ) : (
            <button onClick={(event) => handleAction(event, 'pause')} className="rounded p-1 text-sky-700 hover:bg-sky-100" title="Pause Session"><Pause size={14} /></button>
          )}
          <button onClick={(event) => handleAction(event, 'terminate')} className="rounded p-1 text-red-700 hover:bg-red-100" title="Terminate Session"><XCircle size={14} /></button>
          <span className="rounded p-1 text-slate-300"><MoreHorizontal size={14} /></span>
        </div>
      </div>
    </div>
  );
});
