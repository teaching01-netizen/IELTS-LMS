import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckSquare, ChevronLeft, Filter, LayoutGrid, List, Pause, Play, Square, StopCircle, Timer, X } from 'lucide-react';
import type { AuditActionType, ExamGroup, ModuleType, ProctorAlert, SessionAuditLog, SessionNote, StudentSession, StudentStatus } from '../../types';
import type { ExamSchedule, ExamSessionRuntime } from '../../types/domain';
import { ConfirmModal } from '../ConfirmModal';
import { LoadingMark, SrLoadingText } from '../ui/LoadingMark';
import { Toast, ToastContainer, type ToastVariant } from '../ui/Toast';
import { PresenceIndicator } from './PresenceIndicator';
import { StudentCard } from './StudentCard';
import { StudentDetailPanel, type StudentDrawerTab } from './StudentDetailPanel';
import { ExamGroupCard } from './ExamGroupCard';
import { isScheduleReadyToStart } from '../../utils/scheduleUtils';
import { examRepository } from '../../services/examRepository';
import { examDeliveryService } from '../../services/examDeliveryService';
import { backendPost } from '../../services/backendBridge';
import { useStudentFilters } from './hooks/useStudentFilters';
import { logger } from '../../utils/logger';
import type { ProctorScheduleMetrics } from '../../features/proctor/contracts';

interface ProctorDashboardProps {
  schedules: ExamSchedule[];
  runtimeSnapshots: ExamSessionRuntime[];
  scheduleMetrics: Record<string, ProctorScheduleMetrics>;
  sessions: StudentSession[];
  alerts: ProctorAlert[];
  currentProctorId?: string | undefined;
  currentProctorName?: string | undefined;
  searchQuery?: string;
  railSelection?: 'dashboard' | 'alerts' | 'audit' | 'notes';
  auditLogs?: SessionAuditLog[];
  notes?: SessionNote[];
  selectedScheduleId: string | null;
  onSelectScheduleId: (scheduleId: string | null) => void;
  onUpdateSessions: (sessions: StudentSession[]) => void;
  onUpdateAlerts: (alerts: ProctorAlert[]) => void;
  onUpdateNotes?: (notes: SessionNote[]) => void;
  onStartScheduledSession: (scheduleId: string) => Promise<void> | void;
  onPauseCohort: (scheduleId: string) => Promise<void> | void;
  onResumeCohort: (scheduleId: string) => Promise<void> | void;
  onEndSectionNow: (scheduleId: string) => Promise<void> | void;
  onExtendCurrentSection: (scheduleId: string, minutes: number) => Promise<void> | void;
  onCompleteExam: (scheduleId: string) => Promise<void> | void;
}

