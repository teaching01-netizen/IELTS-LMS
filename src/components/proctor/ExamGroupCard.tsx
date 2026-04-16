import React from 'react';
import { Users, Clock, ChevronRight, MessageSquare } from 'lucide-react';
import { ExamGroup } from '../../types';

interface ExamGroupCardProps {
  group: ExamGroup;
  onClick: () => void;
  hasNotes?: boolean;
  key?: string;
}

export const ExamGroupCard = React.memo(function ExamGroupCard({ group, onClick, hasNotes = false }: ExamGroupCardProps) {
  const statusLabel = group.runtimeStatus === 'not_started' && group.isReadyToStart
    ? 'ready'
    : group.runtimeStatus;
  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onClick();
    }
  };

  return (
    <div 
      onClick={onClick}
      onKeyDown={handleKeyDown}
      role="button"
      tabIndex={0}
      aria-label={`Monitor ${group.examTitle} for cohort ${group.cohortName}`}
      className="bg-white rounded-sm shadow-sm border border-gray-100 p-5 cursor-pointer transition-all hover:shadow-md hover:-translate-y-1 group"
    >
      <div className="flex justify-between items-start mb-4">
        <div>
          <h3 className="text-lg font-bold text-gray-900 group-hover:text-blue-800 transition-colors">{group.examTitle}</h3>
          <p className="text-[10px] font-bold text-gray-400 flex items-center gap-1.5 mt-1 uppercase tracking-wider">
            <Clock size={12} /> {new Date(group.scheduledStartTime).toLocaleString([], { hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short' })}
          </p>
          <p className="text-[10px] text-gray-500 mt-1">Cohort {group.cohortName}</p>
        </div>
        <div className="flex items-center gap-2">
          {hasNotes && (
            <div className="p-1.5 bg-orange-100 text-orange-700 rounded-sm" title="Session has notes">
              <MessageSquare size={14} />
            </div>
          )}
          <div className={`px-2 py-1 text-[10px] font-bold rounded-sm border uppercase tracking-wider ${
            statusLabel === 'live'
              ? 'bg-emerald-100 text-emerald-800 border-emerald-200'
              : statusLabel === 'paused'
                ? 'bg-blue-100 text-blue-800 border-blue-200'
                : statusLabel === 'completed'
                  ? 'bg-gray-100 text-gray-700 border-gray-200'
                  : statusLabel === 'ready'
                    ? 'bg-blue-100 text-blue-800 border-blue-200'
                    : 'bg-amber-100 text-amber-800 border-amber-200'
          }`}>
            {statusLabel}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 py-4 border-y border-gray-50">
        <div className="text-center">
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Students</p>
          <div className="flex items-center justify-center gap-1.5 text-gray-900">
            <Users size={14} className="text-gray-400" />
            <span className="font-bold">{group.studentCount}</span>
          </div>
        </div>
        <div className="text-center">
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Live Section</p>
          <div className="text-sm font-bold text-gray-900 capitalize">
            {group.currentLiveSection ?? 'Waiting'}
          </div>
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between text-sm font-bold text-blue-800 uppercase tracking-wider">
        <span>Monitor Session</span>
        <ChevronRight size={18} className="group-hover:translate-x-1 transition-transform" />
      </div>
    </div>
  );
});
