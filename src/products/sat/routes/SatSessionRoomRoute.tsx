import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ArrowLeft, UserRound } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { SatPageError, SatPageLoading } from '../ui/SatPage';
import { logError, logInfo } from '../../../shared/observability/errorLogger';
import { useAuthSession } from '../../../features/auth/authSession';
import { resolveRoomClock, useAuthoritativeDeadlineClock, useRoomClockMs } from '../../../shared/hooks/useAuthoritativeDeadlineClock';
import { useProctorRouteController } from '../../../features/proctor/hooks/useProctorRouteController';
import { examDeliveryService } from '../../../features/proctor/infrastructure/proctorGateway';
import { SatStatusPill } from '../ui/SatPage';
import { SatSessionControls } from '../ui/SatSessionControls';
import { SatSessionContextBar, getSatRoomMode, roomStatusTone, runtimeLabel } from '../ui/SatSessionContextBar';
import { SAT_SESSION_WARN_MESSAGE, SatSessionRoomConfirmDialog, type SatSessionRoomConfirmation } from '../ui/SatSessionRoomConfirmDialog';
import { SatSessionRoomInspector } from '../ui/SatSessionRoomInspector';
import { SatSessionRoomRoster } from '../ui/SatSessionRoomRoster';
import { SatSessionRoomTimeline } from '../ui/SatSessionRoomTimeline';
import { StudentDetail } from '../ui/SatSessionRoomStudents';
import { buildSatRunSheet, formatRunSheetRemaining, satRunSheetCurrentRows } from '../ui/sessionRunSheet';
import { satPublishScopeCopy } from '../../../features/exam-authoring/ui/release/releaseSelectors';
import '../ui/sat-session-room.css';

