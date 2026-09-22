import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ArrowDown, ArrowLeft, UserRound } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { SatPageError, SatPageLoading } from '../ui/SatPage';
import { logError, logInfo } from '../../../shared/observability/errorLogger';
import { useAuthSession } from '../../../features/auth/authSession';
import { useAuthoritativeDeadlineClock, useServerClockNowMs } from '../../../shared/hooks/useAuthoritativeDeadlineClock';
import { useProctorRouteController } from '../../../features/proctor/hooks/useProctorRouteController';
import { examDeliveryService } from '../../../features/proctor/infrastructure/proctorGateway';
import { SatConfirmDialog } from '../ui/ConfirmDialog';
import { SatEyebrow, SatSearchField, SatStatusPill } from '../ui/SatPage';
import { SatSessionControls } from '../ui/SatSessionControls';
import { SatSessionSummary, roomStatusTone, runtimeLabel } from '../ui/SatSessionSummary';
import { SatRoomStudentRow, StudentDetail } from '../ui/SatSessionRoomStudents';
import { SatRunSheet } from '../ui/SatRunSheet';
import { buildSatRunSheet, formatRunSheetClock, formatRunSheetDuration, formatRunSheetRemaining, satRunSheetCurrentRows } from '../ui/sessionRunSheet';
import '../ui/sat-session-room.css';

const WARN_MESSAGE = 'Please return your attention to the exam.';
const RELOAD_FAILED_SUFFIX = ' However, the live view could not refresh. Retry to confirm.';

