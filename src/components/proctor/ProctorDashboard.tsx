import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { Virtuoso } from 'react-virtuoso';
import {
  Users,
  AlertTriangle,
  PauseCircle,
  XCircle,
  CheckCircle2,
  ArrowUpDown,
  ChevronLeft,
  LayoutGrid,
  List,
  Play,
  Pause,
  Timer,
  FastForward,
  StopCircle,
  CheckSquare,
  Square,
  X,
  Filter,
  XCircle as XIcon,
  Bookmark,
  BookmarkCheck
} from 'lucide-react';
import { StudentSession, ProctorAlert, ExamGroup, SessionAuditLog, AuditActionType, ModuleType, StudentStatus } from '../../types';
import { ExamSchedule, ExamSessionRuntime } from '../../types/domain';
import { VIRTUAL_LIST_HEIGHTS } from '../../constants/uiConstants';
import { StudentCard } from './StudentCard';
import { StudentDetailPanel } from './StudentDetailPanel';
import { ExamGroupCard } from './ExamGroupCard';
import { PresenceIndicator } from './PresenceIndicator';
import { isScheduleReadyToStart } from '../../utils/scheduleUtils';
import { examRepository } from '../../services/examRepository';
import { useStudentFilters } from './hooks/useStudentFilters';

interface ProctorDashboardProps {
  schedules: ExamSchedule[];
  runtimeSnapshots: ExamSessionRuntime[];
  sessions: StudentSession[];
  alerts: ProctorAlert[];
  searchQuery?: string;
  onUpdateSessions: (sessions: StudentSession[]) => void;
  onUpdateAlerts: (alerts: ProctorAlert[]) => void;
  onStartScheduledSession: (scheduleId: string) => Promise<void> | void;
  onPauseCohort: (scheduleId: string) => Promise<void> | void;
  onResumeCohort: (scheduleId: string) => Promise<void> | void;
  onEndSectionNow: (scheduleId: string) => Promise<void> | void;
  onExtendCurrentSection: (scheduleId: string, minutes: number) => Promise<void> | void;
  onCompleteExam: (scheduleId: string) => Promise<void> | void;
}

