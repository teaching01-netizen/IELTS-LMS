import React, { useState, useMemo } from 'react';
import {
  Clock,
  Download,
  Filter,
  Search,
  FileText,
  User,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Pause,
  Play,
  ArrowUpDown
} from 'lucide-react';
import { SessionAuditLog, AuditActionType } from '../../types';
import { Badge } from '../ui/Badge';

interface AuditLogPanelProps {
  auditLogs: SessionAuditLog[];
  sessionId: string;
  onClose: () => void;
}

type LogFilter = {
  actionType: AuditActionType | 'all';
  actor: string;
  targetStudentId: string;
};

type SortOption = 'timestamp' | 'action' | 'actor';

export function AuditLogPanel({ auditLogs, sessionId, onClose }: AuditLogPanelProps) {
  const [filter, setFilter] = useState<LogFilter>({
    actionType: 'all',
    actor: '',
    targetStudentId: ''
  });
  const [sortBy, setSortBy] = useState<SortOption>('timestamp');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [showFilters, setShowFilters] = useState(false);

  const filteredLogs = useMemo(() => {
    return auditLogs
      .filter(log => {
        if (log.sessionId !== sessionId) return false;
        if (filter.actionType !== 'all' && log.actionType !== filter.actionType) return false;
        if (filter.actor && !log.actor.toLowerCase().includes(filter.actor.toLowerCase())) return false;
        if (filter.targetStudentId && log.targetStudentId && !log.targetStudentId.toLowerCase().includes(filter.targetStudentId.toLowerCase())) return false;
        return true;
      })
      .sort((a, b) => {
        let comparison = 0;
        if (sortBy === 'timestamp') {
          comparison = new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
        } else if (sortBy === 'action') {
          comparison = a.actionType.localeCompare(b.actionType);
        } else if (sortBy === 'actor') {
          comparison = a.actor.localeCompare(b.actor);
        }
        return sortOrder === 'asc' ? comparison : -comparison;
      });
  }, [auditLogs, filter, sortBy, sortOrder, sessionId]);

  const actionIcons: Record<AuditActionType, React.ElementType> = {
    SESSION_START: Play,
    SESSION_PAUSE: Pause,
    SESSION_RESUME: Play,
    SESSION_END: XCircle,
    SECTION_START: CheckCircle,
    SECTION_END: XCircle,
    STUDENT_WARN: AlertTriangle,
    STUDENT_PAUSE: Pause,
    STUDENT_RESUME: Play,
    STUDENT_TERMINATE: XCircle,
    COHORT_PAUSE: Pause,
    COHORT_RESUME: Play,
    EXTENSION_GRANTED: Clock,
    ALERT_ACKNOWLEDGED: CheckCircle,
    NOTE_CREATED: FileText,
    HANDOVER_INITIATED: User,
    PRECHECK_COMPLETED: CheckCircle,
    PRECHECK_WARNING_ACKNOWLEDGED: AlertTriangle,
    NETWORK_DISCONNECTED: XCircle,
    NETWORK_RECONNECTED: Play,
    HEARTBEAT_MISSED: Clock,
    HEARTBEAT_LOST: AlertTriangle,
    DEVICE_CONTINUITY_FAILED: AlertTriangle,
    CLIPBOARD_BLOCKED: AlertTriangle,
    CONTEXT_MENU_BLOCKED: AlertTriangle,
    AUTO_ACTION: AlertTriangle
  };

  const actionColors: Record<AuditActionType, string> = {
    SESSION_START: 'bg-green-100 text-green-800 border-green-200',
    SESSION_PAUSE: 'bg-blue-100 text-blue-800 border-blue-200',
    SESSION_RESUME: 'bg-green-100 text-green-800 border-green-200',
    SESSION_END: 'bg-red-100 text-red-800 border-red-200',
    SECTION_START: 'bg-green-100 text-green-800 border-green-200',
    SECTION_END: 'bg-gray-100 text-gray-800 border-gray-200',
    STUDENT_WARN: 'bg-amber-100 text-amber-800 border-amber-200',
    STUDENT_PAUSE: 'bg-blue-100 text-blue-800 border-blue-200',
    STUDENT_RESUME: 'bg-green-100 text-green-800 border-green-200',
    STUDENT_TERMINATE: 'bg-red-100 text-red-800 border-red-200',
    COHORT_PAUSE: 'bg-blue-100 text-blue-800 border-blue-200',
    COHORT_RESUME: 'bg-green-100 text-green-800 border-green-200',
    EXTENSION_GRANTED: 'bg-purple-100 text-purple-800 border-purple-200',
    ALERT_ACKNOWLEDGED: 'bg-green-100 text-green-800 border-green-200',
    NOTE_CREATED: 'bg-indigo-100 text-indigo-800 border-indigo-200',
    HANDOVER_INITIATED: 'bg-orange-100 text-orange-800 border-orange-200',
    PRECHECK_COMPLETED: 'bg-green-100 text-green-800 border-green-200',
    PRECHECK_WARNING_ACKNOWLEDGED: 'bg-amber-100 text-amber-800 border-amber-200',
    NETWORK_DISCONNECTED: 'bg-red-100 text-red-800 border-red-200',
    NETWORK_RECONNECTED: 'bg-green-100 text-green-800 border-green-200',
    HEARTBEAT_MISSED: 'bg-amber-100 text-amber-800 border-amber-200',
    HEARTBEAT_LOST: 'bg-red-100 text-red-800 border-red-200',
    DEVICE_CONTINUITY_FAILED: 'bg-red-100 text-red-800 border-red-200',
    CLIPBOARD_BLOCKED: 'bg-amber-100 text-amber-800 border-amber-200',
    CONTEXT_MENU_BLOCKED: 'bg-amber-100 text-amber-800 border-amber-200',
    AUTO_ACTION: 'bg-gray-100 text-gray-800 border-gray-200'
  };

  const handleSort = (newSortBy: SortOption) => {
    if (sortBy === newSortBy) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(newSortBy);
      setSortOrder('desc');
    }
  };

  const exportToCSV = () => {
    const headers = ['Timestamp', 'Actor', 'Action Type', 'Target Student ID', 'Payload'];
    const rows = filteredLogs.map(log => [
      new Date(log.timestamp).toISOString(),
      log.actor,
      log.actionType,
      log.targetStudentId || '',
      JSON.stringify(log.payload || {})
    ]);
    
    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
    ].join('\n');
    
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `audit-log-${sessionId}-${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
  };

  const exportToJSON = () => {
    const jsonContent = JSON.stringify(filteredLogs, null, 2);
    const blob = new Blob([jsonContent], { type: 'application/json;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `audit-log-${sessionId}-${new Date().toISOString().split('T')[0]}.json`;
    link.click();
  };

  const formatTime = (timestamp: string) => {
    const date = new Date(timestamp);
    return date.toLocaleString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      day: '2-digit',
      month: 'short',
      year: 'numeric'
    });
  };

  const formatRelativeTime = (timestamp: string) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  };

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Header */}
      <div className="p-6 border-b border-gray-200">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-xl font-bold text-gray-900">Session Audit Trail</h2>
            <p className="text-sm text-gray-500 mt-1">
              {filteredLogs.length} entries for session {sessionId}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={exportToCSV}
              className="flex items-center gap-2 px-3 py-2 bg-gray-100 text-gray-700 rounded-md text-sm font-medium hover:bg-gray-200 transition-colors"
              title="Export as CSV"
            >
              <Download size={16} />
              CSV
            </button>
            <button
              onClick={exportToJSON}
              className="flex items-center gap-2 px-3 py-2 bg-gray-100 text-gray-700 rounded-md text-sm font-medium hover:bg-gray-200 transition-colors"
              title="Export as JSON"
            >
              <Download size={16} />
              JSON
            </button>
            <button
              onClick={onClose}
              className="p-2 text-gray-500 hover:bg-gray-100 rounded-md transition-colors"
            >
              <XCircle size={20} />
            </button>
          </div>
        </div>

        {/* Search and Filter Controls */}
        <div className="flex items-center gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={16} />
            <input
              type="text"
              placeholder="Search logs..."
              value={filter.actor}
              onChange={(e) => setFilter({ ...filter, actor: e.target.value })}
              className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              showFilters ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            <Filter size={16} />
            Filters
          </button>
        </div>

        {/* Filter Panel */}
        {showFilters && (
          <div className="mt-4 p-4 bg-gray-50 rounded-md border border-gray-200">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">
                  Action Type
                </label>
                <select
                  value={filter.actionType}
                  onChange={(e) => setFilter({ ...filter, actionType: e.target.value as AuditActionType | 'all' })}
                  className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="all">All Actions</option>
                  <option value="SESSION_START">Session Start</option>
                  <option value="SESSION_PAUSE">Session Pause</option>
                  <option value="SESSION_RESUME">Session Resume</option>
                  <option value="SESSION_END">Session End</option>
                  <option value="STUDENT_WARN">Student Warn</option>
                  <option value="STUDENT_PAUSE">Student Pause</option>
                  <option value="STUDENT_RESUME">Student Resume</option>
                  <option value="STUDENT_TERMINATE">Student Terminate</option>
                  <option value="COHORT_PAUSE">Cohort Pause</option>
                  <option value="COHORT_RESUME">Cohort Resume</option>
                  <option value="EXTENSION_GRANTED">Extension Granted</option>
                  <option value="ALERT_ACKNOWLEDGED">Alert Acknowledged</option>
                  <option value="NOTE_CREATED">Note Created</option>
                  <option value="HANDOVER_INITIATED">Handover Initiated</option>
                  <option value="AUTO_ACTION">Auto Action</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">
                  Target Student ID
                </label>
                <input
                  type="text"
                  placeholder="Filter by student ID..."
                  value={filter.targetStudentId}
                  onChange={(e) => setFilter({ ...filter, targetStudentId: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div className="flex items-end">
                <button
                  onClick={() => setFilter({ actionType: 'all', actor: '', targetStudentId: '' })}
                  className="w-full px-3 py-2 bg-gray-200 text-gray-700 rounded-md text-sm font-medium hover:bg-gray-300 transition-colors"
                >
                  Clear Filters
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Table Header */}
      <div className="px-6 py-3 bg-gray-50 border-b border-gray-200 grid grid-cols-12 gap-4 items-center text-xs font-bold text-gray-500 uppercase tracking-wider">
        <div
          className="col-span-3 flex items-center gap-1 cursor-pointer hover:text-gray-700"
          onClick={() => handleSort('timestamp')}
        >
          Timestamp
          <ArrowUpDown size={14} className={sortBy === 'timestamp' ? (sortOrder === 'asc' ? 'rotate-180' : '') : 'opacity-30'} />
        </div>
        <div
          className="col-span-2 flex items-center gap-1 cursor-pointer hover:text-gray-700"
          onClick={() => handleSort('actor')}
        >
          Actor
          <ArrowUpDown size={14} className={sortBy === 'actor' ? (sortOrder === 'asc' ? 'rotate-180' : '') : 'opacity-30'} />
        </div>
        <div
          className="col-span-3 flex items-center gap-1 cursor-pointer hover:text-gray-700"
          onClick={() => handleSort('action')}
        >
          Action
          <ArrowUpDown size={14} className={sortBy === 'action' ? (sortOrder === 'asc' ? 'rotate-180' : '') : 'opacity-30'} />
        </div>
        <div className="col-span-2">Target Student</div>
        <div className="col-span-2">Details</div>
      </div>

      {/* Timeline */}
      <div className="flex-1 overflow-y-auto">
        {filteredLogs.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-400">
            <FileText size={48} className="mb-4 opacity-20" />
            <p className="text-lg font-medium">No audit logs found</p>
            <p className="text-sm">Try adjusting your filters</p>
          </div>
        ) : (
          <div className="relative">
            {/* Timeline line */}
            <div className="absolute left-8 top-0 bottom-0 w-px bg-gray-200" />
            
            {filteredLogs.map((log, index) => {
              const ActionIcon = actionIcons[log.actionType];
              return (
                <div
                  key={log.id}
                  className="relative px-6 py-4 border-b border-gray-100 hover:bg-gray-50 transition-colors"
                >
                  {/* Timeline dot */}
                  <div className="absolute left-6 top-1/2 transform -translate-y-1/2 w-4 h-4 rounded-full bg-blue-600 border-4 border-white shadow-sm z-10" />
                  
                  <div className="grid grid-cols-12 gap-4 items-center ml-4">
                    <div className="col-span-3">
                      <div className="flex flex-col">
                        <span className="text-sm font-medium text-gray-900">{formatTime(log.timestamp)}</span>
                        <span className="text-xs text-gray-500">{formatRelativeTime(log.timestamp)}</span>
                      </div>
                    </div>
                    <div className="col-span-2">
                      <div className="flex items-center gap-2">
                        <User size={14} className="text-gray-400" />
                        <span className="text-sm text-gray-900">{log.actor}</span>
                      </div>
                    </div>
                    <div className="col-span-3">
                      <Badge className={actionColors[log.actionType]}>
                        <div className="flex items-center gap-1">
                          <ActionIcon size={12} />
                          {log.actionType.replace(/_/g, ' ')}
                        </div>
                      </Badge>
                    </div>
                    <div className="col-span-2">
                      {log.targetStudentId ? (
                        <span className="text-sm text-gray-900 font-mono">{log.targetStudentId}</span>
                      ) : (
                        <span className="text-sm text-gray-400">—</span>
                      )}
                    </div>
                    <div className="col-span-2">
                      {log.payload && (
                        <details className="text-xs">
                          <summary className="cursor-pointer text-blue-600 hover:text-blue-800">View details</summary>
                          <pre className="mt-2 p-2 bg-gray-100 rounded text-gray-700 overflow-x-auto">
                            {JSON.stringify(log.payload, null, 2)}
                          </pre>
                        </details>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
