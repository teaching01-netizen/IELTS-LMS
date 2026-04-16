import React from 'react';
import { Clock, AlertTriangle, Pause, Play, XCircle, Check } from 'lucide-react';
import { StudentSession } from '../../types';
import { Badge } from '../ui/Badge';

interface StudentCardProps {
  session: StudentSession;
  isSelected: boolean;
  isSelectionEnabled: boolean;
  isMultiSelected: boolean;
  onClick: () => void;
  onAction: (action: 'warn' | 'pause' | 'resume' | 'terminate') => void;
  onToggleSelection: (e: React.MouseEvent) => void;
  key?: string;
}

export const StudentCard = React.memo(function StudentCard({ session, isSelected, isSelectionEnabled, isMultiSelected, onClick, onAction, onToggleSelection }: StudentCardProps) {
  const statusColors = {
    active: 'border-t-green-800',
    warned: 'border-t-amber-800',
    paused: 'border-t-blue-800',
    terminated: 'border-t-red-800',
    idle: 'border-t-gray-400',
    connecting: 'border-t-blue-800',
  };

  const formatTime = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return `${h > 0 ? h + ':' : ''}${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const initials = session.name.split(' ').map(n => n[0]).join('').toUpperCase();
  const runtimeSection = session.runtimeCurrentSection ?? session.currentSection;
  const runtimeTimeRemaining = session.runtimeTimeRemainingSeconds ?? session.timeRemaining;

  const handleAction = (e: React.MouseEvent, action: 'warn' | 'pause' | 'resume' | 'terminate') => {
    e.stopPropagation();
    onAction(action);
  };
  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onClick();
    }
  };
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

  return (
    <div 
      onClick={onClick}
      onKeyDown={handleKeyDown}
      role="button"
      tabIndex={0}
      aria-label={`Open ${session.name} session details`}
      className={`group relative bg-white rounded-sm shadow-sm border border-gray-100 border-t-4 ${statusColors[session.status]} cursor-pointer transition-all hover:shadow-md hover:-translate-y-1 ${isSelected ? 'ring-2 ring-blue-800 ring-offset-2' : ''} ${isMultiSelected ? 'ring-2 ring-blue-600 ring-offset-1' : ''}`}
    >
      <div className="p-4">
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-3">
            {isSelectionEnabled && (
              <button
                onClick={onToggleSelection}
                className={`flex-shrink-0 w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
                  isMultiSelected 
                    ? 'bg-blue-600 border-blue-600 text-white' 
                    : 'border-gray-300 hover:border-blue-600 bg-white'
                }`}
                title={isMultiSelected ? 'Deselect student' : 'Select student'}
              >
                {isMultiSelected && <Check size={14} />}
              </button>
            )}
            <div className={`w-10 h-10 rounded-sm flex items-center justify-center font-bold text-sm ${isSelected ? 'bg-blue-800 text-white' : 'bg-blue-100 text-blue-800'}`}>
              {initials}
            </div>
            <div>
              <h4 className="font-bold text-gray-900 leading-tight">{session.name}</h4>
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">{session.studentId}</p>
            </div>
          </div>
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <button 
              onClick={(e) => handleAction(e, 'warn')}
              className="p-1.5 text-amber-800 hover:bg-amber-100 rounded-sm transition-colors"
              title="Warn Student"
            >
              <AlertTriangle size={16} />
            </button>
            {session.status === 'paused' ? (
              <button 
                onClick={(e) => handleAction(e, 'resume')}
                className="p-1.5 text-green-800 hover:bg-green-100 rounded-sm transition-colors"
                title="Resume Session"
              >
                <Play size={16} />
              </button>
            ) : (
              <button 
                onClick={(e) => handleAction(e, 'pause')}
                className="p-1.5 text-blue-800 hover:bg-blue-100 rounded-sm transition-colors"
                title="Pause Session"
              >
                <Pause size={16} />
              </button>
            )}
            <button 
              onClick={(e) => handleAction(e, 'terminate')}
              className="p-1.5 text-red-800 hover:bg-red-100 rounded-sm transition-colors"
              title="Terminate Session"
            >
              <XCircle size={16} />
            </button>
          </div>
        </div>

        <div className="space-y-2 mb-4">
          <div className="flex items-center justify-between text-xs">
            <span className="text-gray-500 font-bold uppercase tracking-tight text-[10px]">Section:</span>
            <span className="text-gray-900 font-bold capitalize">{runtimeSection ?? 'Waiting'}</span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-gray-500 font-bold flex items-center gap-1 uppercase tracking-tight text-[10px]">
              <Clock size={12} /> Timer:
            </span>
            <span className={`font-mono font-bold ${runtimeTimeRemaining < 600 ? 'text-red-800' : 'text-gray-900'}`}>
              {formatTime(runtimeTimeRemaining)}
            </span>
          </div>
          {(session.runtimeStatus === 'paused' || session.runtimeWaiting) && (
            <div className="flex items-center justify-between text-xs">
              <span className="text-gray-500 font-bold uppercase tracking-tight text-[10px]">Runtime:</span>
              <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded ${session.runtimeStatus === 'paused' ? 'bg-blue-100 text-blue-800' : 'bg-amber-100 text-amber-800'}`}>
                {session.runtimeStatus === 'paused' ? 'Paused' : 'Waiting'}
              </span>
            </div>
          )}
        </div>

        <div className="pt-3 border-t border-gray-100 flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            {session.violations.length > 0 && (
              <div className="flex items-center gap-1 text-amber-800">
                <AlertTriangle size={14} />
                <span className="text-xs font-bold">{session.violations.length}</span>
              </div>
            )}
          </div>
          <Badge variant={badgeVariant}>
            {session.status}
          </Badge>
        </div>
      </div>
    </div>
  );
});
