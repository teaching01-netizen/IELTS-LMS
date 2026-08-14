import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Search, Clock, Users, AlertCircle, ArrowRight, Calendar, Download, ChevronLeft, ChevronRight, RotateCw, X } from 'lucide-react';
import type { GradingSession, SessionQueuePagination } from '../../types/grading';
import { gradingService } from '../../services/gradingService';
import { TableLoadingSkeleton } from '@components/ui';
import { seedDevelopmentFixtures } from '../../services/developmentFixtures';
import { downloadCsv } from '../../utils/csvExport';

interface GradingSessionListProps {
  onSessionSelect: (sessionId: string) => void;
}

const DEFAULT_PAGE_SIZE = 10;
const PAGE_SIZE_OPTIONS = [10, 25, 50] as const;
const SEARCH_DEBOUNCE_MS = 350;

/** Window of page numbers around the current page, with ellipsis gaps. */
function buildPageItems(current: number, totalPages: number): Array<number | 'ellipsis'> {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }

  const items: Array<number | 'ellipsis'> = [1];
  if (current > 3) items.push('ellipsis');

  const start = Math.max(2, current - 1);
  const end = Math.min(totalPages - 1, current + 1);
  for (let page = start; page <= end; page += 1) {
    items.push(page);
  }

  if (current < totalPages - 2) items.push('ellipsis');
  items.push(totalPages);
  return items;
}