const RELOAD_FAILED_SUFFIX = ' However, the live view could not refresh. Retry to confirm.';
export function SatSessionRoomRoute() {
  const { scheduleId } = useParams<{ scheduleId: string }>();
  const navigate = useNavigate();
  const { session } = useAuthSession();
  const controller = useProctorRouteController({ providerKey: 'sat', initialScheduleId: scheduleId ?? null });
  const [search, setSearch] = useState('');
  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(null);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [pendingActions, setPendingActions] = useState<ReadonlySet<string>>(() => new Set());
  const [message, setMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [confirm, setConfirm] = useState<SatSessionRoomConfirmation | null>(null);
  const [attentionFilter, setAttentionFilter] = useState<'all' | 'needs'>('all');
  const messageRef = useRef(message);
  const inspectorTriggerRef = useRef<HTMLElement | null>(null);
  messageRef.current = message;
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const schedule = controller.schedules.find((item) => item.id === scheduleId) ?? null;
  const runtime = controller.runtimeSnapshots.find((item) => item.scheduleId === scheduleId) ?? null;
  const runtimeStatus = runtime?.status ?? 'not_started';
  const students = useMemo(() => controller.sessions.filter((item) => item.scheduleId === scheduleId), [controller.sessions, scheduleId]);
  const visibleStudents = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    return students.filter((student) => {
      const matchesSearch = !needle || [student.name, student.studentId, student.email].some((value) => value.toLocaleLowerCase().includes(needle));
      const matchesAttention = attentionFilter === 'all' || student.warnings > 0 || student.violations.length > 0;
      return matchesSearch && matchesAttention;
    });
  }, [attentionFilter, search, students]);
  const selectedStudent = students.find((student) => student.id === selectedStudentId) ?? students[0] ?? null;
  const currentStageStatus = runtime?.sections.find((section) => section.sectionKey === runtime?.currentSectionKey)?.status ?? null;
  // The room's own clock: ONE accepted server instant (the freshest read of the
  // refresh, paired with the instant it landed) plus the shared 1s tick. The
  // hero clock, the run sheet, every roster row and the inspector all read the
  // same instant, so no two windows on this page can count the same deadline
  // seconds apart.
  const roomClock = useMemo(
    () => resolveRoomClock(controller.roomClock, runtime?.serverNow ?? null),
    [controller.roomClock, runtime?.serverNow],
  );
  const serverNowMs = useRoomClockMs(roomClock);
  const stageRemainingSeconds = useAuthoritativeDeadlineClock({
    deadlineAt: runtime?.currentSectionDeadlineAt ?? null,
    serverNow: runtime?.serverNow ?? null,
    fallbackSeconds: runtime?.currentSectionRemainingSeconds ?? 0,
    running: runtime?.status === 'live' && currentStageStatus === 'live',
    roomClock,
  });
  // ONE projection for the header and the table: the room builds the run sheet
  // from its own ticking clock and hands the same rows to the table, so "which
  // section and which module are we in?" has exactly one answer on the page.
  const runSheet = useMemo(
    () => buildSatRunSheet({
      plan: runtime?.examPlan ?? null,
      runtime: runtime ?? null,
      scheduledStartAt: schedule?.startTime ?? null,
      now: new Date(serverNowMs).toISOString(),
    }),
    [runtime, schedule?.startTime, serverNowMs],
  );
  const stageRows = satRunSheetCurrentRows(runSheet);
  const cohortStageRemainingSeconds = stageRows.break?.remainingSeconds ?? stageRemainingSeconds;
  const roomMode = runtime ? getSatRoomMode(runtime.status) : 'prestart';
  const sessionLive = runtime?.status === 'live' || runtime?.status === 'paused';
  const sessionFinished = runtime?.status === 'completed';
  const currentStage = sessionFinished
    ? 'Session finished'
    : runtime?.status === 'cancelled'
      ? 'Session cancelled'
      : stageRows.break
        ? 'Break'
        : runtime?.sections.find((section) => section.sectionKey === runtime.currentSectionKey)?.label
          ?? runtime?.currentSectionKey
          ?? (runtime?.status === 'not_started' ? 'Ready to begin' : 'Waiting for next section');
  const attentionCount = students.filter((student) => student.warnings > 0 || student.violations.length > 0).length;
  const selectStudent = (studentId: string, trigger: HTMLElement) => {
    inspectorTriggerRef.current = trigger;
    setSelectedStudentId(studentId);
    setInspectorOpen(true);
  };
  const activeStudentCount = students.filter((student) => student.status === 'active').length;
  const proctorName = session?.user.displayName?.trim() || session?.user.email || 'Proctor';
  const openAlerts = controller.alerts.filter((alert) => !alert.isAcknowledged).length;
  const isStale = Boolean(controller.error);
  const lastUpdatedLabel = controller.lastSuccessfulRefreshAt
    ? new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', second: '2-digit' }).format(new Date(controller.lastSuccessfulRefreshAt))
    : 'unknown';

  useEffect(() => {
    if (!selectedStudentId && students[0]) setSelectedStudentId(students[0].id);
    if (selectedStudentId && !students.some((student) => student.id === selectedStudentId)) setSelectedStudentId(students[0]?.id ?? null);
  }, [selectedStudentId, students]);

  // F-B16: success scoping — clear transient success banners on selection
  // change so a stale "added N minutes" never follows the next student.
  // Errors persist until the next action clears them explicitly.
  useEffect(() => {
    if (messageRef.current?.kind === 'success') setMessage(null);
  }, [selectedStudentId]);

  const setActionPending = useCallback((key: string, active: boolean) => {
    setPendingActions((current) => {
      if (current.has(key) === active) return current;
      const next = new Set(current);
      if (active) next.add(key);
      else next.delete(key);
      return next;
    });
  }, []);

  const run = useCallback(async (key: string, action: () => Promise<void>, success: string) => {
    if (pendingActions.has(key)) return;
    setActionPending(key, true);
    setMessage(null);
    const startedAt = Date.now();
    try {
      await action();
      try {
        await controller.reload();
      } catch (reloadError) {
        logError(reloadError, { scope: 'sat.session.action.reload', action: key, scheduleId, latencyMs: Date.now() - startedAt });
        if (mountedRef.current) setMessage({ kind: 'error', text: `${success}${RELOAD_FAILED_SUFFIX}` });
        return;
      }
      // IDs only — never student names or emails (PII).
      logInfo('sat.session.action', { action: key, scheduleId, latencyMs: Date.now() - startedAt, outcome: 'success' });
      if (mountedRef.current) setMessage({ kind: 'success', text: success });
    } catch (error) {
      logError(error, { scope: 'sat.session.action', action: key, scheduleId, latencyMs: Date.now() - startedAt });
      if (mountedRef.current) {
        setMessage({ kind: 'error', text: error instanceof Error ? error.message : 'The action could not be completed.' });
      }
    } finally {
      if (mountedRef.current) setActionPending(key, false);
    }
  }, [controller, pendingActions, scheduleId, setActionPending]);

  const runStudentAction = async (key: string, action: () => Promise<{ success: boolean; error?: string }>, success: string) => run(key, async () => {
    const result = await action();
    if (!result.success) throw new Error(result.error ?? 'The student could not be updated.');
  }, success);

  const confirmCurrentAction = () => {
    const action = confirm;
    setConfirm(null);
    if (!action || !scheduleId) return;
    if (action.kind === 'complete') {
      void run('complete', () => controller.handleCompleteExam(scheduleId), 'Session completed.');
      return;
    }
    if (action.kind === 'extend-session') {
      void run(`extend-${action.minutes}`, () => controller.handleExtendCurrentSection(scheduleId, action.minutes), `Added ${action.minutes} minutes to the current stage.`);
      return;
    }
    const bound = students.find((student) => student.id === action.studentId);
    if (!bound) {
      if (mountedRef.current) {
        const outcome = action.kind === 'warn'
          ? 'no warning was sent'
          : action.kind === 'extend-student'
            ? 'no time was added'
            : 'their attempt was not ended';
        setMessage({ kind: 'error', text: `${action.studentName} is no longer in this session, so ${outcome}.` });
      }
      return;
    }
    if (action.kind === 'warn') {
      void runStudentAction('student-warn', () => examDeliveryService.warnStudent(bound.id, SAT_SESSION_WARN_MESSAGE, proctorName), `Warning sent to ${bound.name}.`);
      return;
    }
    if (action.kind === 'extend-student') {
      void runStudentAction(`student-extend-${action.minutes}`, () => examDeliveryService.extendStudentAttempt(bound.id, proctorName, action.minutes), `Added ${action.minutes} minutes for ${bound.name}.`);
      return;
    }
    void runStudentAction('student-terminate', () => examDeliveryService.terminateStudentAttempt(bound.id, proctorName), `${bound.name}’s attempt ended.`);
  };

  const inspectorContent = selectedStudent ? (
        <StudentDetail
          key={selectedStudent.id}
          student={selectedStudent}
          runtime={runtime}
          roomClock={roomClock}
          variant={roomMode === 'review' ? 'review' : 'operational'}
          pendingActions={pendingActions}
          blocked={isStale}
          onAddTime={(minutes) => {
            if (isStale) return;
            setConfirm({
              kind: 'extend-student',
              minutes,
              studentId: selectedStudent.id,
              studentName: selectedStudent.name,
              remainingLabel: formatRunSheetRemaining(selectedStudent.runtimeTimeRemainingSeconds ?? selectedStudent.timeRemaining),
            });
          }}
          onWarn={() => setConfirm({ kind: 'warn', studentId: selectedStudent.id, studentName: selectedStudent.name })}
          onPause={() => void runStudentAction('student-pause', () => examDeliveryService.pauseStudentAttempt(selectedStudent.id, proctorName), `${selectedStudent.name} paused.`)}
          onResume={() => void runStudentAction('student-resume', () => examDeliveryService.resumeStudentAttempt(selectedStudent.id, proctorName), `${selectedStudent.name} resumed.`)}
          onTerminate={() => setConfirm({ kind: 'terminate', studentId: selectedStudent.id, studentName: selectedStudent.name })}
        />
      ) : (
        <div className="sat-room__empty">
          <div className="sat-room__empty-content">
            <span className="sat-room__empty-icon" aria-hidden="true"><UserRound size={20} /></span>
          <p className="sat-room__empty-title">{sessionFinished ? 'Session finished' : sessionLive ? 'Select a student' : runtimeStatus === 'not_started' ? 'Waiting to begin' : 'Session cancelled'}</p>
            <p className="sat-room__empty-text">
              {sessionLive
                ? 'Choose a student in the roster to inspect their progress, timing, and integrity events.'
                : sessionFinished
                  ? 'The run sheet remains available above for a review of the completed session.'
                  : runtimeStatus === 'not_started'
                    ? 'This workspace becomes operational as soon as you start the session. Students appear in the roster as they open their exam link.'
                    : 'This session was cancelled. The run sheet above shows the timeline recorded so far.'}
            </p>
            {runtimeStatus === 'not_started' ? <p className="sat-room__empty-hint">{students.length ? `${students.length} student${students.length === 1 ? '' : 's'} already connected.` : 'No students have joined yet.'}</p> : null}
          </div>
        </div>
      );

  if (!scheduleId) return <SatPageError title="SAT session not found" description="A valid SAT session is required." retryLabel="Back to Sessions" onRetry={() => navigate('/sat/sessions')} />;
  if (controller.isLoading && !schedule) return <SatPageLoading label="Opening SAT session…" />;
  if (controller.error && !schedule) return <SatPageError title="SAT session could not load" description={controller.error} retryLabel="Retry" onRetry={() => void controller.reload()} />;
  if (!schedule || !runtime) return <SatPageError title="SAT session not found" description="This session is not part of the Digital SAT workspace." retryLabel="Back to Sessions" onRetry={() => navigate('/sat/sessions')} />;

  return (
    <div className="sat-room sat-product" data-sat-room-mode={roomMode}>
      <header className="sat-room__header">
        <div className="sat-room__header-inner">
          <button type="button" onClick={() => navigate('/sat/sessions')} className="flex min-h-10 shrink-0 items-center gap-1 rounded-[10px] px-2 text-[13px] font-semibold text-[var(--sat-staff-text-secondary,#515154)] hover:bg-[var(--sat-staff-fill-chip,rgba(0,0,0,0.04))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-staff-accent-ring,rgba(0,113,227,0.4))]"><ArrowLeft size={16} />Sessions</button>
          <div className="h-5 w-px bg-[var(--sat-staff-border-input,rgba(0,0,0,0.075))]" aria-hidden="true" />
          <div className="sat-room__title"><div className="flex items-center gap-2"><h1>{schedule.examTitle}</h1><SatStatusPill tone={roomStatusTone(runtime.status)} pulse={runtime.status === 'live'}>{runtimeLabel(runtime.status)}</SatStatusPill></div><p className="sat-room__cohort">{schedule.cohortName} · {satPublishScopeCopy(schedule.publishScope ?? 'full')}</p></div>
          {controller.error ? <span className="inline-flex items-center gap-1 text-[11px] font-semibold tabular-nums text-[var(--sat-staff-warning-text,#92400e)]"><AlertTriangle size={11} aria-hidden="true" />Reconnecting</span> : null}
          <SatSessionControls runtimeStatus={runtime.status} pendingActions={pendingActions} blocked={isStale} onStart={() => void run('start', () => controller.handleStartScheduledSession(scheduleId), 'Session started.')} onPause={() => void run('pause', () => controller.handlePauseCohort(scheduleId), 'Session paused.')} onResume={() => void run('resume', () => controller.handleResumeCohort(scheduleId), 'Session resumed.')} onExtend={(minutes) => { if (isStale) return; setConfirm({ kind: 'extend-session', minutes, stage: currentStage, remainingLabel: formatRunSheetRemaining(cohortStageRemainingSeconds) }); }} onComplete={() => setConfirm({ kind: 'complete' })} />
        </div>
      </header>

      <SatSessionContextBar
        runtime={runtime}
        scheduledStartAt={schedule.startTime}
        joinedCount={students.length}
        activeCount={activeStudentCount}
        attentionCount={attentionCount}
        openAlerts={openAlerts}
        isStale={isStale}
        lastUpdatedLabel={lastUpdatedLabel}
        onNeedsAttention={() => setAttentionFilter('needs')}
      />

      {isStale ? <div role="alert" className="sat-banner-enter mx-auto flex w-full max-w-[1500px] items-center justify-between gap-3 px-4 pt-3"><div className="rounded-2xl border border-amber-700/15 bg-[var(--sat-staff-warning-tint,rgba(217,119,6,0.1))] px-3.5 py-2.5 text-[11px] font-medium text-amber-800"><span className="font-semibold">Data may be out of date.</span> Risky session actions are paused until reconnection.</div><button type="button" onClick={() => void controller.reload()} className="min-h-9 shrink-0 rounded-[var(--sat-staff-radius-control,10px)] bg-[var(--sat-staff-surface,#fff)] px-3 text-[11px] font-semibold text-[var(--sat-staff-text-primary,#1d1d1f)] shadow-sm ring-1 ring-[var(--sat-staff-border-strong,rgba(0,0,0,0.09))] hover:bg-[var(--sat-staff-fill-chip,rgba(0,0,0,0.04))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-staff-accent-ring,rgba(0,113,227,0.4))]">Retry</button></div> : null}
      {message ? <div role={message.kind === 'error' ? 'alert' : 'status'} className="sat-banner-enter mx-auto max-w-[1500px] px-4 pt-3"><div className={message.kind === 'error' ? 'rounded-2xl border border-red-700/20 bg-[var(--sat-staff-danger-tint,rgba(217,45,32,0.08))] px-3.5 py-2.5 text-[11px] font-medium text-[var(--sat-staff-danger,#b42318)]' : 'rounded-2xl border border-[var(--sat-staff-border-hairline,rgba(0,0,0,0.06))] bg-[var(--sat-staff-fill-chip,rgba(0,0,0,0.04))] px-3.5 py-2.5 text-[11px] font-medium text-[var(--sat-staff-text-secondary,#515154)]'}>{message.text}</div></div> : null}

      <main className="sat-room__body">
        <SatSessionRoomRoster
          students={students}
          visibleStudents={visibleStudents}
          selectedStudent={selectedStudent}
          runtime={runtime}
          roomClock={roomClock}
          search={search}
          onSearchChange={setSearch}
          attentionFilter={attentionFilter}
          onAttentionFilterChange={setAttentionFilter}
          attentionCount={attentionCount}
          onSelect={selectStudent}
        />

        <SatSessionRoomTimeline
          key={runtime.scheduleId}
          runtime={runtime}
          scheduledStartAt={schedule.startTime}
          runSheet={runSheet}
          roomMode={roomMode}
          sessionLive={sessionLive}
          currentStage={currentStage}
          remainingSeconds={cohortStageRemainingSeconds}
        />

        <SatSessionRoomInspector
          open={inspectorOpen}
          onOpenChange={setInspectorOpen}
          restoreFocusTarget={() => inspectorTriggerRef.current}
        >
          {inspectorContent}
        </SatSessionRoomInspector>
      </main>

      <SatSessionRoomConfirmDialog
        confirm={confirm}
        onCancel={() => setConfirm(null)}
        onConfirm={confirmCurrentAction}
      />
    </div>
  );
}
