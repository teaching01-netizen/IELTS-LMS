import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ArrowLeft, QrCode, UserRound } from 'lucide-react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { isExamDeliveryPath } from './satReturnPath';
import { SatPageError, SatPageLoading } from '../ui/SatPage';
import { logError, logInfo } from '../../../shared/observability/errorLogger';
import { useAuthSession } from '../../../features/auth/authSession';
import { useAuthoritativeDeadlineClock, useRoomClockMs } from '../../../shared/hooks/useAuthoritativeDeadlineClock';
import { useProctorRouteController } from '../../../features/proctor/hooks/useProctorRouteController';
import { examDeliveryService } from '../../../features/proctor/infrastructure/proctorGateway';
import { SatStatusPill } from '../ui/SatPage';
import { SatSessionControls } from '../ui/SatSessionControls';
import { SatSessionContextBar, getSatRoomMode, roomStatusTone, runtimeLabel } from '../ui/SatSessionContextBar';
import { SAT_SESSION_WARN_MESSAGE, SatSessionRoomConfirmDialog, type SatSessionRoomConfirmation } from '../ui/SatSessionRoomConfirmDialog';
import { SatSessionRoomInspector } from '../ui/SatSessionRoomInspector';
import { useSatRoomLayout } from '../ui/useSatRoomLayout';
import { SatDeviceTransferRequests } from '../ui/SatDeviceTransferRequests';
import { SatSessionRoomRoster, type SatRosterSort } from '../ui/SatSessionRoomRoster';
import { SatSessionRoomTimeline } from '../ui/SatSessionRoomTimeline';
import { StudentDetail, studentAttentionReason } from '../ui/SatSessionRoomStudents';
import { satListReturnTarget } from '../ui/useSatListReturn';
import { SatStudentLinkCard, SatStudentLinkPresent } from '../ui/SatStudentLink';
import { StudentShareDialog } from '../../../features/exam-authoring/ui/access-links/AccessLinkShareSheet';
import { describeAccessLinkAudience, formatAccessLinkStatus, roomEntryUrl } from '../../../features/exam-authoring/ui/access-links/accessLinkUi';
import { buildSatRunSheet, formatRunSheetRemaining, satRunSheetCurrentRows, satRunSheetTimingPlan } from '../ui/sessionRunSheet';
import { isSatStageLive } from '../ui/satStage';
import { satPublishScopeCopy } from '../../../features/exam-authoring/ui/release/releaseSelectors';
import { useAccessDistributionOverview } from '../../../features/exam-authoring/api/assessmentAccessLinkQueries';
import { ACCESS_LINK_SECTION_LABELS, effectiveAccessLinkSections } from '../../../features/exam-authoring/contracts/accessLinks';
import { sessionPhaseFromRuntime, sessionStatusLine } from '../../../features/exam-authoring/ui/delivery/sessionState';
import { examWorkspacePath } from '../../../features/exam-authoring/ui/shell/examLifecycle';
import { SatWaitingRoomPanel } from '../ui/SatWaitingRoomPanel';
import '../ui/sat-session-room.css';