export const GradingSessionList = React.memo(function GradingSessionList({ onSessionSelect }: GradingSessionListProps) {
  const [sessions, setSessions] = useState<GradingSession[]>([]);
  const [pagination, setPagination] = useState<SessionQueuePagination>({
    page: 1,
    pageSize: DEFAULT_PAGE_SIZE,
    total: 0,
    hasMore: false,
  });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [exporting, setExporting] = useState(false);
  const [summary, setSummary] = useState({
    totalSessions: 0,
    totalStudents: 0,
    pendingManualReviews: 0,
    inProgressReviews: 0,
    finalizedReviews: 0,
    overdueReviews: 0,
  });
  const searchTimerRef = useRef<number | undefined>(undefined);

  const loadPage = useCallback(async (page: number, pageSize: number, search: string) => {
    setLoading(true);
    setLoadError(null);
    const result = await gradingService.getSessionQueuePage({ page, pageSize, searchQuery: search });
    if (result.success && result.data) {
      setSessions(result.data.sessions);
      setPagination(result.data.pagination);
    } else {
      setSessions([]);
      setLoadError(result.error ?? 'Failed to load grading sessions.');
    }
    setLoading(false);
  }, []);

  const loadSummary = useCallback(async () => {
    const result = await gradingService.getSessionQueueSummary();
    if (result.success && result.data) {
      setSummary(result.data);
    }
  }, []);

  // Debounce the search input so each keystroke does not fire a request.
  useEffect(() => {
    window.clearTimeout(searchTimerRef.current);
    searchTimerRef.current = window.setTimeout(() => {
      setDebouncedSearch(searchQuery.trim());
      setPagination((previous) => ({ ...previous, page: 1 }));
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(searchTimerRef.current);
  }, [searchQuery]);

  // Reload whenever page, page size, or the debounced search changes.
  useEffect(() => {
    void loadPage(pagination.page, pagination.pageSize, debouncedSearch);
  }, [pagination.page, pagination.pageSize, debouncedSearch, loadPage]);

  // Seed dev fixtures once, then refresh both the page and the stats.
  useEffect(() => {
    void loadSummary();
    void seedDevelopmentFixtures()
      .then(() => {
        void loadPage(pagination.page, pagination.pageSize, debouncedSearch);
        void loadSummary();
      })
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const totalPages = Math.max(1, Math.ceil(pagination.total / pagination.pageSize));
  const pageItems = useMemo(() => buildPageItems(pagination.page, totalPages), [pagination.page, totalPages]);

  const firstItem = pagination.total === 0 ? 0 : (pagination.page - 1) * pagination.pageSize + 1;
  const lastItem = Math.min(pagination.page * pagination.pageSize, pagination.total);

  const goToPage = useCallback((page: number) => {
    if (page < 1 || page > totalPages || page === pagination.page) return;
    setPagination((previous) => ({ ...previous, page }));
  }, [pagination.page, totalPages]);

  const changePageSize = useCallback((pageSize: number) => {
    setPagination((previous) => ({ ...previous, pageSize, page: 1 }));
  }, []);

  const clearSearch = useCallback(() => {
    setSearchQuery('');
    setDebouncedSearch('');
    setPagination((previous) => ({ ...previous, page: 1 }));
  }, []);

  const formatDate = useCallback((dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }, []);

  const formatTime = useCallback((dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  }, []);

  const getStatusBadge = useCallback((status: GradingSession['status']) => {
    const styles: Record<GradingSession['status'], { badge: string; dot: string; label: string }> = {
      scheduled: { badge: 'bg-blue-50 text-blue-800 ring-blue-600/20', dot: 'bg-blue-500', label: 'Scheduled' },
      live: { badge: 'bg-green-50 text-green-800 ring-green-600/20', dot: 'bg-green-500', label: 'Live' },
      in_progress: { badge: 'bg-amber-50 text-amber-800 ring-amber-600/20', dot: 'bg-amber-500', label: 'In progress' },
      completed: { badge: 'bg-gray-50 text-gray-700 ring-gray-500/20', dot: 'bg-gray-400', label: 'Completed' },
      cancelled: { badge: 'bg-red-50 text-red-800 ring-red-600/20', dot: 'bg-red-500', label: 'Cancelled' },
    };
    const variant = styles[status];
    return (
      <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${variant.badge}`}>
        <span className={`h-1.5 w-1.5 rounded-full ${variant.dot}`} aria-hidden="true" />
        {variant.label}
      </span>
    );
  }, []);

  const handleExportCsv = useCallback(async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const result = await gradingService.getSessionQueue();
      const rows = result.success && result.data ? result.data : sessions;
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
      ], rows.map((session) => [
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
    } finally {
      setExporting(false);
    }
  }, [exporting, sessions]);

  const hasSearch = searchQuery.trim() !== '';
  const showingEmpty = !loading && sessions.length === 0;

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:justify-between lg:items-end gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">Grading Queue</h1>
          <p className="text-sm text-gray-500 mt-1">
            {pagination.total > 0
              ? `${pagination.total.toLocaleString()} session${pagination.total === 1 ? '' : 's'} across exams and cohorts`
              : 'Manage grading sessions by exam and cohort'}
          </p>
        </div>

        <div className="flex items-center gap-3 w-full lg:w-auto">
          <div className="relative flex-1 lg:w-72">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
            <input
              type="text"
              placeholder="Search by exam or cohort..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              aria-label="Search sessions by exam or cohort"
              className="w-full pl-9 pr-9 py-2 border border-gray-300 rounded-lg text-sm bg-white shadow-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow"
            />
            {hasSearch && (
              <button
                type="button"
                onClick={clearSearch}
                aria-label="Clear search"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 rounded-full text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
              >
                <X size={14} />
              </button>
            )}
          </div>
          <button
            onClick={() => void handleExportCsv()}
            disabled={exporting || (loading && sessions.length === 0)}
            className="inline-flex items-center gap-2 px-3.5 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm transition-colors"
            title="Export all grading sessions as CSV"
          >
            <Download size={16} />
            {exporting ? 'Exporting…' : 'Export CSV'}
          </button>
        </div>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-200">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500 font-medium">Total Sessions</p>
              <p className="text-2xl font-bold text-gray-900">{summary.totalSessions}</p>
            </div>
            <div className="w-10 h-10 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center ring-1 ring-inset ring-blue-600/10">
              <Calendar size={20} />
            </div>
          </div>
        </div>
        <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-200">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500 font-medium">Pending Reviews</p>
              <p className="text-2xl font-bold text-amber-600">{summary.pendingManualReviews}</p>
            </div>
            <div className="w-10 h-10 rounded-full bg-amber-50 text-amber-600 flex items-center justify-center ring-1 ring-inset ring-amber-600/10">
              <Clock size={20} />
            </div>
          </div>
        </div>
        <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-200">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500 font-medium">In Progress</p>
              <p className="text-2xl font-bold text-blue-600">{summary.inProgressReviews}</p>
            </div>
            <div className="w-10 h-10 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center ring-1 ring-inset ring-blue-600/10">
              <Users size={20} />
            </div>
          </div>
        </div>
        <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-200">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500 font-medium">Overdue</p>
              <p className="text-2xl font-bold text-red-600">{summary.overdueReviews}</p>
            </div>
            <div className="w-10 h-10 rounded-full bg-red-50 text-red-600 flex items-center justify-center ring-1 ring-inset ring-red-600/10">
              <AlertCircle size={20} />
            </div>
          </div>
        </div>
      </div>

      {/* Load error */}
      {loadError ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 flex items-center justify-between gap-4">
          <p className="text-sm text-red-800">{loadError}</p>
          <button
            type="button"
            onClick={() => void loadPage(pagination.page, pagination.pageSize, debouncedSearch)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium text-red-700 bg-white border border-red-200 hover:bg-red-100 transition-colors"
          >
            <RotateCw size={14} />
            Retry
          </button>
        </div>
      ) : null}

      {/* Sessions Table */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        {loading ? (
          <TableLoadingSkeleton rows={7} />
        ) : showingEmpty ? (
          <div className="flex flex-col items-center justify-center h-64 text-gray-500 px-6">
            <Calendar size={48} className="mb-4 text-gray-300" />
            <p className="font-medium text-gray-900">
              {hasSearch ? 'No matching sessions' : 'No grading sessions found'}
            </p>
            <p className="text-sm mt-1 text-center">
              {hasSearch
                ? 'Try a different exam name or cohort.'
                : 'Create exam schedules to start grading'}
            </p>
            {hasSearch && (
              <button
                type="button"
                onClick={clearSearch}
                className="mt-4 px-4 py-2 bg-blue-50 text-blue-700 rounded-lg text-sm font-medium hover:bg-blue-100 transition-colors"
              >
                Clear search
              </button>
            )}
          </div>
        ) : (
          <>
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
                    // Clickable row convenience; the explicit View button is the keyboard-accessible action.
                    // eslint-disable-next-line jsx-a11y/control-has-associated-label -- label text lives deeper than the rule's scan depth
                    <tr
                      key={session.id}
                      className="hover:bg-gray-50 cursor-pointer transition-colors"
                      onClick={() => onSessionSelect(session.id)}
                      aria-label={`Open grading session for ${session.examTitle}`}
                    >
                      <td className="px-6 py-4">
                        <p className="font-medium text-gray-900">{session.examTitle}</p>
                        <p className="text-xs text-gray-500 mt-0.5">{session.cohortName}</p>
                      </td>
                      <td className="px-6 py-4 text-gray-700 whitespace-nowrap">
                        <div className="flex flex-col">
                          <span>{formatDate(session.startTime)}</span>
                          <span className="text-xs text-gray-500">
                            {formatTime(session.startTime)} – {formatTime(session.endTime)}
                          </span>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        {getStatusBadge(session.status)}
                      </td>
                      <td className="px-6 py-4 text-center text-gray-700 tabular-nums">
                        {session.totalStudents}
                      </td>
                      <td className="px-6 py-4 text-center">
                        <span className="inline-flex items-center justify-center min-w-8 h-8 rounded-full bg-amber-50 text-amber-700 text-sm font-medium ring-1 ring-inset ring-amber-600/10 tabular-nums">
                          {session.pendingManualReviews}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-center">
                        <span className="inline-flex items-center justify-center min-w-8 h-8 rounded-full bg-blue-50 text-blue-700 text-sm font-medium ring-1 ring-inset ring-blue-600/10 tabular-nums">
                          {session.inProgressReviews}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-center">
                        <span className="inline-flex items-center justify-center min-w-8 h-8 rounded-full bg-green-50 text-green-700 text-sm font-medium ring-1 ring-inset ring-green-600/10 tabular-nums">
                          {session.finalizedReviews}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-center">
                        {session.overdueReviews > 0 ? (
                          <span className="inline-flex items-center justify-center min-w-8 h-8 rounded-full bg-red-50 text-red-700 text-sm font-medium ring-1 ring-inset ring-red-600/10 tabular-nums">
                            {session.overdueReviews}
                          </span>
                        ) : (
                          <span className="text-gray-300">–</span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-right">
                        <button
                          type="button"
                          className="px-3 py-1.5 bg-blue-50 text-blue-700 hover:bg-blue-100 rounded-lg text-sm font-medium transition-colors inline-flex items-center gap-1 ml-auto focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none"
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

            {/* Pagination footer */}
            <div className="px-6 py-3.5 border-t border-gray-200 flex flex-col sm:flex-row items-center justify-between gap-3">
              <p className="text-sm text-gray-500 tabular-nums">
                Showing <span className="font-medium text-gray-700">{firstItem}</span>–
                <span className="font-medium text-gray-700">{lastItem}</span> of{' '}
                <span className="font-medium text-gray-700">{pagination.total.toLocaleString()}</span>
              </p>

              <div className="flex items-center gap-3">
                <label htmlFor="grading-queue-page-size" className="flex items-center gap-2 text-sm text-gray-500">
                  Rows
                  <select
                    id="grading-queue-page-size"
                    value={pagination.pageSize}
                    onChange={(e) => changePageSize(Number(e.target.value))}
                    className="h-8 rounded-md border border-gray-300 bg-white px-2 text-sm text-gray-700 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                  >
                    {PAGE_SIZE_OPTIONS.map((size) => (
                      <option key={size} value={size}>{size}</option>
                    ))}
                  </select>
                </label>

                <nav aria-label="Pagination" className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => goToPage(pagination.page - 1)}
                    disabled={pagination.page <= 1}
                    aria-label="Previous page"
                    className="inline-flex items-center justify-center h-8 w-8 rounded-lg border border-gray-300 bg-white text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    <ChevronLeft size={16} />
                  </button>
                  {pageItems.map((item, index) =>
                    item === 'ellipsis' ? (
                      <span key={`ellipsis-${index}`} className="px-1.5 text-sm text-gray-400 select-none" aria-hidden="true">
                        …
                      </span>
                    ) : (
                      <button
                        key={item}
                        type="button"
                        onClick={() => goToPage(item)}
                        aria-label={`Page ${item}`}
                        aria-current={item === pagination.page ? 'page' : undefined}
                        className={`inline-flex items-center justify-center h-8 min-w-8 px-2 rounded-lg text-sm font-medium transition-colors ${
                          item === pagination.page
                            ? 'bg-blue-600 text-white shadow-sm'
                            : 'border border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
                        }`}
                      >
                        {item}
                      </button>
                    ),
                  )}
                  <button
                    type="button"
                    onClick={() => goToPage(pagination.page + 1)}
                    disabled={!pagination.hasMore}
                    aria-label="Next page"
                    className="inline-flex items-center justify-center h-8 w-8 rounded-lg border border-gray-300 bg-white text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    <ChevronRight size={16} />
                  </button>
                </nav>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
});