export function SatSessionRoomRoute() {
  const { scheduleId } = useParams<{ scheduleId: string }>();
  const navigate = useNavigate();
  const { session } = useAuthSession();
  const controller = useProctorRouteController({ providerKey: 'sat', initialScheduleId: scheduleId ?? null });
  const [search, setSearch] = useState('');
  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(null);
  const [pendingActions, setPendingActions] = useState<ReadonlySet<string>>(() => new Set());
  const [message, setMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [confirm, setConfirm] = useState<{ kind: 'complete' } | { kind: 'terminate'; studentId: string; studentName: string } | { kind: 'warn'; studentId: string; studentName: string } | { kind: 'extend-session'; minutes: number; stage: string; remainingLabel: string } | { kind: 'extend-student'; minutes: number; studentId: string; studentName: string; remainingLabel: string } | null>(null);
  const [attentionFilter, setAttentionFilter] = useState<'all' | 'needs'>('all');
  const messageRef = useRef(message);
  messageRef.current = message;
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const schedule = controller.schedules.find((item) => item.id === scheduleId) ?? null;
  const runtime = controller.runtimeSnapshots.find((item) => item.scheduleId === scheduleId) ?? null;
  const roomReady = Boolean(schedule && runtime);
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
  const stageRemainingSeconds = useAuthoritativeDeadlineClock({
    deadlineAt: runtime?.currentSectionDeadlineAt ?? null,
    serverNow: runtime?.serverNow ?? null,
    fallbackSeconds: runtime?.currentSectionRemainingSeconds ?? 0,
    running: runtime?.status === 'live' && currentStageStatus === 'live',
  });
  // The room's own clock: the shared 1s tick corrected onto the server's
  // instant, so every window on this page counts down together. Before this,
  // only the section clock ticked and each module window was a static span.
  const serverNowMs = useServerClockNowMs(runtime?.serverNow ?? null);
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
  const timelinePaneRef = useRef<HTMLElement | null>(null);
  const studentPaneRef = useRef<HTMLElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const studentDetailRef = useRef<HTMLDivElement | null>(null);
  const [showStickyContext, setShowStickyContext] = useState(false);
  const sessionLive = runtime?.status === 'live' || runtime?.status === 'paused';
  const sessionFinished = runtime?.status === 'completed';
  const upcomingSection = runSheet.rows.find(
    (row) => row.kind === 'section' && (row.status === 'upcoming' || row.status === 'projected'),
  ) ?? null;
  const currentOperationalRow = stageRows.module ?? stageRows.break ?? stageRows.section;
  const currentOperationalEnd = currentOperationalRow?.plannedEndAt ? Date.parse(currentOperationalRow.plannedEndAt) : Number.NaN;
  const nextStageRow = Number.isFinite(currentOperationalEnd)
    ? runSheet.rows.find((row) => {
      const start = row.plannedStartAt ? Date.parse(row.plannedStartAt) : Number.NaN;
      return row.id !== currentOperationalRow?.id && (row.kind === 'module' || row.kind === 'break' || row.kind === 'section')
        && Number.isFinite(start) && start >= currentOperationalEnd
        && (row.status === 'upcoming' || row.status === 'projected');
    }) ?? null
    : upcomingSection;
  const nextStageLabel = nextStageRow?.detail?.startsWith('Alternative branch')
    ? 'Module 2 · Adaptive branches'
    : nextStageRow?.label ?? null;
  // The stage, named the way the run sheet names it: `Section 1 · Module 1`.
  // The ordinal comes from the sheet's own section rows (the plan and the
  // runtime merged), so the header can never disagree with the table below it.
  const stageSectionOrdinal = stageRows.section
    ? runSheet.rows.filter((row) => row.kind === 'section').indexOf(stageRows.section) + 1
    : 0;
  const stageSlot = [
    stageSectionOrdinal > 0 ? `Section ${stageSectionOrdinal}` : null,
    stageRows.module ? stageRows.module.label : stageRows.break ? 'Break' : null,
  ].filter(Boolean).join(' · ');
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
  const clockCaption = stageRows.module ? 'Section remaining' : stageRows.break ? 'Break remaining' : 'Stage remaining';
  const currentModuleEnd = formatRunSheetClock(stageRows.module?.plannedEndAt);
  const currentSectionEnd = formatRunSheetClock(stageRows.section?.plannedEndAt);
  const sessionStartedAt = runtime?.actualStartAt ?? null;
  const sessionFinishedAt = runtime?.actualEndAt ?? null;
  const sessionDuration = formatRunSheetDuration(sessionStartedAt, sessionFinishedAt) ?? 'Duration unavailable';
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

  useEffect(() => {
    const root = timelinePaneRef.current;
    const target = stageRef.current;
    if (!root || !target || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(([entry]) => {
      setShowStickyContext(Boolean(entry && !entry.isIntersecting));
    }, { root, threshold: 0 });
    observer.observe(target);
    return () => observer.disconnect();
  }, [roomReady]);

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

  const jumpToSelectedStudent = () => {
    const pane = studentPaneRef.current;
    const detail = studentDetailRef.current;
    if (!pane || !detail) return;

    const heading = detail.querySelector<HTMLHeadingElement>('[data-sat-room-student-heading]');
    const target = heading ?? detail;
    const paneBounds = pane.getBoundingClientRect();
    const targetBounds = target.getBoundingClientRect();
    const inset = 12;
    const delta = targetBounds.top < paneBounds.top + inset
      ? targetBounds.top - paneBounds.top - inset
      : targetBounds.bottom > paneBounds.bottom - inset
        ? targetBounds.bottom - paneBounds.bottom + inset
        : 0;
    const reduceMotion = typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (delta !== 0) {
      pane.scrollTo({
        top: Math.max(0, pane.scrollTop + delta),
        behavior: reduceMotion ? 'auto' : 'smooth',
      });
    }
    heading?.focus({ preventScroll: true });
  };

  if (!scheduleId) return <SatPageError title="SAT session not found" description="A valid SAT session is required." retryLabel="Back to Sessions" onRetry={() => navigate('/sat/sessions')} />;
  if (controller.isLoading && !schedule) return <SatPageLoading label="Opening SAT session…" />;
  if (controller.error && !schedule) return <SatPageError title="SAT session could not load" description={controller.error} retryLabel="Retry" onRetry={() => void controller.reload()} />;
  if (!schedule || !runtime) return <SatPageError title="SAT session not found" description="This session is not part of the Digital SAT workspace." retryLabel="Back to Sessions" onRetry={() => navigate('/sat/sessions')} />;

  return (
    <div className="sat-room sat-product">
      <header className="sat-room__header">
        <div className="sat-room__header-inner">
          <button type="button" onClick={() => navigate('/sat/sessions')} className="flex min-h-10 shrink-0 items-center gap-1 rounded-[10px] px-2 text-[13px] font-semibold text-[var(--sat-staff-text-secondary,#515154)] hover:bg-[var(--sat-staff-fill-chip,rgba(0,0,0,0.04))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-staff-accent-ring,rgba(0,113,227,0.4))]"><ArrowLeft size={16} />Sessions</button>
          <div className="h-5 w-px bg-[var(--sat-staff-border-input,rgba(0,0,0,0.075))]" aria-hidden="true" />
          <div className="sat-room__title"><div className="flex items-center gap-2"><h1>{schedule.examTitle}</h1><SatStatusPill tone={roomStatusTone(runtime.status)} pulse={runtime.status === 'live'}>{runtimeLabel(runtime.status)}</SatStatusPill></div><p className="sat-room__cohort">{schedule.cohortName}</p></div>
          {runtime.isOverrun ? <span className="inline-flex items-center gap-1 rounded-full border border-amber-700/25 bg-[var(--sat-staff-warning-tint,rgba(217,119,6,0.1))] px-2.5 py-1 text-[11px] font-semibold text-[var(--sat-staff-warning-text,#92400e)]">Overrun</span> : null}
          {controller.error ? <span className="inline-flex items-center gap-1 text-[11px] font-semibold tabular-nums text-[var(--sat-staff-warning-text,#92400e)]"><AlertTriangle size={11} aria-hidden="true" />Reconnecting</span> : null}
          {openAlerts > 0 ? <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--sat-staff-warning-tint,rgba(217,119,6,0.1))] px-2.5 py-1.5 text-[11px] font-semibold tabular-nums text-[var(--sat-staff-warning-text,#92400e)]"><AlertTriangle size={12} aria-hidden="true" />{openAlerts} need attention</span> : null}
          <SatSessionControls runtimeStatus={runtime.status} pendingActions={pendingActions} blocked={isStale} onStart={() => void run('start', () => controller.handleStartScheduledSession(scheduleId), 'Session started.')} onPause={() => void run('pause', () => controller.handlePauseCohort(scheduleId), 'Session paused.')} onResume={() => void run('resume', () => controller.handleResumeCohort(scheduleId), 'Session resumed.')} onExtend={(minutes) => { if (isStale) return; setConfirm({ kind: 'extend-session', minutes, stage: currentStage, remainingLabel: formatRunSheetRemaining(cohortStageRemainingSeconds) }); }} onComplete={() => setConfirm({ kind: 'complete' })} />
        </div>
      </header>

      {isStale ? <div role="alert" className="sat-banner-enter mx-auto flex max-w-[1500px] items-center justify-between gap-3 px-4 pt-3"><div className="rounded-2xl border border-amber-700/15 bg-[var(--sat-staff-warning-tint,rgba(217,119,6,0.1))] px-3.5 py-2.5 text-[11px] font-medium text-amber-800"><span className="font-semibold">Data may be out of date.</span> Last updated {lastUpdatedLabel}. Risky session actions are paused until reconnection.</div><button type="button" onClick={() => void controller.reload()} className="min-h-9 shrink-0 rounded-[var(--sat-staff-radius-control,10px)] bg-[var(--sat-staff-surface,#fff)] px-3 text-[11px] font-semibold text-[var(--sat-staff-text-primary,#1d1d1f)] shadow-sm ring-1 ring-[var(--sat-staff-border-strong,rgba(0,0,0,0.09))] hover:bg-[var(--sat-staff-fill-chip,rgba(0,0,0,0.04))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-staff-accent-ring,rgba(0,113,227,0.4))]">Retry</button></div> : null}
      {message ? <div role={message.kind === 'error' ? 'alert' : 'status'} className="sat-banner-enter mx-auto max-w-[1500px] px-4 pt-3"><div className={message.kind === 'error' ? 'rounded-2xl border border-red-700/20 bg-[var(--sat-staff-danger-tint,rgba(217,45,32,0.08))] px-3.5 py-2.5 text-[11px] font-medium text-[var(--sat-staff-danger,#b42318)]' : 'rounded-2xl border border-[var(--sat-staff-border-hairline,rgba(0,0,0,0.06))] bg-[var(--sat-staff-fill-chip,rgba(0,0,0,0.04))] px-3.5 py-2.5 text-[11px] font-medium text-[var(--sat-staff-text-secondary,#515154)]'}>{message.text}</div></div> : null}

      <main className="sat-room__body">
        <aside className="sat-room__inspector" aria-label="Session summary">
          <SatSessionSummary
            runtime={runtime}
            joinedCount={students.length}
            activeCount={activeStudentCount}
            attentionCount={attentionCount}
            openAlerts={openAlerts}
            isStale={isStale}
            lastUpdatedLabel={lastUpdatedLabel}
            sessionLive={sessionLive}
            stageRemainingSeconds={cohortStageRemainingSeconds}
            onNeedsAttention={() => setAttentionFilter('needs')}
          />
        </aside>

        <section className="sat-room__roster" aria-label="Students">
          <div className="sat-room__roster-head">
            <div className="flex items-baseline justify-between gap-3"><div><p className="sat-room__eyebrow">Students</p><p className="mt-1 text-[13px] font-medium tabular-nums text-[var(--sat-staff-text-secondary,#515154)]">{students.length} joined · {activeStudentCount} active</p></div>{sessionLive ? <span className="text-[13px] font-semibold tabular-nums text-[var(--sat-staff-text-secondary,#515154)]">{formatRunSheetRemaining(cohortStageRemainingSeconds)}</span> : null}</div>
            <div className="mt-4"><SatSearchField id="sat-room-student-search" label="Search students" value={search} onChange={setSearch} placeholder="Search name, ID, email" widthClassName="w-full" /></div>
            <div className="mt-3 flex gap-1.5" role="group" aria-label="Roster filter">
              <button type="button" aria-pressed={attentionFilter === 'all'} onClick={() => setAttentionFilter('all')} className={`min-h-8 rounded-full px-3 text-[12px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-staff-accent-ring,rgba(0,113,227,0.4))] ${attentionFilter === 'all' ? 'bg-slate-900 text-white' : 'bg-[var(--sat-staff-fill-chip,rgba(0,0,0,0.04))] text-[var(--sat-staff-text-secondary,#515154)] hover:bg-[var(--sat-staff-fill-chip-hover,rgba(0,0,0,0.07))]'}`}>All</button>
              {attentionCount > 0 ? (
                <button type="button" aria-label={`Filter roster to students needing attention, ${attentionCount}`} aria-pressed={attentionFilter === 'needs'} onClick={() => setAttentionFilter((current) => (current === 'needs' ? 'all' : 'needs'))} className={`sat-room__attention-filter min-h-8 rounded-full px-3 text-[12px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-staff-accent-ring,rgba(0,113,227,0.4))] ${attentionFilter === 'needs' ? 'is-active' : ''}`}><span>Needs attention</span><span className="sat-room__attention-count">{attentionCount}</span></button>
              ) : <span className="sat-room__attention-filter is-empty min-h-8 rounded-full px-3 text-[12px] font-semibold"><span>Needs attention</span><span className="sat-room__attention-count">0</span></span>}
            </div>
          </div>
          <div
            role="listbox"
            aria-label="Students in this session. Use arrow keys to move between students."
            aria-activedescendant={selectedStudent ? `sat-room-student-${selectedStudent.id}` : undefined}
            tabIndex={visibleStudents.length ? 0 : -1}
            onKeyDown={(event) => {
              if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
              event.preventDefault();
              const ids = visibleStudents.map((item) => item.id);
              const current = selectedStudent ? ids.indexOf(selectedStudent.id) : -1;
              const next = event.key === 'ArrowDown'
                ? ids[Math.min(current + 1, ids.length - 1)]
                : ids[Math.max(current - 1, 0)];
              if (next) {
                setSelectedStudentId(next);
                document.getElementById(`sat-room-student-${next}`)?.focus();
              }
            }}
            className="min-h-0 flex-1 space-y-0.5 overflow-y-auto overscroll-contain p-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--sat-staff-accent-ring,rgba(0,113,227,0.4))]"
          >
            {visibleStudents.length ? visibleStudents.map((student) => <SatRoomStudentRow key={student.id} student={student} runtime={runtime} selected={selectedStudent?.id === student.id} onSelect={() => setSelectedStudentId(student.id)} />) : <div className="px-6 py-12 text-center"><p className="text-[13px] font-semibold text-[var(--sat-staff-text-secondary,#515154)]">{students.length ? 'No matching students.' : 'No students have joined yet.'}</p><p className="mt-1.5 text-[12px] leading-5 text-[var(--sat-staff-text-tertiary,#6e6e73)]">{students.length ? 'Change the search or the filter.' : 'Students appear here the moment they open their exam link.'}</p></div>}
          </div>
        </section>

        <section className="sat-room__workspace" aria-label="Session workspace" data-sat-room-workspace>
          <section ref={timelinePaneRef} className="sat-room__timeline-pane" aria-label="Session timeline" data-sat-room-timeline>
          <div className={`sat-room__sticky-context${showStickyContext ? ' is-visible' : ''}`} role="group" aria-label="Current session context">
            <span>{currentStage}{stageSlot ? ` · ${stageSlot}` : ''}</span>
            {sessionLive ? <strong>{formatRunSheetRemaining(cohortStageRemainingSeconds)}</strong> : null}
            <div className="sat-room__sticky-health"><span data-tone={roomStatusTone(runtime.status)}>{runtimeLabel(runtime.status)}</span><span>{attentionCount} need attention</span><span className={isStale ? 'is-stale' : ''}>{isStale ? 'Reconnecting' : 'Online'}</span></div>
          </div>
          <div className="min-w-0">
            <div ref={stageRef} className="sat-room__stage" data-sat-room-stage>
              <SatEyebrow>{sessionFinished || runtime.status === 'cancelled' ? currentStage : 'Current stage'}</SatEyebrow>
              <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <div className="min-w-0">
                  <h2>{sessionFinished ? 'Session finished' : runtime.status === 'not_started' ? 'Ready to begin' : currentStage}</h2>
                  {sessionFinished ? (
                    <p className="sat-room__stage-note" data-sat-room-finished-summary data-testid="sat-room-finished-summary">
                      Started {formatRunSheetClock(sessionStartedAt)} ICT · Finished {formatRunSheetClock(sessionFinishedAt)} ICT · {sessionDuration}
                    </p>
                  ) : runtime.status === 'not_started' ? (
                    <>
                      <p className="sat-room__stage-slot" data-sat-room-stage-slot>{upcomingSection?.label ?? 'Session schedule'}</p>
                      <p className="sat-room__stage-note">Starts when the proctor starts the session.</p>
                    </>
                  ) : (
                    <>
                      {stageSlot ? <p className="sat-room__stage-slot" data-sat-room-stage-slot>{stageSlot}</p> : null}
                      <p className="sat-room__stage-note">
                        {stageRows.module ? `Module ends ${currentModuleEnd} ICT · section ends ${currentSectionEnd} ICT` : stageRows.break ? `Break ends ${formatRunSheetClock(stageRows.break.plannedEndAt)} ICT` : stageRows.section ? `Section ends ${currentSectionEnd} ICT` : sessionLive ? 'Server-authoritative session clock' : 'Session timing is no longer running.'}
                      </p>
                      {nextStageRow && nextStageLabel ? <p className="sat-room__next-stage"><span>Next</span>{nextStageLabel}<span>Starts {formatRunSheetClock(nextStageRow.plannedStartAt)} ICT</span></p> : null}
                    </>
                  )}
                </div>
                {sessionLive ? (
                  <div className="shrink-0 sm:text-right">
                    <p className="sat-room__clock" aria-label={clockCaption === 'Section remaining' ? 'Time remaining in this section' : 'Time remaining in this stage'}>{formatRunSheetRemaining(cohortStageRemainingSeconds)}</p>
                    <p className="sat-room__stage-clock-caption">{clockCaption}</p>
                  </div>
                ) : runtime.status === 'not_started' ? <span className="sat-room__stage-state">Not started</span> : null}
              </div>
              {selectedStudent ? (
                <button
                  type="button"
                  className="sat-room__selected-student-link"
                  aria-label={`Jump to selected student ${selectedStudent.name}`}
                  onClick={() => {
                    jumpToSelectedStudent();
                  }}
                >
                  <span>Selected student</span>{selectedStudent.name}<ArrowDown size={14} aria-hidden="true" />
                </button>
              ) : null}
            </div>

              <SatRunSheet sheet={runSheet} runtime={runtime} scheduledStartAt={schedule.startTime} />
            </div>
          </section>

          <section ref={studentPaneRef} className="sat-room__student-pane" aria-label="Selected student inspection" data-sat-room-student-pane>
            {openAlerts > 0 && selectedStudent ? (
              <button type="button" onClick={() => setAttentionFilter('needs')} className="sat-banner-enter mb-4 flex w-full items-center gap-2 rounded-2xl border border-amber-700/15 bg-[var(--sat-staff-warning-tint,rgba(217,119,6,0.1))] px-3.5 py-2.5 text-left text-[11px] font-medium text-amber-800 hover:bg-[var(--sat-staff-warning-tint,rgba(217,119,6,0.1))] hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-staff-accent-ring,rgba(0,113,227,0.4))]">
                <AlertTriangle size={13} className="shrink-0" aria-hidden="true" />
                <span>{openAlerts} {openAlerts === 1 ? 'student needs' : 'students need'} attention — details in the Attention section below.</span>
              </button>
            ) : null}

            {selectedStudent ? (
              <div ref={studentDetailRef}>
                <StudentDetail
                  key={selectedStudent.id}
                  student={selectedStudent}
                  runtime={runtime}
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
              </div>
            ) : (
              <div className="sat-room__empty">
                <div className="sat-room__empty-content">
                  <span className="sat-room__empty-icon" aria-hidden="true"><UserRound size={20} /></span>
                  <p className="sat-room__empty-title">{sessionFinished ? 'Session finished' : sessionLive ? 'Select a student' : runtime.status === 'not_started' ? 'Waiting to begin' : 'Session cancelled'}</p>
                  <p className="sat-room__empty-text">
                    {sessionLive
                      ? 'Choose a student in the roster to inspect their progress, timing, and integrity events.'
                      : sessionFinished
                        ? 'The run sheet remains available above for a review of the completed session.'
                        : runtime.status === 'not_started'
                          ? 'This workspace becomes operational as soon as you start the session. Students appear in the roster as they open their exam link.'
                          : 'This session was cancelled. The run sheet above shows the timeline recorded so far.'}
                  </p>
                  {runtime.status === 'not_started' ? <p className="sat-room__empty-hint">{students.length ? `${students.length} student${students.length === 1 ? '' : 's'} already connected.` : 'No students have joined yet.'}</p> : null}
                </div>
              </div>
            )}
          </section>
        </section>
      </main>

      {confirm ? <SatConfirmDialog open title={confirm.kind === 'complete' ? 'Finish this SAT session?' : confirm.kind === 'terminate' ? `End ${confirm.studentName}’s attempt?` : confirm.kind === 'warn' ? `Send warning to ${confirm.studentName}?` : confirm.kind === 'extend-session' ? `Add ${confirm.minutes} minutes to ${confirm.stage}?` : `Add ${confirm.minutes} minutes for ${confirm.studentName}?`} description={confirm.kind === 'complete' ? 'The session will be completed for the cohort. This should only be used when testing is finished.' : confirm.kind === 'terminate' ? 'This ends the student’s current attempt. Their recorded answers remain available.' : confirm.kind === 'warn' ? `The student will see exactly: “${WARN_MESSAGE}”` : confirm.kind === 'extend-session' ? `Current stage remaining: ${confirm.remainingLabel}. The extension applies to the current stage immediately.` : `Current remaining: ${confirm.remainingLabel}. The extension applies to this attempt immediately.`} confirmLabel={confirm.kind === 'complete' ? 'Finish Session' : confirm.kind === 'terminate' ? 'End Attempt' : confirm.kind === 'warn' ? 'Send Warning' : `Add ${confirm.minutes} Minutes`} destructive={confirm.kind === 'terminate' || confirm.kind === 'complete'} onCancel={() => setConfirm(null)} onConfirm={() => { const action = confirm; setConfirm(null); if (action.kind === 'complete') { void run('complete', () => controller.handleCompleteExam(scheduleId), 'Session completed.'); return; } if (action.kind === 'extend-session') { void run(`extend-${action.minutes}`, () => controller.handleExtendCurrentSection(scheduleId, action.minutes), `Added ${action.minutes} minutes to the current stage.`); return; } if (action.kind === 'warn') { const bound = students.find((student) => student.id === action.studentId); if (!bound) { if (mountedRef.current) setMessage({ kind: 'error', text: `${action.studentName} is no longer in this session, so no warning was sent.` }); return; } void runStudentAction('student-warn', () => examDeliveryService.warnStudent(bound.id, WARN_MESSAGE, proctorName), `Warning sent to ${bound.name}.`); return; } if (action.kind === 'extend-student') { const bound = students.find((student) => student.id === action.studentId); if (!bound) { if (mountedRef.current) setMessage({ kind: 'error', text: `${action.studentName} is no longer in this session, so no time was added.` }); return; } void runStudentAction(`student-extend-${action.minutes}`, () => examDeliveryService.extendStudentAttempt(bound.id, proctorName, action.minutes), `Added ${action.minutes} minutes for ${bound.name}.`); return; } const bound = students.find((student) => student.id === action.studentId); if (!bound) { if (mountedRef.current) setMessage({ kind: 'error', text: `${action.studentName} is no longer in this session, so their attempt was not ended.` }); return; } void runStudentAction('student-terminate', () => examDeliveryService.terminateStudentAttempt(bound.id, proctorName), `${bound.name}’s attempt ended.`); }} /> : null}
    </div>
  );
}