const RELOAD_FAILED_SUFFIX = ' However, the live view could not refresh. Retry to confirm.';
export function SatSessionRoomRoute() {
  const { scheduleId } = useParams<{ scheduleId: string }>();
  const navigate = useNavigate();
  // Arriving from a test's Sessions tab keeps Back pointed at that test and session.
  const from = (useLocation().state as { from?: unknown } | null)?.from;
  const deliveryReturn = isExamDeliveryPath(from) ? from : null;
  const { session } = useAuthSession();
  const controller = useProctorRouteController({ providerKey: 'sat', initialScheduleId: scheduleId ?? null });
  const [search, setSearch] = useState('');
  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(null);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [pendingActions, setPendingActions] = useState<ReadonlySet<string>>(() => new Set());
  const [message, setMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [confirm, setConfirm] = useState<SatSessionRoomConfirmation | null>(null);
  const [attentionFilter, setAttentionFilter] = useState<'all' | 'needs'>('all');
  const [rosterSort, setRosterSort] = useState<SatRosterSort>('name');
  const [pendingTransfers, setPendingTransfers] = useState<ReadonlySet<string>>(() => new Set());
  const [shareOpen, setShareOpen] = useState(false);
  const [presentOpen, setPresentOpen] = useState(false);
  const messageRef = useRef(message);
  const inspectorTriggerRef = useRef<HTMLElement | null>(null);
  const { layout: roomLayout, ref: roomLayoutRef } = useSatRoomLayout();
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
  const isAdmin = session?.user.role === 'admin';
  // Only roles that may read the exam's access setup see its version pin and check-in state;
  // everyone else is shown the exam run state alone (never a guess about check-in).
  const accessOverview = useAccessDistributionOverview(schedule?.examId ?? '', isAdmin && Boolean(schedule));
  const accessLink = accessOverview.data?.links.find((link) => link.scheduleId === scheduleId) ?? null;
  const attentionReasons = useMemo(() => {
    const reasons = new Map<string, string>();
    for (const student of students) {
      const reason = studentAttentionReason(student, pendingTransfers.has(student.id));
      if (reason) reasons.set(student.id, reason);
    }
    return reasons;
  }, [pendingTransfers, students]);
  const visibleStudents = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    return students.filter((student) => {
      const matchesSearch = !needle || [student.name, student.studentId, student.email].some((value) => value.toLocaleLowerCase().includes(needle));
      const matchesAttention = attentionFilter === 'all' || attentionReasons.has(student.id);
      return matchesSearch && matchesAttention;
    });
  }, [attentionFilter, attentionReasons, search, students]);
  const selectedStudent = students.find((student) => student.id === selectedStudentId) ?? students[0] ?? null;
  // The room's own clock, resolved by the controller: ONE server instant plus the
  // shared 1s tick. The hero clock, the run sheet, every roster row and the
  // inspector all read this same instant, so no two windows on this page can
  // count the same deadline seconds apart.
  const roomClock = controller.roomClock;
  const serverNowMs = useRoomClockMs(roomClock);
  const stageRemainingSeconds = useAuthoritativeDeadlineClock({
    deadlineAt: runtime?.currentSectionDeadlineAt ?? null,
    serverNow: runtime?.serverNow ?? null,
    fallbackSeconds: runtime?.currentSectionRemainingSeconds ?? 0,
    running: isSatStageLive(runtime),
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
      // The stored timing plan decides what the rows MEAN: a personal-model
      // session is handed a per-candidate window (the section rows are this
      // sheet's projection), a cohort one is capped by the shared section clock.
      timingModel: runtime?.timingModel ?? null,
    }),
    [runtime, schedule?.startTime, serverNowMs],
  );
  const stageRows = satRunSheetCurrentRows(runSheet);
  const cohortStageRemainingSeconds = stageRows.break?.remainingSeconds ?? stageRemainingSeconds;
  const roomMode = runtime ? getSatRoomMode(runtime.status) : 'prestart';
  const sessionLive = runtime?.status === 'live' || runtime?.status === 'paused';
  const sessionFinished = runtime?.status === 'completed';
  const currentStage = sessionFinished
    ? 'Room finished'
    : runtime?.status === 'cancelled'
      ? 'Room cancelled'
      : stageRows.break
        ? 'Break'
        : runtime?.sections.find((section) => section.sectionKey === runtime.currentSectionKey)?.label
          ?? runtime?.currentSectionKey
          ?? (runtime?.status === 'not_started' ? 'Ready to begin' : 'Waiting for next section');
  const attentionCount = attentionReasons.size;
  const statusLine = sessionStatusLine(accessLink?.status ?? null, sessionPhaseFromRuntime(runtime?.status, schedule?.status));
  const sectionsLabel = accessLink
    ? effectiveAccessLinkSections(accessLink.enabledSections, accessLink.publishScope).map((key) => ACCESS_LINK_SECTION_LABELS[key]).join(' and ') || 'None available'
    : satPublishScopeCopy(schedule?.publishScope ?? 'full');
  const readyCount = controller.scheduleMetrics[scheduleId ?? '']?.joinReadyCount ?? null;
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
    if (action.kind === 'start') {
      void run('start', () => controller.handleStartScheduledSession(scheduleId), 'Exam started.');
      return;
    }
    if (action.kind === 'complete') {
      void run('complete', () => controller.handleCompleteExam(scheduleId), 'Room completed.');
      return;
    }
    if (action.kind === 'extend-session') {
      void runStudentAction(`extend-${action.minutes}`, () => examDeliveryService.extendCurrentSection(scheduleId, proctorName, action.minutes, action.sectionKey, action.runtimeRevision), `Added ${action.minutes} minutes to ${action.stage}.`);
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
        setMessage({ kind: 'error', text: `${action.studentName} is no longer in this room, so ${outcome}.` });
      }
      return;
    }
    if (action.kind === 'warn') {
      void runStudentAction('student-warn', () => examDeliveryService.warnStudent(bound.id, SAT_SESSION_WARN_MESSAGE, proctorName), `Warning sent to ${bound.name}.`);
      return;
    }
    if (action.kind === 'extend-student') {
      void runStudentAction(`student-extend-${action.minutes}`, () => examDeliveryService.extendStudentAttempt(bound.id, proctorName, action.minutes, action.moduleId), `Added ${action.minutes} minutes for ${bound.name}.`);
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
              moduleId: selectedStudent.runtimeCurrentModuleId ?? '',
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
          <p className="sat-room__empty-title">{sessionFinished ? 'Room finished' : sessionLive ? 'Select a student' : runtimeStatus === 'not_started' ? 'Waiting to begin' : 'Room cancelled'}</p>
            <p className="sat-room__empty-text">
              {sessionLive
                ? 'Choose a student in the roster to inspect their progress, timing, and integrity events.'
                : sessionFinished
                  ? 'The run sheet remains available above for a review of the completed session.'
                  : runtimeStatus === 'not_started'
                    ? 'This workspace becomes operational as soon as you start the session. Students appear in the roster as they open their exam link.'
                    : 'This room was cancelled. The run sheet above shows the timeline recorded so far.'}
            </p>
            {runtimeStatus === 'not_started' ? <p className="sat-room__empty-hint">{students.length ? `${students.length} student${students.length === 1 ? '' : 's'} already connected.` : 'No students have joined yet.'}</p> : null}
            {runtimeStatus === 'not_started' ? <button type="button" onClick={() => setShareOpen(true)} className="mt-4 min-h-11 rounded-[var(--sat-staff-radius-control,10px)] bg-[var(--sat-staff-fill-chip,rgba(0,0,0,0.04))] px-3.5 text-[14px] font-semibold text-[var(--sat-staff-text-primary,#1d1d1f)] hover:bg-[var(--sat-staff-fill-chip-hover,rgba(0,0,0,0.07))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-staff-accent-ring,rgba(0,113,227,0.4))]">Share student link</button> : null}
          </div>
        </div>
      );

  if (!scheduleId) return <SatPageError title="SAT room not found" description="A valid SAT room is required." retryLabel="Back to Rooms" onRetry={() => navigate('/sat/sessions')} />;
  if (controller.isLoading && !schedule) return <SatPageLoading label="Opening SAT room…" />;
  if (controller.error && !schedule) return <SatPageError title="SAT room could not load" description={controller.error} retryLabel="Retry" onRetry={() => void controller.reload()} />;
  if (!schedule || !runtime) return <SatPageError title="SAT room not found" description="This room is not part of the Digital SAT workspace." retryLabel="Back to Rooms" onRetry={() => navigate('/sat/sessions')} />;

  // The test's Sessions tab reopens with this session selected.
  const entryUrl = roomEntryUrl({ accessLinkId: accessLink?.id ?? null, scheduleId });
  const testSessionsPath = `${examWorkspacePath(schedule.examId, 'delivery')}${accessLink ? `?${new URLSearchParams({ link: accessLink.id })}` : ''}`;
  // Admins review inside the test workspace; proctors use the global Results list, filtered to this session.
  const resultsPath = isAdmin
    ? `${examWorkspacePath(schedule.examId, 'responses')}?${new URLSearchParams({ access: schedule.id })}`
    : `/sat/results?${new URLSearchParams({ exam: schedule.examId, access: schedule.id })}`;
  const goBack = () => {
    if (deliveryReturn) { navigate(deliveryReturn); return; }
    const back = satListReturnTarget('/sat/sessions');
    navigate(back.to, back.state ? { state: back.state } : undefined);
  };

  return (
    <div ref={roomLayoutRef} className="sat-room sat-product" data-sat-room-mode={roomMode} data-room-layout={roomLayout}>
      <header className="sat-room__header">
        <div className="sat-room__header-inner">
          <button type="button" onClick={goBack} className="sat-btn sat-btn--quiet sat-press shrink-0 px-2.5"><ArrowLeft size={16} aria-hidden="true" />Rooms</button>
          <div className="sat-room__title">
            <div className="flex min-w-0 items-center gap-2"><h1>{accessLink?.name ?? schedule.cohortName}</h1><SatStatusPill tone={roomStatusTone(runtime.status)} pulse={runtime.status === 'live'}>{runtimeLabel(runtime.status)}</SatStatusPill></div>
            <p className="sat-room__cohort">{schedule.examTitle}{accessLink ? ` · Version ${accessLink.versionNumber}` : ''} · {satPublishScopeCopy(schedule.publishScope ?? 'full')}</p>
            <p className="sat-room__cohort" data-testid="sat-room-status-line">{statusLine}</p>
          </div>
          <div className="sat-room__header-actions">
            {controller.error ? <span role="status" className="inline-flex items-center gap-1.5 text-[14px] font-semibold text-[var(--sat-staff-warning-text,#92400e)]"><AlertTriangle size={16} aria-hidden="true" />Reconnecting</span> : null}
            {roomMode !== 'review' ? <button type="button" onClick={() => setShareOpen(true)} className="sat-btn sat-btn--quiet sat-press px-3"><QrCode size={16} aria-hidden="true" />Student link</button> : null}
            {isAdmin && !deliveryReturn ? <button type="button" onClick={() => navigate(testSessionsPath)} className="sat-btn sat-btn--quiet sat-press px-3">Room settings</button> : null}
            <SatSessionControls runtimeStatus={runtime.status} pendingActions={pendingActions} blocked={isStale} onViewResponses={roomMode === 'review' ? () => navigate(resultsPath) : undefined} onPause={() => void run('pause', () => controller.handlePauseCohort(scheduleId), 'Exam paused.')} onResume={() => void run('resume', () => controller.handleResumeCohort(scheduleId), 'Exam resumed.')} onExtend={(minutes) => {
              if (isStale) return;
              const revision = runtime.revision;
              if (typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 0 || !runtime.activeSectionKey) {
                setMessage({ kind: 'error', text: 'Refresh the room before adding time. Its current stage could not be confirmed.' });
                return;
              }
              setConfirm({ kind: 'extend-session', minutes, stage: currentStage, sectionKey: runtime.activeSectionKey, runtimeRevision: revision, remainingLabel: formatRunSheetRemaining(cohortStageRemainingSeconds) });
            }} onComplete={() => setConfirm({ kind: 'complete' })} />
          </div>
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

      {isStale ? <div role="alert" className="sat-banner-enter mx-auto flex w-full max-w-[1500px] items-center justify-between gap-3 px-4 pt-3"><div className="rounded-2xl border border-amber-700/15 bg-[var(--sat-staff-warning-tint,rgba(217,119,6,0.1))] px-3.5 py-2.5 text-[14px] font-medium text-amber-800"><span className="font-semibold">Data may be out of date.</span> Risky room actions are paused until reconnection.</div><button type="button" onClick={() => void controller.reload()} className="min-h-11 shrink-0 rounded-[var(--sat-staff-radius-control,10px)] bg-[var(--sat-staff-surface,#fff)] px-3 text-[14px] font-semibold text-[var(--sat-staff-text-primary,#1d1d1f)] ring-1 ring-[var(--sat-staff-border-strong,rgba(0,0,0,0.09))] hover:bg-[var(--sat-staff-fill-chip,rgba(0,0,0,0.04))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-staff-accent-ring,rgba(0,113,227,0.4))]">Retry</button></div> : null}
      {message ? <div role={message.kind === 'error' ? 'alert' : 'status'} className="sat-banner-enter mx-auto max-w-[1500px] px-4 pt-3"><div className={message.kind === 'error' ? 'rounded-2xl border border-red-700/20 bg-[var(--sat-staff-danger-tint,rgba(217,45,32,0.08))] px-3.5 py-2.5 text-[14px] font-medium text-[var(--sat-staff-danger,#b42318)]' : 'rounded-2xl border border-[var(--sat-staff-border-hairline,rgba(0,0,0,0.06))] bg-[var(--sat-staff-fill-chip,rgba(0,0,0,0.04))] px-3.5 py-2.5 text-[14px] font-medium text-[var(--sat-staff-text-secondary,#515154)]'}>{message.text}</div></div> : null}
      {roomMode !== 'review' ? <SatDeviceTransferRequests scheduleId={scheduleId} blocked={isStale} onPendingChange={setPendingTransfers} /> : null}

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
          attentionReasons={attentionReasons}
          sort={rosterSort}
          onSortChange={setRosterSort}
          onSelect={selectStudent}
          onShareLink={roomMode === 'review' ? undefined : () => setShareOpen(true)}
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
          studentEntry={roomMode === 'prestart' ? (
            <SatWaitingRoomPanel
              versionLabel={accessLink ? `Version ${accessLink.versionNumber}` : null}
              sectionsLabel={sectionsLabel}
              joinedCount={students.length}
              readyCount={readyCount}
              startPending={pendingActions.has('start')}
              startBlocked={isStale}
              onStart={() => setConfirm({ kind: 'start', joinedCount: students.length, readyCount, sectionsLabel, perCandidateTiming: satRunSheetTimingPlan(runtime.timingModel)?.perCandidate ?? null })}
            >
              <SatStudentLinkCard url={entryUrl} cohortName={schedule.cohortName} joinedCount={students.length} onOpenShare={() => setShareOpen(true)} onPresent={() => setPresentOpen(true)} />
            </SatWaitingRoomPanel>
          ) : undefined}
        />

        <SatSessionRoomInspector
          open={inspectorOpen}
          docked={roomLayout === 'wide'}
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

      <StudentShareDialog
        open={shareOpen}
        url={entryUrl}
        roomName={accessLink?.name ?? schedule.cohortName}
        examTitle={schedule.examTitle}
        versionNumber={accessLink?.versionNumber ?? null}
        audience={accessLink ? describeAccessLinkAudience(accessLink) : null}
        checkIn={accessLink ? formatAccessLinkStatus(accessLink.status) : null}
        checkInOpen={!accessLink || accessLink.status === 'live'}
        onClose={() => setShareOpen(false)}
        onPresent={() => { setShareOpen(false); setPresentOpen(true); }}
      />
      <SatStudentLinkPresent
        open={presentOpen}
        url={entryUrl}
        examTitle={schedule.examTitle}
        cohortName={schedule.cohortName}
        joinedCount={students.length}
        activeCount={activeStudentCount}
        onClose={() => setPresentOpen(false)}
      />
    </div>
  );
}