const formatTime = (seconds: number) => {
  const safe = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const remainingSeconds = safe % 60;
  return `${hours > 0 ? `${hours}:` : ''}${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
};

const formatDateTime = (value: string | null | undefined) => {
  if (!value) return '—';
  return new Date(value).toLocaleString([], {
    hour: '2-digit',
    minute: '2-digit',
    day: '2-digit',
    month: 'short'
  });
};

export const ProctorDashboard = React.memo(function ProctorDashboard({
  schedules,
  runtimeSnapshots,
  sessions,
  alerts,
  searchQuery = '',
  onUpdateSessions,
  onUpdateAlerts,
  onStartScheduledSession,
  onPauseCohort,
  onResumeCohort,
  onEndSectionNow,
  onExtendCurrentSection,
  onCompleteExam
}: ProctorDashboardProps) {
  void alerts;
  void onUpdateAlerts;

  const [selectedScheduleId, setSelectedScheduleId] = useState<string | null>(null);
  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(null);
  const [selectedStudentIds, setSelectedStudentIds] = useState<Set<string>>(new Set());
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [sortBy, setSortBy] = useState<'name' | 'violations' | 'status'>('violations');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');

  const handleSelectSchedule = useCallback((scheduleId: string | null) => {
    setSelectedScheduleId(scheduleId);
    setSelectedStudentId(null);
  }, []);

  const handleSelectStudent = useCallback((studentId: string | null) => {
    setSelectedStudentId(studentId);
  }, []);

  const handleToggleStudentSelection = useCallback((studentId: string) => {
    setSelectedStudentIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(studentId)) {
        newSet.delete(studentId);
      } else {
        newSet.add(studentId);
      }
      setIsSelectionMode(newSet.size > 0);
      return newSet;
    });
  }, []);

  const enrichedSessions = useMemo(() => {
    return sessions.map(session => {
      const runtime = runtimeSnapshots.find(item => item.scheduleId === session.scheduleId);
      return {
        ...session,
        runtimeStatus: runtime?.status ?? session.runtimeStatus,
        runtimeCurrentSection: runtime?.currentSectionKey ?? session.runtimeCurrentSection ?? null,
        runtimeTimeRemainingSeconds: runtime?.currentSectionRemainingSeconds ?? session.runtimeTimeRemainingSeconds ?? session.timeRemaining,
        runtimeSectionStatus: runtime?.sections.find(item => item.sectionKey === runtime.currentSectionKey)?.status ?? session.runtimeSectionStatus,
        runtimeWaiting: runtime?.waitingForNextSection ?? session.runtimeWaiting ?? false
      };
    });
  }, [runtimeSnapshots, sessions]);

  const {
    filterCriteria,
    setFilterCriteria,
    filteredSessions: hookFilteredSessions,
    savedFilters,
    activeFilterId,
    applySavedFilter,
    clearFilters,
    removeFilter,
    hasActiveFilters
  } = useStudentFilters(enrichedSessions);

  const filteredSessions = useMemo(() => {
    const normalizedSearch = searchQuery.trim().toLowerCase();
    const scheduleScopedSessions = selectedScheduleId
      ? hookFilteredSessions.filter(session => session.scheduleId === selectedScheduleId)
      : hookFilteredSessions;

    const searchFilteredSessions = normalizedSearch
      ? scheduleScopedSessions.filter(session =>
          session.name.toLowerCase().includes(normalizedSearch) ||
          session.studentId.toLowerCase().includes(normalizedSearch),
        )
      : scheduleScopedSessions;

    return [...searchFilteredSessions].sort((a, b) => {
      let comparison = 0;
      if (sortBy === 'name') {
        comparison = a.name.localeCompare(b.name);
      } else if (sortBy === 'violations') {
        comparison = a.violations.length - b.violations.length;
      } else {
        comparison = a.status.localeCompare(b.status);
      }
      return sortOrder === 'asc' ? comparison : -comparison;
    });
  }, [hookFilteredSessions, searchQuery, selectedScheduleId, sortBy, sortOrder]);

  const scheduleGroups: ExamGroup[] = useMemo(() => {
    const now = new Date();
    return schedules
      .map(schedule => {
        const runtime = runtimeSnapshots.find(item => item.scheduleId === schedule.id);
        const roster = enrichedSessions.filter(session => session.scheduleId === schedule.id);
        const activeCount = roster.filter(session => session.status === 'active' || session.status === 'warned').length;
        const violationCount = roster.reduce((count, session) => count + session.violations.length, 0);
        const isReadyToStart = isScheduleReadyToStart(schedule, runtime, now);

        return {
          id: schedule.id,
          scheduleId: schedule.id,
          examId: schedule.examId,
          examTitle: schedule.examTitle,
          cohortName: schedule.cohortName,
          scheduledStartTime: schedule.startTime,
          runtimeStatus: runtime?.status ?? (schedule.status === 'live' ? 'live' : schedule.status === 'completed' ? 'completed' : schedule.status === 'cancelled' ? 'cancelled' : 'not_started'),
          isReadyToStart,
          currentLiveSection: runtime?.currentSectionKey ?? null,
          studentCount: roster.length,
          activeCount,
          violationCount,
          status: schedule.status === 'cancelled' ? 'cancelled' : schedule.status === 'completed' ? 'completed' : schedule.status === 'live' ? 'live' : 'scheduled',
          plannedDurationMinutes: schedule.plannedDurationMinutes
        } satisfies ExamGroup;
      })
      .sort((a, b) => new Date(a.scheduledStartTime).getTime() - new Date(b.scheduledStartTime).getTime());
  }, [enrichedSessions, runtimeSnapshots, schedules]);

  const selectedGroup = selectedScheduleId ? scheduleGroups.find(group => group.scheduleId === selectedScheduleId) : undefined;
  const selectedRuntime = selectedScheduleId ? runtimeSnapshots.find(runtime => runtime.scheduleId === selectedScheduleId) : undefined;

  const stats = [
    { label: 'Active', value: enrichedSessions.filter(session => session.status === 'active').length, icon: CheckCircle2, color: 'text-green-800', bg: 'bg-green-100', border: 'border-t-green-800' },
    { label: 'Warned', value: enrichedSessions.filter(session => session.status === 'warned').length, icon: AlertTriangle, color: 'text-amber-800', bg: 'bg-amber-100', border: 'border-t-amber-800' },
    { label: 'Paused', value: enrichedSessions.filter(session => session.status === 'paused').length, icon: PauseCircle, color: 'text-blue-800', bg: 'bg-blue-100', border: 'border-t-blue-800' },
    { label: 'Terminated', value: enrichedSessions.filter(session => session.status === 'terminated').length, icon: XCircle, color: 'text-red-800', bg: 'bg-red-100', border: 'border-t-red-800' }
  ];

  const selectedStudent = enrichedSessions.find(session => session.id === selectedStudentId);

  const toggleSort = (newSortBy: 'name' | 'violations' | 'status') => {
    if (sortBy === newSortBy) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
      return;
    }

    setSortBy(newSortBy);
    setSortOrder('desc');
  };

  const createAuditLog = (
    actionType: AuditActionType,
    targetStudentId?: string,
    payload?: Record<string, unknown>
  ): SessionAuditLog => ({
    id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
    timestamp: new Date().toISOString(),
    actor: 'Proctor',
    actionType,
    targetStudentId,
    sessionId: selectedScheduleId || '',
    payload
  });

  const applyStudentAction = (
    session: StudentSession,
    action: 'warn' | 'pause' | 'resume' | 'terminate',
    payload?: unknown
  ): StudentSession => {
    if (action === 'warn') {
      return {
        ...session,
        status: 'warned',
        warnings: session.warnings + 1,
        violations: [
          ...session.violations,
          {
            id: Math.random().toString(36).slice(2, 11),
            type: 'PROCTOR_WARNING',
            severity: 'medium',
            timestamp: new Date().toISOString(),
            description: typeof payload === 'string' ? payload : 'Warning issued by proctor'
          }
        ]
      };
    }

    if (action === 'pause') {
      return { ...session, status: 'paused' };
    }

    if (action === 'resume') {
      return { ...session, status: 'active' };
    }

    return { ...session, status: 'terminated' };
  };

  const handleDisciplineAction = async (
    studentId: string,
    action: 'warn' | 'pause' | 'resume' | 'terminate',
    payload?: unknown
  ) => {
    const updatedSessions = [...sessions];
    const index = updatedSessions.findIndex(session => session.id === studentId);
    if (index < 0) return;
    const currentSession = updatedSessions[index];
    if (!currentSession) return;

    const actionTypeMap: Record<typeof action, AuditActionType> = {
      warn: 'STUDENT_WARN',
      pause: 'STUDENT_PAUSE',
      resume: 'STUDENT_RESUME',
      terminate: 'STUDENT_TERMINATE'
    };

    const nextSession = applyStudentAction(currentSession, action, payload);
    updatedSessions[index] = nextSession;

    onUpdateSessions(updatedSessions);

    // Log the action
    if (selectedScheduleId) {
      const auditLog = createAuditLog(actionTypeMap[action], studentId, {
        message: typeof payload === 'string' ? payload : `${action} action performed on student`,
        previousStatus: currentSession.status,
        newStatus: nextSession.status
      });
      await examRepository.saveAuditLog(auditLog);
    }
  };

  const handleBulkAction = async (
    action: 'warn' | 'pause' | 'resume' | 'terminate',
    payload?: unknown
  ) => {
    const updatedSessions = [...sessions];
    const results: { studentId: string; success: boolean; error?: string }[] = [];

    const actionTypeMap: Record<typeof action, AuditActionType> = {
      warn: 'STUDENT_WARN',
      pause: 'STUDENT_PAUSE',
      resume: 'STUDENT_RESUME',
      terminate: 'STUDENT_TERMINATE'
    };

    selectedStudentIds.forEach(studentId => {
      const index = updatedSessions.findIndex(session => session.id === studentId);
      if (index < 0) {
        results.push({ studentId, success: false, error: 'Student not found' });
        return;
      }
      const currentSession = updatedSessions[index];
      if (!currentSession) {
        results.push({ studentId, success: false, error: 'Student not found' });
        return;
      }

      try {
        updatedSessions[index] = applyStudentAction(
          currentSession,
          action,
          typeof payload === 'string' ? payload : 'Warning issued by proctor (bulk action)'
        );
        results.push({ studentId, success: true });
      } catch (error) {
        results.push({ studentId, success: false, error: error instanceof Error ? error.message : 'Unknown error' });
      }
    });

    onUpdateSessions(updatedSessions);

    // Log the bulk action
    if (selectedScheduleId) {
      const auditLog = createAuditLog(actionTypeMap[action], undefined, {
        message: `Bulk ${action} action performed on ${selectedStudentIds.size} students`,
        studentIds: Array.from(selectedStudentIds),
        results
      });
      await examRepository.saveAuditLog(auditLog);
    }
    
    // Clear selection after successful bulk action
    setSelectedStudentIds(new Set());
    setIsSelectionMode(false);
  };

  const selectAllFiltered = () => {
    const allFilteredIds = new Set(filteredSessions.map(session => session.id));
    setSelectedStudentIds(allFilteredIds);
    setIsSelectionMode(true);
  };

  const clearSelection = () => {
    setSelectedStudentIds(new Set());
    setIsSelectionMode(false);
  };

  const updateFilterCriterion = <K extends keyof typeof filterCriteria>(
    key: K,
    value: (typeof filterCriteria)[K]
  ) => {
    setFilterCriteria((previous) => {
      if (value === undefined) {
        const nextCriteria = { ...previous };
        delete nextCriteria[key];
        return nextCriteria;
      }

      return {
        ...previous,
        [key]: value,
      };
    });
  };

  const controlDisabled = !selectedScheduleId;
  const selectedRuntimeStatus = selectedGroup?.runtimeStatus ?? 'not_started';
  const startDisabled = controlDisabled ||
    !selectedGroup?.isReadyToStart ||
    selectedRuntimeStatus === 'live' ||
    selectedRuntimeStatus === 'paused' ||
    selectedRuntimeStatus === 'completed' ||
    selectedRuntimeStatus === 'cancelled';

  return (
    <div className="flex h-full w-full overflow-hidden relative">
      <div className="flex-1 flex flex-col min-w-0">
        <div className="p-6 bg-white border-b border-gray-100 space-y-4">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Live Session Control Bar</p>
              <h2 className="text-xl font-bold text-gray-900 mt-1">
                {selectedGroup ? `${selectedGroup.examTitle} · ${selectedGroup.cohortName}` : 'Select a session to control runtime'}
              </h2>
              <div className="flex items-center gap-4 mt-1">
                <p className="text-sm text-gray-500">
                  Runtime status: <span className="font-semibold text-gray-900 capitalize">{selectedRuntimeStatus}</span>
                  {selectedGroup?.currentLiveSection ? (
                    <>
                      {' '}
                      · Live section: <span className="font-semibold text-gray-900 capitalize">{selectedGroup.currentLiveSection}</span>
                    </>
                  ) : null}
                </p>
                {selectedRuntime && selectedRuntime.proctorPresence && selectedRuntime.proctorPresence.length > 0 && (
                  <PresenceIndicator
                    proctorPresence={selectedRuntime.proctorPresence}
                    currentProctorId="proctor-1"
                    currentProctorName="Current Proctor"
                  />
                )}
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => selectedScheduleId && void onStartScheduledSession(selectedScheduleId)}
                disabled={startDisabled}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-md bg-blue-600 text-white text-sm font-medium disabled:bg-gray-300 disabled:cursor-not-allowed hover:bg-blue-700 transition-colors"
              >
                <Play size={14} /> Start Exam
              </button>
              <button
                onClick={() => selectedScheduleId && void onPauseCohort(selectedScheduleId)}
                disabled={controlDisabled || selectedRuntimeStatus !== 'live'}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-md bg-gray-900 text-white text-sm font-medium disabled:bg-gray-300 disabled:cursor-not-allowed hover:bg-gray-800 transition-colors"
              >
                <Pause size={14} /> Pause Cohort
              </button>
              <button
                onClick={() => selectedScheduleId && void onResumeCohort(selectedScheduleId)}
                disabled={controlDisabled || selectedRuntimeStatus !== 'paused'}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-md bg-emerald-600 text-white text-sm font-medium disabled:bg-gray-300 disabled:cursor-not-allowed hover:bg-emerald-700 transition-colors"
              >
                <Play size={14} /> Resume Cohort
              </button>
              <button
                onClick={() => selectedScheduleId && void onEndSectionNow(selectedScheduleId)}
                disabled={controlDisabled || (selectedRuntimeStatus !== 'live' && selectedRuntimeStatus !== 'paused')}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-md bg-amber-600 text-white text-sm font-medium disabled:bg-gray-300 disabled:cursor-not-allowed hover:bg-amber-700 transition-colors"
              >
                <FastForward size={14} /> End Section Now
              </button>
              <button
                onClick={() => selectedScheduleId && void onExtendCurrentSection(selectedScheduleId, 5)}
                disabled={controlDisabled || (selectedRuntimeStatus !== 'live' && selectedRuntimeStatus !== 'paused')}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-md bg-white border border-gray-200 text-sm font-medium text-gray-700 disabled:bg-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed hover:bg-gray-50 transition-colors"
              >
                <Timer size={14} /> Extend +5
              </button>
              <button
                onClick={() => selectedScheduleId && void onExtendCurrentSection(selectedScheduleId, 10)}
                disabled={controlDisabled || (selectedRuntimeStatus !== 'live' && selectedRuntimeStatus !== 'paused')}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-md bg-white border border-gray-200 text-sm font-medium text-gray-700 disabled:bg-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed hover:bg-gray-50 transition-colors"
              >
                <Timer size={14} /> Extend +10
              </button>
              <button
                onClick={() => selectedScheduleId && void onCompleteExam(selectedScheduleId)}
                disabled={controlDisabled || selectedRuntimeStatus === 'completed'}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-md bg-red-600 text-white text-sm font-medium disabled:bg-gray-300 disabled:cursor-not-allowed hover:bg-red-700 transition-colors"
              >
		                <StopCircle size={14} /> Complete Exam
		              </button>
		            </div>
		          </div>

		            {/* Advanced Filter Panel */}
		            {showAdvancedFilters && selectedScheduleId && (
              <div className="rounded-xl border border-gray-200 bg-white p-4">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <p className="text-sm font-bold text-gray-900">Advanced Filters</p>
                    <p className="text-xs text-gray-500">Use saved filters or create custom criteria</p>
                  </div>
                  {hasActiveFilters && (
                    <button
                      onClick={clearFilters}
                      className="text-xs font-bold text-red-600 hover:text-red-800 transition-colors"
                    >
                      Clear All
                    </button>
                  )}
                </div>

                {/* Saved Filters */}
                <div className="mb-4">
                  <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Saved Filters</p>
                  <div className="flex flex-wrap gap-2">
                    {savedFilters.map(filter => (
                      <button
                        key={filter.id}
                        onClick={() => applySavedFilter(filter.id)}
                        className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                          activeFilterId === filter.id
                            ? 'bg-blue-600 text-white'
                            : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                        }`}
                      >
                        {activeFilterId === filter.id ? <BookmarkCheck size={14} /> : <Bookmark size={14} />}
                        {filter.name}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Custom Filters */}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Status</label>
                    <select
	                      value={filterCriteria.status || 'all'}
	                      onChange={(e) => updateFilterCriterion('status', e.target.value === 'all' ? undefined : e.target.value as StudentStatus)}
                      className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="all">All Status</option>
                      <option value="active">Active</option>
                      <option value="warned">Warned</option>
                      <option value="paused">Paused</option>
                      <option value="terminated">Terminated</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Section</label>
                    <select
	                      value={filterCriteria.section || 'all'}
	                      onChange={(e) => updateFilterCriterion('section', e.target.value === 'all' ? undefined : e.target.value as ModuleType)}
                      className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="all">All Sections</option>
                      <option value="listening">Listening</option>
                      <option value="reading">Reading</option>
                      <option value="writing">Writing</option>
                      <option value="speaking">Speaking</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Min Violations</label>
                    <input
                      type="number"
                      min="0"
                      value={filterCriteria.minViolations || ''}
                      onChange={(e) => updateFilterCriterion('minViolations', e.target.value ? parseInt(e.target.value) : undefined)}
                      className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="0"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Max Time (min)</label>
                    <input
                      type="number"
                      min="0"
                      value={filterCriteria.maxTimeRemaining ? Math.floor(filterCriteria.maxTimeRemaining / 60) : ''}
                      onChange={(e) => updateFilterCriterion('maxTimeRemaining', e.target.value ? parseInt(e.target.value) * 60 : undefined)}
                      className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="∞"
                    />
                  </div>
                </div>

                {/* Active Filter Chips */}
                {hasActiveFilters && (
                  <div className="mt-4 pt-4 border-t border-gray-100">
                    <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Active Filters</p>
                    <div className="flex flex-wrap gap-2">
                      {filterCriteria.status && (
                        <div className="flex items-center gap-1 px-2 py-1 bg-blue-100 text-blue-800 rounded-md text-xs">
                          <span>Status: {filterCriteria.status}</span>
                          <button
                            onClick={() => removeFilter('status')}
                            className="hover:text-blue-600"
                          >
                            <XIcon size={12} />
                          </button>
                        </div>
                      )}
                      {filterCriteria.section && (
                        <div className="flex items-center gap-1 px-2 py-1 bg-purple-100 text-purple-800 rounded-md text-xs">
                          <span>Section: {filterCriteria.section}</span>
                          <button
                            onClick={() => removeFilter('section')}
                            className="hover:text-purple-600"
                          >
                            <XIcon size={12} />
                          </button>
                        </div>
                      )}
                      {filterCriteria.minViolations !== undefined && (
                        <div className="flex items-center gap-1 px-2 py-1 bg-amber-100 text-amber-800 rounded-md text-xs">
                          <span>Violations ≥ {filterCriteria.minViolations}</span>
                          <button
                            onClick={() => removeFilter('minViolations')}
                            className="hover:text-amber-600"
                          >
                            <XIcon size={12} />
                          </button>
                        </div>
                      )}
                      {filterCriteria.maxTimeRemaining !== undefined && (
                        <div className="flex items-center gap-1 px-2 py-1 bg-green-100 text-green-800 rounded-md text-xs">
                          <span>Time ≤ {Math.floor(filterCriteria.maxTimeRemaining / 60)}m</span>
                          <button
                            onClick={() => removeFilter('maxTimeRemaining')}
                            className="hover:text-green-600"
                          >
                            <XIcon size={12} />
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {selectedRuntime?.isOverrun && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
                <p className="text-sm font-semibold text-amber-900">This cohort is running past the scheduled window.</p>
                <p className="text-xs text-amber-800 mt-1">Continue monitoring the session and complete it manually when appropriate.</p>
              </div>
            )}

            {selectedRuntime && (
              <div className="bg-gray-50 border border-gray-200 rounded-xl p-4">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <p className="text-xs font-bold uppercase tracking-widest text-gray-400">Section Timeline</p>
                  <p className="text-sm text-gray-500">Each row shows the planned timing plus the actual runtime state.</p>
                </div>
                <div className="text-right">
                  <p className="text-xs font-bold uppercase tracking-widest text-gray-400">Current Remaining</p>
                  <p className="text-lg font-bold text-gray-900 font-mono">{formatTime(selectedRuntime.currentSectionRemainingSeconds)}</p>
                </div>
              </div>

              <div className="space-y-2">
                {selectedRuntime.sections.map(section => (
                  <div key={section.sectionKey} className="grid grid-cols-1 lg:grid-cols-6 gap-3 items-center bg-white border border-gray-100 rounded-lg p-3">
                    <div className="lg:col-span-1">
                      <p className="font-semibold text-gray-900 capitalize">{section.label}</p>
                      <p className="text-[10px] uppercase tracking-widest text-gray-400">Order {section.order}</p>
                    </div>
                    <div className="lg:col-span-1 text-sm text-gray-600">
                      Planned {section.plannedDurationMinutes} min
                    </div>
                    <div className="lg:col-span-1 text-sm text-gray-600">
                      Start {formatDateTime(section.actualStartAt)}
                    </div>
                    <div className="lg:col-span-1 text-sm text-gray-600">
                      End {formatDateTime(section.actualEndAt)}
                    </div>
                    <div className="lg:col-span-1 text-sm text-gray-600 capitalize">
                      Status {section.status}
                    </div>
                    <div className="lg:col-span-1 text-sm text-gray-600">
                      Extension +{section.extensionMinutes} min
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="p-6 grid grid-cols-4 gap-4 bg-white border-b border-gray-100">
          {stats.map(stat => (
            <div key={stat.label} className={`p-4 rounded-sm border border-gray-100 border-t-4 shadow-sm ${stat.bg} ${stat.border} flex items-center gap-4`}>
              <div className={`p-2 rounded-sm bg-white shadow-sm ${stat.color}`}>
                <stat.icon size={20} />
              </div>
              <div>
                <p className="text-2xl font-bold text-gray-900">{stat.value}</p>
                <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">{stat.label}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="px-6 py-4 flex items-center justify-between bg-gray-50 border-b border-gray-100">
          <div className="flex items-center gap-4">
	            {selectedScheduleId ? (
	              <button
	                onClick={() => {
	                  handleSelectSchedule(null);
	                  handleSelectStudent(null);
	                }}
                className="flex items-center gap-2 text-sm font-bold text-blue-800 hover:text-blue-900 transition-colors"
              >
                <ChevronLeft size={18} />
                Back to Sessions
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <LayoutGrid size={18} className="text-gray-400" />
                <span className="text-sm font-bold text-gray-900">Scheduled Cohorts</span>
              </div>
            )}

            {selectedGroup && (
              <div className="flex items-center gap-2 pl-4 border-l border-gray-100">
                <span className="text-sm font-medium text-gray-500">Session:</span>
                <span className="text-sm font-bold text-gray-900">{selectedGroup.examTitle}</span>
                <span className="text-sm text-gray-500">· {selectedGroup.cohortName}</span>
                <span className="px-3 py-1 bg-blue-100 text-blue-800 text-sm font-bold rounded-full" aria-live="polite">
                  {filteredSessions.length} students
                </span>
              </div>
            )}
          </div>

          <div className="flex items-center gap-4">
            {selectedScheduleId && (
              <>
                {isSelectionMode ? (
                  <>
                    <button
                      onClick={clearSelection}
                      className="flex items-center gap-2 text-sm font-bold text-gray-600 hover:text-gray-900 transition-colors"
                    >
                      <X size={16} />
                      Cancel Selection ({selectedStudentIds.size})
                    </button>
                    <div className="h-4 w-px bg-gray-100" />
                    <button
                      onClick={selectAllFiltered}
                      className="flex items-center gap-2 text-sm font-bold text-blue-800 hover:text-blue-900 transition-colors"
                    >
                      <CheckSquare size={16} />
                      Select All Filtered
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      onClick={() => setIsSelectionMode(true)}
                      className="flex items-center gap-2 text-sm font-bold text-gray-600 hover:text-gray-900 transition-colors"
                    >
                      <Square size={16} />
                      Select Students
                    </button>
                    <div className="h-4 w-px bg-gray-100" />
                    <button
                      onClick={() => setShowAdvancedFilters(!showAdvancedFilters)}
                      className={`flex items-center gap-2 text-sm font-bold transition-colors ${
                        showAdvancedFilters || hasActiveFilters ? 'text-blue-800' : 'text-gray-600 hover:text-gray-900'
                      }`}
                    >
                      <Filter size={16} />
                      Filters
                      {hasActiveFilters && (
                        <span className="px-1.5 py-0.5 bg-blue-600 text-white text-xs font-bold rounded-full">
                          {Object.keys(filterCriteria).length}
                        </span>
                      )}
                    </button>
                    <div className="h-4 w-px bg-gray-100" />
                    <button
                      onClick={() => toggleSort('violations')}
                      className={`flex items-center gap-2 text-sm font-bold transition-colors ${sortBy === 'violations' ? 'text-blue-800' : 'text-gray-600 hover:text-gray-900'}`}
                    >
                      <ArrowUpDown size={16} className={sortBy === 'violations' ? (sortOrder === 'asc' ? 'rotate-180' : '') : ''} />
                      Sort
                    </button>
                  </>
                )}
              </>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {!selectedScheduleId ? (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
	              {scheduleGroups.map(group => (
	                <ExamGroupCard
	                  key={group.id}
	                  group={group}
	                  onClick={() => handleSelectSchedule(group.scheduleId)}
	                  hasNotes={false}
	                />
              ))}
              {scheduleGroups.length === 0 && (
                <div className="col-span-full flex flex-col items-center justify-center h-64 text-gray-400">
                  <List size={48} className="mb-4 opacity-20" />
                  <p className="text-lg font-medium">No scheduled sessions</p>
                  <p className="text-sm">Create a schedule to start monitoring cohorts.</p>
                </div>
              )}
            </div>
          ) : (
            <>
              {filteredSessions.length > 0 ? (
                <Virtuoso
                  style={{ height: VIRTUAL_LIST_HEIGHTS.PROCTOR_STUDENT_LIST }}
                  data={filteredSessions}
                  itemContent={(index, session) => (
                    <div className="p-3">
                      <StudentCard
                        key={session.id}
                        session={session}
                        isSelected={selectedStudentId === session.id}
                        isSelectionEnabled={isSelectionMode}
                        isMultiSelected={selectedStudentIds.has(session.id)}
                        onClick={() => handleSelectStudent(session.id)}
                        onAction={(action) => handleDisciplineAction(session.id, action)}
                        onToggleSelection={(e) => {
                          e.stopPropagation();
                          handleToggleStudentSelection(session.id);
                        }}
                      />
                    </div>
                  )}
                />
              ) : (
                <div className="flex flex-col items-center justify-center h-64 text-gray-400">
                  <Users size={48} className="mb-4 opacity-20" />
                  <p className="text-lg font-medium">No students found</p>
                  <p className="text-sm">Try adjusting your filters or search query</p>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Floating Bulk Action Bar */}
      {isSelectionMode && selectedStudentIds.size > 0 && (
        <div className="fixed bottom-6 left-1/2 transform -translate-x-1/2 bg-gray-900 text-white rounded-lg shadow-2xl px-6 py-4 flex items-center gap-4 z-50">
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold">{selectedStudentIds.size}</span>
            <span className="text-sm text-gray-300">selected</span>
          </div>
          <div className="h-6 w-px bg-gray-700" />
          <div className="flex items-center gap-2">
            <button
              onClick={() => handleBulkAction('warn')}
              className="flex items-center gap-2 px-4 py-2 bg-amber-600 hover:bg-amber-700 rounded-md text-sm font-medium transition-colors"
              title="Warn selected students"
            >
              <AlertTriangle size={16} />
              Warn
            </button>
            <button
              onClick={() => handleBulkAction('pause')}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-md text-sm font-medium transition-colors"
              title="Pause selected students"
            >
              <Pause size={16} />
              Pause
            </button>
            <button
              onClick={() => handleBulkAction('resume')}
              className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 rounded-md text-sm font-medium transition-colors"
              title="Resume selected students"
            >
              <Play size={16} />
              Resume
            </button>
            <button
              onClick={() => handleBulkAction('terminate')}
              className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 rounded-md text-sm font-medium transition-colors"
              title="Terminate selected students"
            >
              <XCircle size={16} />
              Terminate
            </button>
          </div>
          <div className="h-6 w-px bg-gray-700" />
          <button
            onClick={clearSelection}
            className="text-gray-400 hover:text-white transition-colors"
            title="Clear selection"
          >
            <X size={20} />
          </button>
        </div>
      )}

	      <StudentDetailPanel
	        student={selectedStudent}
	        onClose={() => handleSelectStudent(null)}
	        onAction={(action, payload) => {
	          if (!selectedStudent) return;
	          void handleDisciplineAction(selectedStudent.id, action, payload);
	        }}
	      />
	    </div>
	  );
});
