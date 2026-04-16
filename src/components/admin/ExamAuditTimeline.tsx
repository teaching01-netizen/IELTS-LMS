import React from 'react';
import { Clock, User, GitCommit, FileText, CheckCircle2, XCircle, Copy, Archive, EyeOff, RotateCcw } from 'lucide-react';
import { ExamEvent } from '../../types/domain';
import { formatTimestamp, getRelativeTime } from '../../utils/versionUtils';

interface ExamAuditTimelineProps {
  events: ExamEvent[];
  limit?: number;
}

export function ExamAuditTimeline({ events, limit }: ExamAuditTimelineProps) {
  const displayEvents = limit ? events.slice(0, limit) : events;

  const getActionIcon = (action: ExamEvent['action']) => {
    switch (action) {
      case 'created':
        return <GitCommit size={16} className="text-blue-500" />;
      case 'draft_saved':
        return <FileText size={16} className="text-gray-500" />;
      case 'submitted_for_review':
        return <EyeOff size={16} className="text-yellow-500" />;
      case 'approved':
        return <CheckCircle2 size={16} className="text-green-500" />;
      case 'rejected':
        return <XCircle size={16} className="text-red-500" />;
      case 'published':
        return <CheckCircle2 size={16} className="text-green-600" />;
      case 'unpublished':
        return <EyeOff size={16} className="text-orange-500" />;
      case 'scheduled':
        return <Clock size={16} className="text-purple-500" />;
      case 'archived':
        return <Archive size={16} className="text-gray-400" />;
      case 'cloned':
        return <Copy size={16} className="text-blue-500" />;
      case 'version_created':
        return <GitCommit size={16} className="text-indigo-500" />;
      case 'version_restored':
        return <RotateCcw size={16} className="text-amber-500" />;
      default:
        return <FileText size={16} className="text-gray-400" />;
    }
  };

  const getActionLabel = (action: ExamEvent['action']) => {
    switch (action) {
      case 'created':
        return 'Exam created';
      case 'draft_saved':
        return 'Draft saved';
      case 'submitted_for_review':
        return 'Submitted for review';
      case 'approved':
        return 'Approved for publication';
      case 'rejected':
        return 'Rejected during review';
      case 'published':
        return 'Published';
      case 'unpublished':
        return 'Unpublished';
      case 'scheduled':
        return 'Scheduled for publication';
      case 'archived':
        return 'Archived';
      case 'cloned':
        return 'Exam cloned';
      case 'version_created':
        return 'New version created';
      case 'version_restored':
        return 'Version restored as draft';
      case 'restored':
        return 'Restored from archive';
      case 'permissions_updated':
        return 'Permissions updated';
      default:
        return action;
    }
  };

  const getActionColor = (action: ExamEvent['action']) => {
    switch (action) {
      case 'created':
        return 'bg-blue-50 border-blue-200';
      case 'draft_saved':
        return 'bg-gray-50 border-gray-200';
      case 'submitted_for_review':
        return 'bg-yellow-50 border-yellow-200';
      case 'approved':
        return 'bg-green-50 border-green-200';
      case 'rejected':
        return 'bg-red-50 border-red-200';
      case 'published':
        return 'bg-green-100 border-green-300';
      case 'unpublished':
        return 'bg-orange-50 border-orange-200';
      case 'scheduled':
        return 'bg-purple-50 border-purple-200';
      case 'archived':
        return 'bg-gray-100 border-gray-300';
      case 'cloned':
        return 'bg-blue-50 border-blue-200';
      case 'version_created':
        return 'bg-indigo-50 border-indigo-200';
      case 'version_restored':
        return 'bg-amber-50 border-amber-200';
      default:
        return 'bg-gray-50 border-gray-200';
    }
  };

  const getStatusTransitionLabel = (fromState?: string, toState?: string) => {
    if (!fromState || !toState) return null;
    return `${formatStatus(fromState)} → ${formatStatus(toState)}`;
  };

  const formatStatus = (status: string) => {
    return status.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-gray-900 uppercase tracking-widest flex items-center gap-2">
          <Clock size={16} className="text-blue-500" /> Audit Timeline
        </h3>
        <span className="text-xs text-gray-500">{events.length} event{events.length !== 1 ? 's' : ''}</span>
      </div>

      <div className="space-y-3">
        {displayEvents.map((event, idx) => (
          <div key={event.id} className="relative pl-6">
            {/* Timeline line */}
            {idx < displayEvents.length - 1 && (
              <div className="absolute left-2 top-8 bottom-0 w-0.5 bg-gray-200" />
            )}

            {/* Timeline dot */}
            <div className="absolute left-0 top-1 w-4 h-4 rounded-full bg-white border-2 border-blue-300 flex items-center justify-center">
              <div className="w-2 h-2 rounded-full bg-blue-500" />
            </div>

            {/* Event card */}
            <div className={`border rounded-lg p-3 ${getActionColor(event.action)}`}>
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-3 flex-1">
                  <div className="mt-0.5">{getActionIcon(event.action)}</div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-gray-900 text-sm">{getActionLabel(event.action)}</span>
                      {event.fromState && event.toState && (
                        <span className="text-xs text-gray-500 bg-white/50 px-2 py-0.5 rounded">
                          {getStatusTransitionLabel(event.fromState, event.toState)}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
                      <span className="flex items-center gap-1">
                        <User size={12} />
                        {event.actor}
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock size={12} />
                        {getRelativeTime(event.timestamp)}
                      </span>
                    </div>
                    {event.payload && Object.keys(event.payload).length > 0 && (
                      <div className="mt-2 p-2 bg-white/60 rounded text-xs">
                        {Object.entries(event.payload).map(([key, value]) => (
                          <div key={key} className="flex items-center gap-2">
                            <span className="font-medium text-gray-600">{key}:</span>
                            <span className="text-gray-700">{typeof value === 'object' ? JSON.stringify(value) : String(value)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                <div className="text-xs text-gray-400 whitespace-nowrap">
                  {formatTimestamp(event.timestamp)}
                </div>
              </div>
            </div>
          </div>
        ))}

        {displayEvents.length === 0 && (
          <div className="text-center py-8 text-gray-400 text-sm">
            No audit events found
          </div>
        )}
      </div>

      {limit && events.length > limit && (
        <div className="text-center pt-2">
          <button className="text-sm text-blue-600 hover:text-blue-700 font-medium">
            View all {events.length} events
          </button>
        </div>
      )}
    </div>
  );
}