export const ProctorDashboard = React.memo(function ProctorDashboard({
  schedules,
  runtimeSnapshots,
  scheduleMetrics,
  sessions,
  alerts,
  currentProctorId,
  currentProctorName,
  searchQuery = '',
  railSelection = 'dashboard',
  auditLogs = [],
  notes = [],
  selectedScheduleId,
  onSelectScheduleId,
  onUpdateSessions,
  onUpdateAlerts,
  onUpdateNotes,
  onStartScheduledSession,
  onPauseCohort,
  onResumeCohort,
  onEndSectionNow: _onEndSectionNow,
  onExtendCurrentSection,
  onCompleteExam,
}: ProctorDashboardProps) {
  type CohortControlAction = 'start' | 'pause' | 'resume' | 'extend_5' | 'extend_10' | 'complete';

  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(null);
  const [selectedStudentIds, setSelectedStudentIds] = useState<Set<string>>(new Set());
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [sortBy, setSortBy] = useState<'name' | 'violations' | 'status'>('violations');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [listDensity, setListDensity] = useState<'compact' | 'comfortable'>('compact');
  const [drawerTab, setDrawerTab] = useState<StudentDrawerTab>('timeline');
  const [pendingCohortAction, setPendingCohortAction] = useState<CohortControlAction | null>(null);
  const [confirmAction, setConfirmAction] = useState<'complete' | null>(null);
  const [confirmDisciplineAction, setConfirmDisciplineAction] = useState<
    | null
    | { scope: 'single'; studentId: string; studentName: string; action: 'pause' | 'terminate' }
    | { scope: 'bulk'; studentIds: string[]; action: 'pause' | 'terminate' }
  >(null);
  const [toasts, setToasts] = useState<
    Array<{ id: string; variant: ToastVariant; title?: string; message: string }>
  >([]);

  const enrichedSessions = useMemo(
    () =>
      sessions.map((session) => {
        const runtime = runtimeSnapshots.find((item) => item.scheduleId === session.scheduleId);
        return {
          ...session,
          runtimeStatus: runtime?.status ?? session.runtimeStatus,
          runtimeCurrentSection: runtime?.currentSectionKey ?? session.runtimeCurrentSection ?? null,
          runtimeTimeRemainingSeconds:
            runtime?.currentSectionRemainingSeconds ??
            session.runtimeTimeRemainingSeconds ??
            session.timeRemaining,
          runtimeSectionStatus:
            runtime?.sections.find((item) => item.sectionKey === runtime.currentSectionKey)?.status ??
            session.runtimeSectionStatus,
          runtimeWaiting: runtime?.waitingForNextSection ?? session.runtimeWaiting ?? false,
        };
      }),
    [runtimeSnapshots, sessions],
  );

  const {
    filterCriteria,
    setFilterCriteria,
    filteredSessions: hookFilteredSessions,
    savedFilters,
    activeFilterId,
    applySavedFilter,
    clearFilters,
    removeFilter,
    hasActiveFilters,
  } = useStudentFilters(enrichedSessions);

  const filteredSessions = useMemo(() => {
    const normalizedSearch = searchQuery.trim().toLowerCase();
    const scheduleScopedSessions = selectedScheduleId
      ? hookFilteredSessions.filter((session) => session.scheduleId === selectedScheduleId)
      : hookFilteredSessions;
    const searchFilteredSessions = normalizedSearch
      ? scheduleScopedSessions.filter(
          (session) =>
            session.name.toLowerCase().includes(normalizedSearch) ||
            session.studentId.toLowerCase().includes(normalizedSearch),
        )
      : scheduleScopedSessions;

    return [...searchFilteredSessions].sort((a, b) => {
      let comparison = 0;
      if (sortBy === 'name') comparison = a.name.localeCompare(b.name);
      else if (sortBy === 'violations') comparison = a.violations.length - b.violations.length;
      else comparison = a.status.localeCompare(b.status);
      return sortOrder === 'asc' ? comparison : -comparison;
    });
  }, [hookFilteredSessions, searchQuery, selectedScheduleId, sortBy, sortOrder]);

  const scheduleGroups: ExamGroup[] = useMemo(() => {
    const now = new Date();
    return schedules
      .map((schedule) => {
        const runtime = runtimeSnapshots.find((item) => item.scheduleId === schedule.id);
        const roster = enrichedSessions.filter((session) => session.scheduleId === schedule.id);
        const metrics = scheduleMetrics[schedule.id];
        const studentCount = metrics?.studentCount ?? roster.length;
        const activeCount =
          metrics?.activeCount ??
          roster.filter((session) => session.status === 'active' || session.status === 'warned').length;
        const violationCount =
          metrics?.violationCount ??
          roster.reduce((count, session) => count + session.violations.length, 0);
        return {
          id: schedule.id,
          scheduleId: schedule.id,
          examId: schedule.examId,
          examTitle: schedule.examTitle,
          cohortName: schedule.cohortName,
          scheduledStartTime: schedule.startTime,
          runtimeStatus:
            runtime?.status ??
            (schedule.status === 'live'
              ? 'live'
              : schedule.status === 'completed'
                ? 'completed'
                : schedule.status === 'cancelled'
                  ? 'cancelled'
                  : 'not_started'),
          isReadyToStart: isScheduleReadyToStart(schedule, runtime, now),
          currentLiveSection: runtime?.currentSectionKey ?? null,
          studentCount,
          activeCount,
          violationCount,
          status:
            schedule.status === 'cancelled'
              ? 'cancelled'
              : schedule.status === 'completed'
                ? 'completed'
                : schedule.status === 'live'
                  ? 'live'
                  : 'scheduled',
          plannedDurationMinutes: schedule.plannedDurationMinutes,
        } satisfies ExamGroup;
      })
      .sort((a, b) => new Date(a.scheduledStartTime).getTime() - new Date(b.scheduledStartTime).getTime());
  }, [enrichedSessions, runtimeSnapshots, scheduleMetrics, schedules]);

  const selectedGroup = selectedScheduleId ? scheduleGroups.find((group) => group.scheduleId === selectedScheduleId) : undefined;
  const selectedRuntime = selectedScheduleId ? runtimeSnapshots.find((runtime) => runtime.scheduleId === selectedScheduleId) : undefined;
  const selectedStudent = enrichedSessions.find((session) => session.id === selectedStudentId);
  const selectedScheduleAlerts = alerts.filter((alert) =>
    selectedScheduleId ? enrichedSessions.some((session) => session.scheduleId === selectedScheduleId && session.studentId === alert.studentId) : true,
  );
  const scopedAuditLogs = auditLogs.filter((log) => !selectedScheduleId || log.sessionId === selectedScheduleId);
  const scopedNotes = notes.filter((note) => !selectedScheduleId || note.scheduleId === selectedScheduleId);

  useEffect(() => {
    if (!selectedScheduleId) {
      return;
    }

    let cancelled = false;
    let heartbeatInterval: number | null = null;

    const sendPresence = async (action: 'join' | 'heartbeat' | 'leave') => {
      try {
        await backendPost(`/v1/proctor/sessions/${selectedScheduleId}/presence`, { action }, { retries: 0 });
      } catch (error) {
        if (!cancelled) {
          logger.warn('Failed to update proctor presence', { action, error });
        }
      }
    };

    void sendPresence('join');
    heartbeatInterval = window.setInterval(() => {
      void sendPresence('heartbeat');
    }, 30_000);

    return () => {
      cancelled = true;
      if (heartbeatInterval) {
        window.clearInterval(heartbeatInterval);
      }
      void sendPresence('leave');
    };
  }, [selectedScheduleId]);

  useEffect(() => {
    if (railSelection === 'dashboard') return;

    const targetTab: StudentDrawerTab =
      railSelection === 'alerts' ? 'violations' : railSelection === 'audit' ? 'audit' : 'notes';

    setDrawerTab(targetTab);

    if (!selectedStudentId && selectedScheduleId && filteredSessions.length > 0) {
      setSelectedStudentId(filteredSessions[0]?.id ?? null);
    }
  }, [filteredSessions, railSelection, selectedScheduleId, selectedStudentId]);

  const handleSelectSchedule = useCallback((scheduleId: string | null) => {
    onSelectScheduleId(scheduleId);
    setSelectedStudentId(null);
    setSelectedStudentIds(new Set());
    setIsSelectionMode(false);
  }, [onSelectScheduleId]);

  const handleSelectStudent = useCallback(
    (studentId: string | null) => {
      setSelectedStudentId(studentId);
      if (railSelection === 'alerts') setDrawerTab('violations');
      if (railSelection === 'audit') setDrawerTab('audit');
      if (railSelection === 'notes') setDrawerTab('notes');
    },
    [railSelection],
  );

  const handleToggleStudentSelection = useCallback((studentId: string) => {
    setSelectedStudentIds((prev) => {
      const next = new Set(prev);
      if (next.has(studentId)) next.delete(studentId);
      else next.add(studentId);
      setIsSelectionMode(next.size > 0);
      return next;
    });
  }, []);

  const toggleSort = (newSortBy: 'name' | 'violations' | 'status') => {
    if (sortBy === newSortBy) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
      return;
    }
    setSortBy(newSortBy);
    setSortOrder('desc');
  };

  const createAuditLog = (actionType: AuditActionType, targetStudentId?: string, payload?: Record<string, unknown>): SessionAuditLog => ({
    id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
    timestamp: new Date().toISOString(),
    actor: currentProctorName ?? 'Proctor',
    actionType,
    targetStudentId,
    sessionId: selectedScheduleId || '',
    payload,
  });

  const applyStudentAction = (session: StudentSession, action: 'warn' | 'pause' | 'resume' | 'terminate', payload?: unknown): StudentSession => {
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
            description: typeof payload === 'string' ? payload : 'Warning issued by proctor',
          },
        ],
      };
    }
    if (action === 'pause') return { ...session, status: 'paused' };
    if (action === 'resume') return { ...session, status: 'active' };
    return { ...session, status: 'terminated' };
  };

  const pushToast = useCallback((toast: Omit<(typeof toasts)[number], 'id'>) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
    setToasts((current) => [...current, { ...toast, id }]);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const runDisciplineAction = useCallback(
    async (studentId: string, action: 'warn' | 'pause' | 'resume' | 'terminate', payload?: unknown) => {
      const updatedSessions = [...sessions];
      const index = updatedSessions.findIndex((session) => session.id === studentId);
      if (index < 0) return { success: false, error: 'Student not found.' as const };
      const currentSession = updatedSessions[index];
      if (!currentSession) return { success: false, error: 'Student not found.' as const };

      let deliveryResult: { success: boolean; error?: string } = { success: true };
      if (action === 'warn') {
        deliveryResult = await examDeliveryService.warnStudent(
          studentId,
          typeof payload === 'string' ? payload : 'Warning issued by proctor',
          currentProctorName ?? 'Proctor',
        );
      } else if (action === 'pause') {
        deliveryResult = await examDeliveryService.pauseStudentAttempt(studentId, currentProctorName ?? 'Proctor');
      } else if (action === 'resume') {
        deliveryResult = await examDeliveryService.resumeStudentAttempt(studentId, currentProctorName ?? 'Proctor');
      } else if (action === 'terminate') {
        deliveryResult = await examDeliveryService.terminateStudentAttempt(studentId, currentProctorName ?? 'Proctor');
      }

      if (!deliveryResult.success) {
        const errorMessage = deliveryResult.error ?? 'Failed to execute student action';
        logger.error('Failed to execute student action:', errorMessage);
        return { success: false, error: errorMessage };
      }

      const nextSession = applyStudentAction(currentSession, action, payload);
      updatedSessions[index] = nextSession;
      onUpdateSessions(updatedSessions);
      return { success: true as const };
    },
    [currentProctorName, onUpdateSessions, sessions],
  );

  const requestDisciplineAction = useCallback(
    (session: StudentSession, action: 'warn' | 'pause' | 'resume' | 'terminate', payload?: unknown) => {
      if (action === 'pause' || action === 'terminate') {
        setConfirmDisciplineAction({
          scope: 'single',
          studentId: session.id,
          studentName: session.name,
          action,
        });
        return;
      }

      void (async () => {
        const result = await runDisciplineAction(session.id, action, payload);
        if (result.success) {
          pushToast({
            variant: 'success',
            title: 'Student updated',
            message: `${session.name}: ${action === 'resume' ? 'resumed' : action === 'warn' ? 'warned' : action}`,
          });
        } else {
          pushToast({
            variant: 'error',
            title: 'Student action failed',
            message: result.error,
          });
        }
      })();
    },
    [pushToast, runDisciplineAction],
  );

  const runBulkAction = useCallback(
    async (action: 'warn' | 'pause' | 'resume' | 'terminate', studentIds: string[]) => {
      const updatedSessions = [...sessions];
      let successCount = 0;
      let failureCount = 0;

      for (const studentId of studentIds) {
        const index = updatedSessions.findIndex((session) => session.id === studentId);
        if (index < 0) {
          failureCount += 1;
          continue;
        }
        const currentSession = updatedSessions[index];
        if (!currentSession) {
          failureCount += 1;
          continue;
        }

        let deliveryResult: { success: boolean; error?: string } = { success: true };
        if (action === 'warn') {
          deliveryResult = await examDeliveryService.warnStudent(studentId, 'Bulk warning issued by proctor', currentProctorName ?? 'Proctor');
        } else if (action === 'pause') {
          deliveryResult = await examDeliveryService.pauseStudentAttempt(studentId, currentProctorName ?? 'Proctor');
        } else if (action === 'resume') {
          deliveryResult = await examDeliveryService.resumeStudentAttempt(studentId, currentProctorName ?? 'Proctor');
        } else if (action === 'terminate') {
          deliveryResult = await examDeliveryService.terminateStudentAttempt(studentId, currentProctorName ?? 'Proctor');
        }

        if (deliveryResult.success) {
          updatedSessions[index] = applyStudentAction(currentSession, action);
          successCount += 1;
        } else {
          failureCount += 1;
        }
      }

      onUpdateSessions(updatedSessions);

      if (successCount > 0) {
        pushToast({
          variant: 'success',
          title: 'Bulk action complete',
          message: `${successCount} students updated.`,
        });
      }
      if (failureCount > 0) {
        pushToast({
          variant: 'error',
          title: 'Bulk action partial failure',
          message: `${failureCount} students failed to update.`,
        });
      }
    },
    [currentProctorName, onUpdateSessions, pushToast, sessions],
  );

  const requestBulkAction = useCallback(
    (action: 'warn' | 'pause' | 'resume' | 'terminate') => {
      const studentIds = [...selectedStudentIds];
      if (studentIds.length === 0) return;

      if (action === 'pause' || action === 'terminate') {
        setConfirmDisciplineAction({ scope: 'bulk', studentIds, action });
        return;
      }

      void runBulkAction(action, studentIds).then(() => {
        setSelectedStudentIds(new Set());
        setIsSelectionMode(false);
      });
    },
    [runBulkAction, selectedStudentIds],
  );

  const updateFilterCriterion = <K extends keyof typeof filterCriteria>(key: K, value: (typeof filterCriteria)[K]) => {
    setFilterCriteria((previous) => {
      if (value === undefined) {
        const next = { ...previous };
        delete next[key];
        return next;
      }
      return { ...previous, [key]: value };
    });
  };

  const controlDisabled = !selectedScheduleId;
  const selectedRuntimeStatus = selectedGroup?.runtimeStatus ?? 'not_started';
  const controlsBusy = pendingCohortAction !== null;
  const startDisabled =
    controlDisabled ||
    !selectedGroup?.isReadyToStart ||
    selectedRuntimeStatus === 'live' ||
    selectedRuntimeStatus === 'paused' ||
    selectedRuntimeStatus === 'completed' ||
    selectedRuntimeStatus === 'cancelled';

  const getStartDisabledReason = (): string | undefined => {
    if (controlsBusy) return 'An action is already in progress.';
    if (controlDisabled) return 'Select a cohort to enable controls.';
    if (!selectedGroup?.isReadyToStart) return 'This cohort is not ready to start yet.';
    if (selectedRuntimeStatus === 'live') return 'The exam is already live.';
    if (selectedRuntimeStatus === 'paused') return 'The exam is paused; resume or complete it instead.';
    if (selectedRuntimeStatus === 'completed') return 'The exam has already been completed.';
    if (selectedRuntimeStatus === 'cancelled') return 'This cohort has been cancelled.';
    return undefined;
  };

  const getPauseDisabledReason = (): string | undefined => {
    if (controlsBusy) return 'An action is already in progress.';
    if (controlDisabled) return 'Select a cohort to enable controls.';
    if (selectedRuntimeStatus !== 'live') return 'The exam must be live to pause the cohort.';
    return undefined;
  };

  const getResumeDisabledReason = (): string | undefined => {
    if (controlsBusy) return 'An action is already in progress.';
    if (controlDisabled) return 'Select a cohort to enable controls.';
    if (selectedRuntimeStatus !== 'paused') return 'The cohort must be paused to resume.';
    return undefined;
  };

  const getSectionControlDisabledReason = (): string | undefined => {
    if (controlsBusy) return 'An action is already in progress.';
    if (controlDisabled) return 'Select a cohort to enable controls.';
    if (selectedRuntimeStatus !== 'live' && selectedRuntimeStatus !== 'paused') return 'The exam must be live or paused to manage sections.';
    return undefined;
  };

  const getCompleteDisabledReason = (): string | undefined => {
    if (controlsBusy) return 'An action is already in progress.';
    if (controlDisabled) return 'Select a cohort to enable controls.';
    if (selectedRuntimeStatus === 'completed') return 'The exam has already been completed.';
    return undefined;
  };

  const runCohortAction = useCallback(
    async (action: CohortControlAction, options: { label: string; successMessage: string; fn: () => Promise<void> | void }) => {
      if (!selectedScheduleId) return;
      if (pendingCohortAction) return;

      setPendingCohortAction(action);
      try {
        await options.fn();
        pushToast({
          variant: 'success',
          title: options.label,
          message: options.successMessage,
        });
        return true;
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : typeof error === 'string' ? error : 'Unknown error';
        pushToast({
          variant: 'error',
          title: `${options.label} failed`,
          message: errorMessage,
        });
        return false;
      } finally {
        setPendingCohortAction(null);
      }
    },
    [pendingCohortAction, pushToast, selectedScheduleId],
  );

  return (
    <div className="grid h-full min-h-0 grid-rows-[auto_1fr] bg-slate-50">
      <ToastContainer position="top-right">
        {toasts.map((toast) => (
          <Toast
            key={toast.id}
            id={toast.id}
            variant={toast.variant}
            title={toast.title}
            message={toast.message}
            duration={toast.variant === 'error' ? 0 : 5_000}
            onClose={() => dismissToast(toast.id)}
          />
        ))}
      </ToastContainer>

      <section className="border-b border-slate-200 bg-white px-6 py-4">
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-start">
          <div className="grid gap-3">
            <div className="flex flex-wrap items-center gap-3">
              {selectedScheduleId ? (
                <button type="button" onClick={() => handleSelectSchedule(null)} className="inline-flex items-center gap-1 text-sm font-medium text-slate-500 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300 focus-visible:ring-offset-2 focus-visible:ring-offset-white">
                  <ChevronLeft size={16} />
                  All cohorts
                </button>
              ) : null}
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-400">Monitoring workspace</p>
            </div>
            <div>
              <h2 className="text-2xl font-semibold text-slate-950">
                {selectedGroup ? `${selectedGroup.examTitle} · ${selectedGroup.cohortName}` : 'Cohorts and students'}
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                {selectedGroup
                  ? `${filteredSessions.length} visible students, ${selectedGroup.violationCount} recorded violations`
                  : 'Select a cohort to open the roster and student activity drawer.'}
              </p>
            </div>
            {selectedRuntime ? (
              <PresenceIndicator
                proctorPresence={selectedRuntime.proctorPresence ?? []}
                currentProctorId={currentProctorId ?? 'unknown'}
                currentProctorName={currentProctorName ?? 'Proctor'}
                onJoin={() => {
                  if (!selectedScheduleId) {
                    return;
                  }

                  void backendPost(
                    `/v1/proctor/sessions/${selectedScheduleId}/presence`,
                    { action: 'join' },
                    { retries: 0 },
                  );
                }}
              />
            ) : null}
          </div>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            <button
              onClick={() =>
                void runCohortAction('start', {
                  label: 'Start exam',
                  successMessage: 'Exam started for the selected cohort.',
                  fn: async () => {
                    if (!selectedScheduleId) return;
                    await onStartScheduledSession(selectedScheduleId);
                  },
                })
              }
              disabled={startDisabled || controlsBusy}
              title={startDisabled || controlsBusy ? getStartDisabledReason() : undefined}
              aria-busy={pendingCohortAction === 'start'}
              className="inline-flex items-center justify-center gap-2 rounded-md bg-slate-950 px-3 py-2 text-sm font-medium text-white transition hover:bg-slate-800 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2 focus-visible:ring-offset-white disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500"
            >
              {pendingCohortAction === 'start' ? (
                <>
                  <LoadingMark size="sm" className="bg-white/40" />
                  <SrLoadingText>Starting…</SrLoadingText>
                </>
              ) : (
                <Play size={14} />
              )}
              {pendingCohortAction === 'start' ? 'Starting…' : 'Start Exam'}
            </button>
            <button
              onClick={() =>
                void runCohortAction('pause', {
                  label: 'Pause cohort',
                  successMessage: 'Cohort paused.',
                  fn: async () => {
                    if (!selectedScheduleId) return;
                    await onPauseCohort(selectedScheduleId);
                  },
                })
              }
              disabled={controlDisabled || selectedRuntimeStatus !== 'live' || controlsBusy}
              title={controlDisabled || selectedRuntimeStatus !== 'live' || controlsBusy ? getPauseDisabledReason() : undefined}
              aria-busy={pendingCohortAction === 'pause'}
              className="inline-flex items-center justify-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300 focus-visible:ring-offset-2 focus-visible:ring-offset-white disabled:cursor-not-allowed disabled:text-slate-400"
            >
              {pendingCohortAction === 'pause' ? (
                <>
                  <LoadingMark size="sm" className="bg-slate-200" />
                  <SrLoadingText>Pausing…</SrLoadingText>
                </>
              ) : (
                <Pause size={14} />
              )}
              {pendingCohortAction === 'pause' ? 'Pausing…' : 'Pause Cohort'}
            </button>
            <button
              onClick={() =>
                void runCohortAction('resume', {
                  label: 'Resume cohort',
                  successMessage: 'Cohort resumed.',
                  fn: async () => {
                    if (!selectedScheduleId) return;
                    await onResumeCohort(selectedScheduleId);
                  },
                })
              }
              disabled={controlDisabled || selectedRuntimeStatus !== 'paused' || controlsBusy}
              title={controlDisabled || selectedRuntimeStatus !== 'paused' || controlsBusy ? getResumeDisabledReason() : undefined}
              aria-busy={pendingCohortAction === 'resume'}
              className="inline-flex items-center justify-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300 focus-visible:ring-offset-2 focus-visible:ring-offset-white disabled:cursor-not-allowed disabled:text-slate-400"
            >
              {pendingCohortAction === 'resume' ? (
                <>
                  <LoadingMark size="sm" className="bg-slate-200" />
                  <SrLoadingText>Resuming…</SrLoadingText>
                </>
              ) : (
                <Play size={14} />
              )}
              {pendingCohortAction === 'resume' ? 'Resuming…' : 'Resume Cohort'}
            </button>
            <button
              onClick={() =>
                void runCohortAction('extend_5', {
                  label: 'Extend section',
                  successMessage: 'Current section extended by 5 minutes.',
                  fn: async () => {
                    if (!selectedScheduleId) return;
                    await onExtendCurrentSection(selectedScheduleId, 5);
                  },
                })
              }
              disabled={controlDisabled || (selectedRuntimeStatus !== 'live' && selectedRuntimeStatus !== 'paused') || controlsBusy}
              title={controlDisabled || (selectedRuntimeStatus !== 'live' && selectedRuntimeStatus !== 'paused') || controlsBusy ? getSectionControlDisabledReason() : undefined}
              aria-busy={pendingCohortAction === 'extend_5'}
              className="inline-flex items-center justify-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300 focus-visible:ring-offset-2 focus-visible:ring-offset-white disabled:cursor-not-allowed disabled:text-slate-400"
            >
              {pendingCohortAction === 'extend_5' ? (
                <>
                  <LoadingMark size="sm" className="bg-slate-200" />
                  <SrLoadingText>Extending…</SrLoadingText>
                </>
              ) : (
                <Timer size={14} />
              )}
              {pendingCohortAction === 'extend_5' ? 'Extending…' : 'Extend +5'}
            </button>
            <button
              onClick={() =>
                void runCohortAction('extend_10', {
                  label: 'Extend section',
                  successMessage: 'Current section extended by 10 minutes.',
                  fn: async () => {
                    if (!selectedScheduleId) return;
                    await onExtendCurrentSection(selectedScheduleId, 10);
                  },
                })
              }
              disabled={controlDisabled || (selectedRuntimeStatus !== 'live' && selectedRuntimeStatus !== 'paused') || controlsBusy}
              title={controlDisabled || (selectedRuntimeStatus !== 'live' && selectedRuntimeStatus !== 'paused') || controlsBusy ? getSectionControlDisabledReason() : undefined}
              aria-busy={pendingCohortAction === 'extend_10'}
              className="inline-flex items-center justify-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300 focus-visible:ring-offset-2 focus-visible:ring-offset-white disabled:cursor-not-allowed disabled:text-slate-400"
            >
              {pendingCohortAction === 'extend_10' ? (
                <>
                  <LoadingMark size="sm" className="bg-slate-200" />
                  <SrLoadingText>Extending…</SrLoadingText>
                </>
              ) : (
                <Timer size={14} />
              )}
              {pendingCohortAction === 'extend_10' ? 'Extending…' : 'Extend +10'}
            </button>
            <button
              onClick={() => setConfirmAction('complete')}
              disabled={controlDisabled || selectedRuntimeStatus === 'completed' || controlsBusy}
              title={controlDisabled || selectedRuntimeStatus === 'completed' || controlsBusy ? getCompleteDisabledReason() : undefined}
              aria-busy={pendingCohortAction === 'complete'}
              className="inline-flex items-center justify-center gap-2 rounded-md bg-red-700 px-3 py-2 text-sm font-medium text-white transition hover:bg-red-800 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-300 focus-visible:ring-offset-2 focus-visible:ring-offset-white disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500"
            >
              {pendingCohortAction === 'complete' ? (
                <>
                  <LoadingMark size="sm" className="bg-white/40" />
                  <SrLoadingText>Completing…</SrLoadingText>
                </>
              ) : (
                <StopCircle size={14} />
              )}
              {pendingCohortAction === 'complete' ? 'Completing…' : 'Complete'}
            </button>
          </div>
        </div>
        {selectedRuntime?.isOverrun ? (
          <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <div className="flex items-center gap-2 font-medium">
              <AlertTriangle size={16} />
              Runtime overrun
            </div>
            <p className="mt-1">Running past the scheduled window. Review extensions, current section timing, and cohort status.</p>
          </div>
        ) : null}
      </section>

      <ConfirmModal
        isOpen={confirmAction === 'complete'}
        onClose={() => setConfirmAction(null)}
        title="Complete exam for cohort?"
        description="This will end the exam for all candidates in the selected cohort. This action cannot be undone."
        confirmLabel="Complete exam"
        tone="danger"
        onConfirm={async () => {
          return await runCohortAction('complete', {
            label: 'Complete exam',
            successMessage: 'Exam completed for the cohort.',
            fn: async () => {
              if (!selectedScheduleId) return;
              await onCompleteExam(selectedScheduleId);
            },
          });
        }}
      />

      <ConfirmModal
        isOpen={confirmDisciplineAction?.scope === 'single' && confirmDisciplineAction.action === 'pause'}
        onClose={() => setConfirmDisciplineAction(null)}
        title={`Pause ${confirmDisciplineAction?.scope === 'single' ? confirmDisciplineAction.studentName : 'student'}?`}
        description="This will pause the student's session. You can resume it later."
        confirmLabel="Pause student"
        tone="warning"
        onConfirm={async () => {
          const current = confirmDisciplineAction;
          if (!current || current.scope !== 'single' || current.action !== 'pause') return;
          const result = await runDisciplineAction(current.studentId, 'pause');
          if (result.success) {
            pushToast({ variant: 'success', title: 'Student paused', message: `${current.studentName} paused.` });
          } else {
            pushToast({ variant: 'error', title: 'Pause failed', message: result.error });
          }
        }}
      />

      <ConfirmModal
        isOpen={confirmDisciplineAction?.scope === 'single' && confirmDisciplineAction.action === 'terminate'}
        onClose={() => setConfirmDisciplineAction(null)}
        title={`Terminate ${confirmDisciplineAction?.scope === 'single' ? confirmDisciplineAction.studentName : 'student'}?`}
        description="This will immediately terminate the student's session and force them to the post-exam phase. This action cannot be undone."
        confirmLabel="Terminate student"
        tone="danger"
        onConfirm={async () => {
          const current = confirmDisciplineAction;
          if (!current || current.scope !== 'single' || current.action !== 'terminate') return;
          const result = await runDisciplineAction(current.studentId, 'terminate');
          if (result.success) {
            pushToast({ variant: 'success', title: 'Student terminated', message: `${current.studentName} terminated.` });
          } else {
            pushToast({ variant: 'error', title: 'Terminate failed', message: result.error });
          }
        }}
      />

      <ConfirmModal
        isOpen={confirmDisciplineAction?.scope === 'bulk' && confirmDisciplineAction.action === 'pause'}
        onClose={() => setConfirmDisciplineAction(null)}
        title="Pause selected students?"
        description="This will pause every selected student's session. You can resume them later."
        confirmLabel="Pause selected"
        tone="warning"
        onConfirm={async () => {
          const current = confirmDisciplineAction;
          if (!current || current.scope !== 'bulk' || current.action !== 'pause') return;
          await runBulkAction('pause', current.studentIds);
          setSelectedStudentIds(new Set());
          setIsSelectionMode(false);
        }}
      />

      <ConfirmModal
        isOpen={confirmDisciplineAction?.scope === 'bulk' && confirmDisciplineAction.action === 'terminate'}
        onClose={() => setConfirmDisciplineAction(null)}
        title="Terminate selected students?"
        description="This will immediately terminate every selected student's session and force them to the post-exam phase. This action cannot be undone."
        confirmLabel="Terminate selected"
        tone="danger"
        onConfirm={async () => {
          const current = confirmDisciplineAction;
          if (!current || current.scope !== 'bulk' || current.action !== 'terminate') return;
          await runBulkAction('terminate', current.studentIds);
          setSelectedStudentIds(new Set());
          setIsSelectionMode(false);
        }}
      />

      <section className="min-h-0 overflow-auto px-6 py-5">
        {!selectedScheduleId ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {scheduleGroups.map((group) => (
              <ExamGroupCard key={group.id} group={group} onClick={() => handleSelectSchedule(group.scheduleId)} />
            ))}
          </div>
        ) : selectedStudent ? (
          <div className="grid h-full min-h-[560px] gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
            <aside className="grid min-h-0 grid-rows-[auto_1fr] overflow-hidden border border-black/10 bg-[#fcfbf8]">
              <div className="border-b border-black/10 px-4 py-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400">Cohort roster</p>
                    <h3 className="mt-1 text-base font-semibold text-slate-950">{selectedGroup?.cohortName}</h3>
                  </div>
                  <button type="button" onClick={() => setSelectedStudentId(null)} className="text-xs font-medium text-slate-500 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300 focus-visible:ring-offset-2 focus-visible:ring-offset-white">
                    Back to list
                  </button>
                </div>
              </div>
              <div className="min-h-0 overflow-auto">
                {filteredSessions.map((session) => (
                  <button
                    key={session.id}
                    type="button"
                    onClick={() => handleSelectStudent(session.id)}
                    className={`grid w-full gap-1 border-b border-black/5 px-4 py-3 text-left transition ${selectedStudentId === session.id ? 'bg-slate-950 text-white' : 'bg-transparent text-slate-900 hover:bg-black/[0.025]'}`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="truncate text-sm font-medium">{session.name}</span>
                      <span className={`text-[11px] ${selectedStudentId === session.id ? 'text-slate-300' : 'text-slate-400'}`}>
                        {session.violations.length} v
                      </span>
                    </div>
                    <div className={`truncate text-xs ${selectedStudentId === session.id ? 'text-slate-300' : 'text-slate-500'}`}>
                      {session.studentId} · {session.runtimeCurrentSection ?? session.currentSection ?? 'waiting'}
                    </div>
                  </button>
                ))}
              </div>
            </aside>

              <StudentDetailPanel
                student={selectedStudent}
                cohort={selectedGroup}
                alerts={selectedScheduleAlerts}
                auditLogs={scopedAuditLogs}
                notes={scopedNotes}
                activeTab={drawerTab}
                onTabChange={setDrawerTab}
                onClose={() => setSelectedStudentId(null)}
                onAction={async (action, payload) => {
                  if (!selectedStudent) return;
                  const result = await runDisciplineAction(selectedStudent.id, action, payload);
                  if (!result.success) {
                    throw new Error(result.error);
                  }
                }}
                onSaveNote={async (content, category) => {
                  if (!selectedScheduleId || !onUpdateNotes) return;
                  const newNote = {
                    id: `note-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
                    scheduleId: selectedScheduleId,
                    author: currentProctorName ?? 'Proctor',
                    timestamp: new Date().toISOString(),
                    content,
                    category,
                    isResolved: false,
                  };
                await examRepository.saveSessionNote(newNote);
                await examRepository.saveAuditLog(
                  createAuditLog('NOTE_CREATED', selectedStudent?.id, {
                    noteId: newNote.id,
                    category,
                  }),
                );
                onUpdateNotes([...notes, newNote]);
              }}
              onToggleNote={async (noteId) => {
                if (!onUpdateNotes) return;
                const note = notes.find((n) => n.id === noteId);
                if (!note) return;
                const updatedNote = { ...note, isResolved: !note.isResolved };
                await examRepository.saveSessionNote(updatedNote);
                onUpdateNotes(notes.map((n) => (n.id === noteId ? updatedNote : n)));
                }}
              />
          </div>
        ) : (
          <div className="grid gap-4">
            <div className="grid gap-3 rounded-md border border-slate-200 bg-white p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  {savedFilters.map((filter) => (
                    <button key={filter.id} onClick={() => applySavedFilter(filter.id)} className={`rounded-full px-3 py-1 text-xs font-medium ${activeFilterId === filter.id ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
                      {filter.name}
                    </button>
                  ))}
                  {hasActiveFilters ? (
                    <button onClick={clearFilters} className="text-xs font-medium text-slate-500 hover:text-slate-900">
                      Clear filters
                    </button>
                  ) : null}
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => setShowAdvancedFilters((value) => !value)} className={`inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium ${showAdvancedFilters ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}>
                    <Filter size={14} />
                    Filters
                  </button>
                  <button onClick={() => setListDensity((value) => (value === 'compact' ? 'comfortable' : 'compact'))} className="inline-flex items-center gap-2 rounded-md bg-slate-100 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-200">
                    {listDensity === 'compact' ? <LayoutGrid size={14} /> : <List size={14} />}
                    {listDensity === 'compact' ? 'Comfortable' : 'Compact'}
                  </button>
                </div>
              </div>

              {showAdvancedFilters ? (
                <div className="grid gap-3 border-t border-slate-100 pt-3 md:grid-cols-4">
                  <select value={filterCriteria.status || 'all'} onChange={(e) => updateFilterCriterion('status', e.target.value === 'all' ? undefined : (e.target.value as StudentStatus))} className="rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-700 outline-none">
                    <option value="all">All status</option>
                    <option value="active">Active</option>
                    <option value="warned">Warned</option>
                    <option value="paused">Paused</option>
                    <option value="terminated">Terminated</option>
                  </select>
                  <select value={filterCriteria.section || 'all'} onChange={(e) => updateFilterCriterion('section', e.target.value === 'all' ? undefined : (e.target.value as ModuleType))} className="rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-700 outline-none">
                    <option value="all">All sections</option>
                    <option value="listening">Listening</option>
                    <option value="reading">Reading</option>
                    <option value="writing">Writing</option>
                    <option value="speaking">Speaking</option>
                  </select>
                  <input type="number" min="0" value={filterCriteria.minViolations ?? ''} onChange={(e) => updateFilterCriterion('minViolations', e.target.value ? Number.parseInt(e.target.value, 10) : undefined)} placeholder="Min violations" className="rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-700 outline-none" />
                  <input type="number" min="0" value={filterCriteria.maxTimeRemaining ? Math.floor(filterCriteria.maxTimeRemaining / 60) : ''} onChange={(e) => updateFilterCriterion('maxTimeRemaining', e.target.value ? Number.parseInt(e.target.value, 10) * 60 : undefined)} placeholder="Max time (min)" className="rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-700 outline-none" />
                </div>
              ) : null}

              {hasActiveFilters ? (
                <div className="flex flex-wrap gap-2">
                  {filterCriteria.status ? <button type="button" aria-label="Remove status filter" onClick={() => removeFilter('status')} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-600">Status: {filterCriteria.status}<X size={12} aria-hidden="true" /></button> : null}
                  {filterCriteria.section ? <button type="button" aria-label="Remove section filter" onClick={() => removeFilter('section')} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-600">Section: {filterCriteria.section}<X size={12} aria-hidden="true" /></button> : null}
                  {filterCriteria.minViolations !== undefined ? <button type="button" aria-label="Remove minimum violations filter" onClick={() => removeFilter('minViolations')} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-600">Violations ≥ {filterCriteria.minViolations}<X size={12} aria-hidden="true" /></button> : null}
                  {filterCriteria.maxTimeRemaining !== undefined ? <button type="button" aria-label="Remove maximum time filter" onClick={() => removeFilter('maxTimeRemaining')} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-600">Time ≤ {Math.floor(filterCriteria.maxTimeRemaining / 60)}m<X size={12} aria-hidden="true" /></button> : null}
                </div>
              ) : null}
            </div>

            {isSelectionMode ? (
              <div className="grid gap-3 rounded-md border border-slate-200 bg-white px-4 py-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
                <div className="text-sm text-slate-700">{selectedStudentIds.size} students selected for bulk action.</div>
                <div className="flex flex-wrap items-center gap-2">
                  <button onClick={() => { setSelectedStudentIds(new Set(filteredSessions.map((session) => session.id))); setIsSelectionMode(true); }} className="inline-flex items-center gap-2 rounded-md bg-slate-100 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-200">
                    <CheckSquare size={14} />
                    Select all visible
                  </button>
                  <button onClick={() => requestBulkAction('warn')} className="rounded-md bg-amber-100 px-3 py-2 text-sm font-medium text-amber-800">Warn</button>
                  <button onClick={() => requestBulkAction('pause')} className="rounded-md bg-slate-100 px-3 py-2 text-sm font-medium text-slate-700">Pause</button>
                  <button onClick={() => requestBulkAction('resume')} className="rounded-md bg-emerald-100 px-3 py-2 text-sm font-medium text-emerald-800">Resume</button>
                  <button onClick={() => requestBulkAction('terminate')} className="rounded-md bg-red-100 px-3 py-2 text-sm font-medium text-red-800">Terminate</button>
                  <button onClick={() => { setSelectedStudentIds(new Set()); setIsSelectionMode(false); }} className="rounded-md bg-slate-950 px-3 py-2 text-sm font-medium text-white">Clear</button>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-3 rounded-md border border-slate-200 bg-white px-4 py-3">
                <div className="flex flex-wrap items-center gap-3 text-sm text-slate-500">
                  <span>{filteredSessions.length} students</span>
                  <span>{selectedScheduleAlerts.filter((alert) => !alert.isAcknowledged).length} open alerts</span>
                  <span>{scopedNotes.length} notes</span>
                </div>
                <button onClick={() => setIsSelectionMode(true)} className="inline-flex items-center gap-2 rounded-md bg-slate-100 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-200">
                  <Square size={14} />
                  Bulk select
                </button>
              </div>
            )}

            <div className="overflow-hidden rounded-md border border-slate-200 bg-white">
              <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,1.1fr)_120px_120px_120px] gap-3 border-b border-slate-200 px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400">
                <button onClick={() => toggleSort('name')} className="text-left">Student</button>
                <div>Section</div>
                <button onClick={() => toggleSort('status')} className="text-left">Status</button>
                <button onClick={() => toggleSort('violations')} className="text-left">Violations</button>
                <div>Last active</div>
              </div>
              <div className="divide-y divide-slate-100">
                {filteredSessions.map((session) => (
                  <StudentCard
                    key={session.id}
                    session={session}
                    isSelected={selectedStudentId === session.id}
                    isSelectionEnabled={isSelectionMode}
                    isMultiSelected={selectedStudentIds.has(session.id)}
                    compact={listDensity === 'compact'}
                    onClick={() => handleSelectStudent(session.id)}
                    onAction={(action) => requestDisciplineAction(session, action)}
                    onToggleSelection={(event) => {
                      event.stopPropagation();
                      handleToggleStudentSelection(session.id);
                    }}
                  />
                ))}
                {filteredSessions.length === 0 ? <div className="px-4 py-10 text-center text-sm text-slate-500">No students match the current cohort filters.</div> : null}
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  );
});
