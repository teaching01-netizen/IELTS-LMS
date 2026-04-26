import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Search, Filter, Clock, Users, AlertCircle, ArrowRight, Calendar, Download } from 'lucide-react';
import { GradingSession, GradingQueueFilters } from '../../types/grading';
import { gradingService } from '../../services/gradingService';
import { TableLoadingSkeleton } from '@components/ui';
import { seedDevelopmentFixtures } from '../../services/developmentFixtures';
import { downloadCsv } from '../../utils/csvExport';

interface GradingSessionListProps {
  onSessionSelect: (sessionId: string) => void;
}

export const GradingSessionList = React.memo(function GradingSessionList({ onSessionSelect }: GradingSessionListProps) {
  const [sessions, setSessions] = useState<GradingSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<GradingQueueFilters>({});
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    let cancelled = false;
    void loadSessions();
    void seedDevelopmentFixtures()
      .then(() => {
        if (!cancelled) {
          void loadSessions();
        }
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [filters]);

  const loadSessions = async () => {
    setLoading(true);
    const result = await gradingService.getSessionQueue({ ...filters, searchQuery });
    if (result.success && result.data) {
      setSessions(result.data);
    }
    setLoading(false);
  };

  const handleSearch = useCallback((query: string) => {
    setSearchQuery(query);
    setFilters({ ...filters, searchQuery: query });
  }, [filters]);

  const formatDate = useCallback((dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }, []);

  const formatTime = useCallback((dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  }, []);

  const stats = useMemo(() => ({
    totalSessions: sessions.length,
    pendingReviews: sessions.reduce((sum, s) => sum + s.pendingManualReviews, 0),
    inProgressReviews: sessions.reduce((sum, s) => sum + s.inProgressReviews, 0),
    overdueReviews: sessions.reduce((sum, s) => sum + s.overdueReviews, 0),
  }), [sessions]);

  const getStatusBadge = useCallback((status: GradingSession['status']) => {
    const styles = {
      scheduled: 'bg-blue-100 text-blue-800',
      live: 'bg-green-100 text-green-800',
      in_progress: 'bg-yellow-100 text-yellow-800',
      completed: 'bg-gray-100 text-gray-800',
      cancelled: 'bg-red-100 text-red-800'
    };
    return (
      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${styles[status]}`}>
        {status.charAt(0).toUpperCase() + status.slice(1).replace('_', ' ')}
      </span>
    );
  }, []);

  const handleExportCsv = useCallback(() => {
    const filename = `grading-sessions-${new Date().toISOString().split('T')[0]}.csv`;
    downloadCsv(filename, [
      'Session ID',
      'Exam',
      'Cohort',
      'Institution',
      'Start Time',
      'End Time',
      'Status',
      'Total Students',
      'Pending Reviews',
      'In Progress',
      'Finalized',
      'Overdue',
      'Assigned Teachers',
    ], sessions.map((session) => [
      session.id,
      session.examTitle,
      session.cohortName,
      session.institution ?? '',
      session.startTime,
      session.endTime,
      session.status,
      session.totalStudents,
      session.pendingManualReviews,
      session.inProgressReviews,
      session.finalizedReviews,
      session.overdueReviews,
      session.assignedTeachers.join('; '),
    ]));
  }, [sessions]);

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Grading Queue</h1>
          <p className="text-sm text-gray-500 mt-1">Manage grading sessions by exam and cohort</p>
        </div>
        
        <div className="flex items-center gap-3 w-full sm:w-auto">
          <div className="relative flex-1 sm:w-64">
            <Search className="absolute left-3 top-2.5 text-gray-400" size={16} />
            <input 
              type="text" 
              placeholder="Search sessions..." 
              value={searchQuery}
              onChange={(e) => handleSearch(e.target.value)}
              className="w-full pl-9 pr-4 py-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
            />
          </div>
          <button className="flex items-center gap-2 px-3 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50">
            <Filter size={16} />
            Filter
          </button>
          <button
            onClick={handleExportCsv}
            disabled={loading || sessions.length === 0}
            className="flex items-center gap-2 px-3 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            title="Export sessions as CSV"
          >
            <Download size={16} />
            CSV
          </button>
        </div>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-200">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500 font-medium">Total Sessions</p>
              <p className="text-2xl font-bold text-gray-900">{stats.totalSessions}</p>
            </div>
            <div className="w-10 h-10 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center">
              <Calendar size={20} />
            </div>
          </div>
        </div>
        <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-200">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500 font-medium">Pending Reviews</p>
              <p className="text-2xl font-bold text-amber-600">
                {stats.pendingReviews}
              </p>
            </div>
            <div className="w-10 h-10 rounded-full bg-amber-100 text-amber-600 flex items-center justify-center">
              <Clock size={20} />
            </div>
          </div>
        </div>
        <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-200">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500 font-medium">In Progress</p>
              <p className="text-2xl font-bold text-blue-600">
                {stats.inProgressReviews}
              </p>
            </div>
            <div className="w-10 h-10 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center">
              <Users size={20} />
            </div>
          </div>
        </div>
        <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-200">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500 font-medium">Overdue</p>
              <p className="text-2xl font-bold text-red-600">
                {stats.overdueReviews}
              </p>
            </div>
            <div className="w-10 h-10 rounded-full bg-red-100 text-red-600 flex items-center justify-center">
              <AlertCircle size={20} />
            </div>
          </div>
        </div>
      </div>

      {/* Sessions Table */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        {loading ? (
          <TableLoadingSkeleton rows={7} />
        ) : sessions.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-gray-500">
            <Calendar size={48} className="mb-4 text-gray-300" />
            <p className="font-medium">No grading sessions found</p>
            <p className="text-sm mt-1">Create exam schedules to start grading</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wider border-b border-gray-200">
                  <th className="px-6 py-3 font-medium">Exam & Cohort</th>
                  <th className="px-6 py-3 font-medium">Session Date</th>
                  <th className="px-6 py-3 font-medium">Status</th>
                  <th className="px-6 py-3 font-medium text-center">Students</th>
                  <th className="px-6 py-3 font-medium text-center">Pending</th>
                  <th className="px-6 py-3 font-medium text-center">In Progress</th>
                  <th className="px-6 py-3 font-medium text-center">Finalized</th>
                  <th className="px-6 py-3 font-medium text-center">Overdue</th>
                  <th className="px-6 py-3 font-medium text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 text-sm">
                {sessions.map((session) => (
                  <tr key={session.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => onSessionSelect(session.id)}>
                    <td className="px-6 py-4">
                      <p className="font-medium text-gray-900">{session.examTitle}</p>
                      <p className="text-xs text-gray-500">{session.cohortName}</p>
                    </td>
                    <td className="px-6 py-4 text-gray-700">
                      <div className="flex flex-col">
                        <span>{formatDate(session.startTime)}</span>
                        <span className="text-xs text-gray-500">{formatTime(session.startTime)} - {formatTime(session.endTime)}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      {getStatusBadge(session.status)}
                    </td>
                    <td className="px-6 py-4 text-center text-gray-700">
                      {session.totalStudents}
                    </td>
                    <td className="px-6 py-4 text-center">
                      <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-amber-100 text-amber-700 text-sm font-medium">
                        {session.pendingManualReviews}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-center">
                      <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-blue-100 text-blue-700 text-sm font-medium">
                        {session.inProgressReviews}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-center">
                      <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-green-100 text-green-700 text-sm font-medium">
                        {session.finalizedReviews}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-center">
                      {session.overdueReviews > 0 && (
                        <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-red-100 text-red-700 text-sm font-medium">
                          {session.overdueReviews}
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <button 
                        className="px-3 py-1.5 bg-blue-50 text-blue-600 hover:bg-blue-100 rounded text-sm font-medium transition-colors flex items-center gap-1 ml-auto"
                        onClick={(e) => {
                          e.stopPropagation();
                          onSessionSelect(session.id);
                        }}
                      >
                        View
                        <ArrowRight size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
});
