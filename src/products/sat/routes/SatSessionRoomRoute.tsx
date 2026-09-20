import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ArrowLeft, MoreHorizontal, Pause, Play, UserRound } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { SatPageError, SatPageLoading } from '../ui/SatPage';
import { logError, logInfo } from '../../../shared/observability/errorLogger';
import { useAuthSession } from '../../../features/auth/authSession';
import { useAuthoritativeDeadlineClock } from '../../../shared/hooks/useAuthoritativeDeadlineClock';
import { useProctorRouteController } from '../../../features/proctor/hooks/useProctorRouteController';
import { examDeliveryService } from '../../../features/proctor/infrastructure/proctorGateway';
import type { StudentSession } from '../../../types';
import type { ExamSessionRuntime } from '../../../types/domain';
import { SatConfirmDialog } from '../ui/ConfirmDialog';
import { SatMenu, type SatMenuItem } from '../ui/Menu';
import { SatEyebrow, SatSearchField, type SatStatusTone, SatStatusPill } from '../ui/SatPage';
import { SatRunSheet } from '../ui/SatRunSheet';
import '../ui/sat-session-room.css';

const WARN_MESSAGE = 'Please return your attention to the exam.';
const RELOAD_FAILED_SUFFIX = ' However, the live view could not refresh. Retry to confirm.';

function formatRemaining(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const secs = safe % 60;
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}` : `${minutes}:${String(secs).padStart(2, '0')}`;
}
function runtimeLabel(status: string): string {
  if (status === 'not_started') return 'Ready';
  if (status === 'live') return 'Live';
  if (status === 'paused') return 'Paused';
  if (status === 'completed') return 'Finished';
  return 'Cancelled';
}

function roomStatusTone(status: string): SatStatusTone {
  if (status === 'live') return 'live';
  if (status === 'paused') return 'paused';
  if (status === 'not_started') return 'info';
  if (status === 'completed') return 'finished';
  return 'cancelled';
}

function studentTone(student: StudentSession): string {
  if (student.status === 'terminated') return 'bg-[var(--sat-staff-neutral-dot,#6e6e73)]';
  if (student.status === 'paused' || student.status === 'warned' || student.violations.length > 0) return 'bg-[var(--sat-staff-warning-dot,#d97706)]';
  if (student.status === 'connecting' || student.status === 'idle') return 'bg-[var(--sat-staff-neutral-dot,#6e6e73)]';
  return 'bg-[var(--sat-staff-success-dot,#059669)]';
}

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
  const currentStage = runtime?.sections.find((section) => section.sectionKey === runtime.currentSectionKey)?.label ?? runtime?.currentSectionKey ?? 'Waiting to begin';
  const currentStageStatus = runtime?.sections.find((section) => section.sectionKey === runtime?.currentSectionKey)?.status ?? null;
  const stageRemainingSeconds = useAuthoritativeDeadlineClock({
    deadlineAt: runtime?.currentSectionDeadlineAt ?? null,
    serverNow: runtime?.serverNow ?? null,
    fallbackSeconds: runtime?.currentSectionRemainingSeconds ?? 0,
    running: runtime?.status === 'live' && currentStageStatus === 'live',
  });
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

  if (!scheduleId) return <SatPageError title="SAT session not found" description="A valid SAT session is required." retryLabel="Back to Sessions" onRetry={() => navigate('/sat/sessions')} />;
  if (controller.isLoading && !schedule) return <SatPageLoading label="Opening SAT session…" />;
  if (controller.error && !schedule) return <SatPageError title="SAT session could not load" description={controller.error} retryLabel="Retry" onRetry={() => void controller.reload()} />;
  if (!schedule || !runtime) return <SatPageError title="SAT session not found" description="This session is not part of the Digital SAT workspace." retryLabel="Back to Sessions" onRetry={() => navigate('/sat/sessions')} />;

  const sessionLive = runtime.status === 'live' || runtime.status === 'paused';

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
          <SessionControls runtimeStatus={runtime.status} pendingActions={pendingActions} blocked={isStale} onStart={() => void run('start', () => controller.handleStartScheduledSession(scheduleId), 'Session started.')} onPause={() => void run('pause', () => controller.handlePauseCohort(scheduleId), 'Session paused.')} onResume={() => void run('resume', () => controller.handleResumeCohort(scheduleId), 'Session resumed.')} onExtend={(minutes) => { if (isStale) return; setConfirm({ kind: 'extend-session', minutes, stage: currentStage, remainingLabel: formatRemaining(stageRemainingSeconds) }); }} onComplete={() => setConfirm({ kind: 'complete' })} />
        </div>
      </header>

      {isStale ? <div role="alert" className="sat-banner-enter mx-auto flex max-w-[1500px] items-center justify-between gap-3 px-4 pt-3"><div className="rounded-2xl border border-amber-700/15 bg-[var(--sat-staff-warning-tint,rgba(217,119,6,0.1))] px-3.5 py-2.5 text-[11px] font-medium text-amber-800"><span className="font-semibold">Data may be out of date.</span> Last updated {lastUpdatedLabel}. Risky session actions are paused until reconnection.</div><button type="button" onClick={() => void controller.reload()} className="min-h-9 shrink-0 rounded-[var(--sat-staff-radius-control,10px)] bg-[var(--sat-staff-surface,#fff)] px-3 text-[11px] font-semibold text-[var(--sat-staff-text-primary,#1d1d1f)] shadow-sm ring-1 ring-[var(--sat-staff-border-strong,rgba(0,0,0,0.09))] hover:bg-[var(--sat-staff-fill-chip,rgba(0,0,0,0.04))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-staff-accent-ring,rgba(0,113,227,0.4))]">Retry</button></div> : null}
      {message ? <div role={message.kind === 'error' ? 'alert' : 'status'} className="sat-banner-enter mx-auto max-w-[1500px] px-4 pt-3"><div className={message.kind === 'error' ? 'rounded-2xl border border-red-700/20 bg-[var(--sat-staff-danger-tint,rgba(217,45,32,0.08))] px-3.5 py-2.5 text-[11px] font-medium text-[var(--sat-staff-danger,#b42318)]' : 'rounded-2xl border border-[var(--sat-staff-border-hairline,rgba(0,0,0,0.06))] bg-[var(--sat-staff-fill-chip,rgba(0,0,0,0.04))] px-3.5 py-2.5 text-[11px] font-medium text-[var(--sat-staff-text-secondary,#515154)]'}>{message.text}</div></div> : null}

      <main className="sat-room__body">
        <section className="sat-room__roster" aria-label="Students">
          <div className="sat-room__roster-head">
            <div className="flex items-baseline justify-between gap-3"><div><p className="sat-room__eyebrow">Students</p><p className="mt-1 text-[13px] font-medium tabular-nums text-[var(--sat-staff-text-secondary,#515154)]">{students.length} joined · {students.filter((student) => student.status === 'active').length} active</p></div>{sessionLive ? <span className="text-[13px] font-semibold tabular-nums text-[var(--sat-staff-text-secondary,#515154)]">{formatRemaining(stageRemainingSeconds)}</span> : null}</div>
            <div className="mt-4"><SatSearchField id="sat-room-student-search" label="Search students" value={search} onChange={setSearch} placeholder="Search name, ID, email" widthClassName="w-full" /></div>
            <div className="mt-3 flex gap-1.5" role="group" aria-label="Roster filter">
              <button type="button" aria-pressed={attentionFilter === 'all'} onClick={() => setAttentionFilter('all')} className={`min-h-8 rounded-full px-3 text-[12px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-staff-accent-ring,rgba(0,113,227,0.4))] ${attentionFilter === 'all' ? 'bg-slate-900 text-white' : 'bg-[var(--sat-staff-fill-chip,rgba(0,0,0,0.04))] text-[var(--sat-staff-text-secondary,#515154)] hover:bg-[var(--sat-staff-fill-chip-hover,rgba(0,0,0,0.07))]'}`}>All</button>
              <button type="button" aria-pressed={attentionFilter === 'needs'} onClick={() => setAttentionFilter((current) => (current === 'needs' ? 'all' : 'needs'))} className={`min-h-8 rounded-full px-3 text-[12px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-staff-accent-ring,rgba(0,113,227,0.4))] ${attentionFilter === 'needs' ? 'bg-slate-900 text-white' : 'bg-[var(--sat-staff-fill-chip,rgba(0,0,0,0.04))] text-[var(--sat-staff-text-secondary,#515154)] hover:bg-[var(--sat-staff-fill-chip-hover,rgba(0,0,0,0.07))]'}`}>Needs attention</button>
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

        <section className="sat-room__workspace" aria-label="Session workspace">
          <div className="min-w-0">
              <div className="sat-room__stage">
                <SatEyebrow>Current stage</SatEyebrow>
                <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                  <div className="min-w-0">
                    <h2>{currentStage}</h2>
                    <p className="sat-room__stage-note">{sessionLive ? 'Server-authoritative session clock' : 'Session timing begins when you start the session.'}</p>
                  </div>
                  <p className={'sat-room__clock' + (sessionLive ? '' : ' sat-room__clock--idle')} aria-label={sessionLive ? 'Time remaining in this stage' : 'Session not started'}>{sessionLive ? formatRemaining(stageRemainingSeconds) : '—:—'}</p>
                </div>
              </div>

              {/* The cohort's planned run, in Thailand time: every section,
                  module and break, with the status the runtime has reached.
                  Session-level, so it renders with or without a student
                  selected. */}
              <SatRunSheet
                plan={runtime.examPlan ?? null}
                runtime={runtime}
                scheduledStartAt={schedule.startTime}
                now={runtime.serverNow ?? null}
              />

              {openAlerts > 0 && selectedStudent ? (
                <button type="button" onClick={() => setAttentionFilter('needs')} className="sat-banner-enter mt-4 flex w-full items-center gap-2 rounded-2xl border border-amber-700/15 bg-[var(--sat-staff-warning-tint,rgba(217,119,6,0.1))] px-3.5 py-2.5 text-left text-[11px] font-medium text-amber-800 hover:bg-[var(--sat-staff-warning-tint,rgba(217,119,6,0.1))] hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-staff-accent-ring,rgba(0,113,227,0.4))]">
                  <AlertTriangle size={13} className="shrink-0" aria-hidden="true" />
                  <span>{openAlerts} {openAlerts === 1 ? 'student needs' : 'students need'} attention — details in the Attention section below.</span>
                </button>
              ) : null}

              {selectedStudent ? <StudentDetail student={selectedStudent} pendingActions={pendingActions} blocked={isStale} onAddTime={(minutes) => { if (isStale || !selectedStudent) return; setConfirm({ kind: 'extend-student', minutes, studentId: selectedStudent.id, studentName: selectedStudent.name, remainingLabel: formatRemaining(selectedStudent.runtimeTimeRemainingSeconds ?? selectedStudent.timeRemaining) }); }} onWarn={() => { if (!selectedStudent) return; setConfirm({ kind: 'warn', studentId: selectedStudent.id, studentName: selectedStudent.name }); }} onPause={() => void runStudentAction('student-pause', () => examDeliveryService.pauseStudentAttempt(selectedStudent.id, proctorName), `${selectedStudent.name} paused.`)} onResume={() => void runStudentAction('student-resume', () => examDeliveryService.resumeStudentAttempt(selectedStudent.id, proctorName), `${selectedStudent.name} resumed.`)} onTerminate={() => { if (selectedStudent) setConfirm({ kind: 'terminate', studentId: selectedStudent.id, studentName: selectedStudent.name }); }} /> : (
                <div className="sat-room__empty">
                  <div className="sat-room__empty-content">
                    <span className="sat-room__empty-icon" aria-hidden="true"><UserRound size={20} /></span>
                    <p className="sat-room__empty-title">{sessionLive ? 'Select a student' : 'Waiting to begin'}</p>
                    <p className="sat-room__empty-text">
                      {sessionLive
                        ? 'Choose a student in the roster to inspect their progress, timing, and integrity events.'
                        : 'This workspace becomes operational as soon as you start the session. Students appear in the roster as they open their exam link.'}
                    </p>
                    {!sessionLive ? <p className="sat-room__empty-hint">{students.length ? `${students.length} student${students.length === 1 ? '' : 's'} already connected.` : 'No students have joined yet.'}</p> : null}
                  </div>
                </div>
              )}
          </div>
        </section>

        <aside className="sat-room__inspector" aria-label="Session summary">
          <section className="sat-inspector__section">
            <p className="sat-inspector__label sat-room__eyebrow">Session</p>
            <dl>
              <div className="sat-inspector__row"><dt>Status</dt><dd>{runtimeLabel(runtime.status)}</dd></div>
              <div className="sat-inspector__row"><dt>Current stage</dt><dd>{currentStage}</dd></div>
            </dl>
          </section>
          <section className="sat-inspector__section">
            <p className="sat-inspector__label sat-room__eyebrow">Students</p>
            <dl>
              <div className="sat-inspector__row"><dt>Joined</dt><dd>{students.length}</dd></div>
              <div className="sat-inspector__row"><dt>Active</dt><dd>{students.filter((student) => student.status === 'active').length}</dd></div>
              <div className="sat-inspector__row"><dt>Needs attention</dt><dd>{students.filter((student) => student.warnings > 0 || student.violations.length > 0).length}</dd></div>
            </dl>
          </section>
          <section className="sat-inspector__section">
            <p className="sat-inspector__label sat-room__eyebrow">Session health</p>
            <dl>
              <div className="sat-inspector__row"><dt>Warnings</dt><dd>{openAlerts}</dd></div>
              <div className="sat-inspector__row"><dt>Clock</dt><dd>{sessionLive ? formatRemaining(stageRemainingSeconds) : 'Not started'}</dd></div>
            </dl>
            {runtime.isOverrun ? <div className="mt-4 rounded-[10px] bg-[var(--sat-staff-warning-tint,rgba(217,119,6,0.1))] px-3 py-2.5 text-[12px] font-medium leading-5 text-[var(--sat-staff-warning-text,#92400e)]"><span className="font-semibold">Running beyond the scheduled window.</span> Review time extensions before ending the session.</div> : null}
          </section>
        </aside>
      </main>

      {confirm ? <SatConfirmDialog open title={confirm.kind === 'complete' ? 'Finish this SAT session?' : confirm.kind === 'terminate' ? `End ${confirm.studentName}’s attempt?` : confirm.kind === 'warn' ? `Send warning to ${confirm.studentName}?` : confirm.kind === 'extend-session' ? `Add ${confirm.minutes} minutes to ${confirm.stage}?` : `Add ${confirm.minutes} minutes for ${confirm.studentName}?`} description={confirm.kind === 'complete' ? 'The session will be completed for the cohort. This should only be used when testing is finished.' : confirm.kind === 'terminate' ? 'This ends the student’s current attempt. Their recorded answers remain available.' : confirm.kind === 'warn' ? `The student will see exactly: “${WARN_MESSAGE}”` : confirm.kind === 'extend-session' ? `Current stage remaining: ${confirm.remainingLabel}. The extension applies to the current stage immediately.` : `Current remaining: ${confirm.remainingLabel}. The extension applies to this attempt immediately.`} confirmLabel={confirm.kind === 'complete' ? 'Finish Session' : confirm.kind === 'terminate' ? 'End Attempt' : confirm.kind === 'warn' ? 'Send Warning' : `Add ${confirm.minutes} Minutes`} destructive={confirm.kind === 'terminate' || confirm.kind === 'complete'} onCancel={() => setConfirm(null)} onConfirm={() => { const action = confirm; setConfirm(null); if (action.kind === 'complete') { void run('complete', () => controller.handleCompleteExam(scheduleId), 'Session completed.'); return; } if (action.kind === 'extend-session') { void run(`extend-${action.minutes}`, () => controller.handleExtendCurrentSection(scheduleId, action.minutes), `Added ${action.minutes} minutes to the current stage.`); return; } if (action.kind === 'warn') { const bound = students.find((student) => student.id === action.studentId); if (!bound) { if (mountedRef.current) setMessage({ kind: 'error', text: `${action.studentName} is no longer in this session, so no warning was sent.` }); return; } void runStudentAction('student-warn', () => examDeliveryService.warnStudent(bound.id, WARN_MESSAGE, proctorName), `Warning sent to ${bound.name}.`); return; } if (action.kind === 'extend-student') { const bound = students.find((student) => student.id === action.studentId); if (!bound) { if (mountedRef.current) setMessage({ kind: 'error', text: `${action.studentName} is no longer in this session, so no time was added.` }); return; } void runStudentAction(`student-extend-${action.minutes}`, () => examDeliveryService.extendStudentAttempt(bound.id, proctorName, action.minutes), `Added ${action.minutes} minutes for ${bound.name}.`); return; } const bound = students.find((student) => student.id === action.studentId); if (!bound) { if (mountedRef.current) setMessage({ kind: 'error', text: `${action.studentName} is no longer in this session, so their attempt was not ended.` }); return; } void runStudentAction('student-terminate', () => examDeliveryService.terminateStudentAttempt(bound.id, proctorName), `${bound.name}’s attempt ended.`); }} /> : null}
    </div>
  );
}

function SessionControls({ runtimeStatus, pendingActions, blocked, onStart, onPause, onResume, onExtend, onComplete }: { runtimeStatus: string; pendingActions: ReadonlySet<string>; blocked: boolean; onStart: () => void; onPause: () => void; onResume: () => void; onExtend: (minutes: number) => void; onComplete: () => void }) {
  const primary = runtimeStatus === 'not_started' ? { label: 'Start', icon: Play, key: 'start', action: onStart } : runtimeStatus === 'live' ? { label: 'Pause', icon: Pause, key: 'pause', action: onPause } : runtimeStatus === 'paused' ? { label: 'Resume', icon: Play, key: 'resume', action: onResume } : null;
  const Icon = primary?.icon;
  const primaryBusy = primary ? pendingActions.has(primary.key) : false;
  const active = runtimeStatus === 'live' || runtimeStatus === 'paused';
  const sessionItems: SatMenuItem[] = [
    { id: 'extend-5', label: 'Add 5 minutes', disabled: pendingActions.has('extend-5'), onSelect: () => onExtend(5) },
    { id: 'extend-10', label: 'Add 10 minutes', disabled: pendingActions.has('extend-10'), onSelect: () => onExtend(10) },
    { id: 'finish', label: 'Finish session…', destructive: true, separatorBefore: true, onSelect: onComplete },
  ];
  return (
    <div className="flex shrink-0 items-center gap-1.5">
      {primary && Icon ? <button type="button" onClick={primary.action} disabled={primaryBusy || blocked} aria-busy={primaryBusy || undefined} className="flex min-h-10 items-center gap-1.5 rounded-[var(--sat-staff-radius-control,10px)] bg-[var(--sat-staff-accent,#0071e3)] px-3 text-[12px] font-semibold text-white shadow-[var(--sat-staff-accent-glow-sm,0_1px_2px_rgba(0,113,227,0.35))] transition-colors hover:bg-[var(--sat-staff-accent-hover,#0077ed)] hover:shadow-[var(--sat-staff-accent-glow-md,0_4px_14px_rgba(0,113,227,0.35))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-staff-accent-ring,rgba(0,113,227,0.4))] disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none">{primaryBusy ? <span aria-hidden="true" className="sat-spinner block h-3 w-3 shrink-0 rounded-full border-2 border-white/40 border-t-white" /> : <Icon size={13} />}{primaryBusy ? 'Working…' : primary.label}</button> : null}
      {active ? <SatMenu label="Session actions" compact align="end" width={176} icon={MoreHorizontal} items={sessionItems.map((item) => ({ ...item, disabled: blocked || Boolean(item.disabled) }))} /> : null}
    </div>
  );
}

function SatRoomStudentRow({ student, runtime, selected, onSelect }: { student: StudentSession; runtime: ExamSessionRuntime | null; selected: boolean; onSelect: () => void }) {
  // Hooks before early paths. Far-from-deadline rows ride the 15s coarse
  // clock; rows under 5 minutes stay on the 1s precise tick. Selection
  // styling is a cross-fade only — the list never animates on clock ticks,
  // keeping 300-row rooms jank-free.
  const fallbackSeconds = student.runtimeTimeRemainingSeconds ?? student.timeRemaining;
  const running = student.runtimeStatus === 'live' && student.runtimeSectionStatus === 'live' && student.status !== 'terminated';
  const remaining = useAuthoritativeDeadlineClock({
    deadlineAt: student.runtimeDeadlineAt ?? runtime?.currentSectionDeadlineAt ?? null,
    serverNow: student.runtimeServerNow ?? runtime?.serverNow ?? null,
    fallbackSeconds,
    running,
    coarse: running && fallbackSeconds > 300,
  });
  return <button type="button" id={`sat-room-student-${student.id}`} role="option" aria-selected={selected} aria-label={`Open ${student.name}`} aria-current={selected || undefined} tabIndex={-1} onClick={onSelect} className="sat-room__row focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-staff-accent-ring,rgba(0,113,227,0.4))]"><div className="min-w-0"><div className="flex items-center gap-2"><span className={`h-1.5 w-1.5 shrink-0 rounded-full ${studentTone(student)}`} /><p className="sat-room__row-name">{student.name}</p>{student.warnings > 0 || student.violations.length > 0 ? <AlertTriangle size={12} className="shrink-0 text-[var(--sat-staff-warning-dot,#d97706)]" /> : null}</div><p className="sat-room__row-meta pl-3.5">{String(student.runtimeCurrentSection ?? student.currentSection)} · {student.status}</p></div><div className="text-right"><p className="sat-room__row-time">{formatRemaining(remaining)}</p></div></button>;
}

function StudentDetail({ student, pendingActions, blocked, onAddTime, onWarn, onPause, onResume, onTerminate }: { student: StudentSession; pendingActions: ReadonlySet<string>; blocked: boolean; onAddTime: (minutes: number) => void; onWarn: () => void; onPause: () => void; onResume: () => void; onTerminate: () => void }) {
  const anyStudentPending = pendingActions.has('student-extend-5') || pendingActions.has('student-extend-10') || pendingActions.has('student-warn') || pendingActions.has('student-pause') || pendingActions.has('student-resume') || pendingActions.has('student-terminate');
  const remaining = useAuthoritativeDeadlineClock({
    deadlineAt: student.runtimeDeadlineAt ?? null,
    serverNow: student.runtimeServerNow ?? null,
    fallbackSeconds: student.runtimeTimeRemainingSeconds ?? student.timeRemaining,
    running: student.runtimeStatus === 'live' && student.runtimeSectionStatus === 'live' && student.status !== 'terminated',
  });
  return <div className="pt-8"><div className="flex items-start justify-between gap-4"><div className="min-w-0"><SatEyebrow>Student</SatEyebrow><h2 className="mt-1.5 truncate text-[19px] font-semibold tracking-[-0.02em]">{student.name}</h2><p className="mt-1 text-[12px] font-medium text-[var(--sat-staff-text-tertiary,#6e6e73)]">{student.studentId}{student.email ? ` · ${student.email}` : ''}</p></div><div><SatMenu label="Student actions" compact align="end" width={176} icon={MoreHorizontal} items={[{ id: 'extend-5', label: 'Add 5 minutes…', disabled: anyStudentPending || blocked, onSelect: () => onAddTime(5) }, { id: 'warn', label: 'Send warning…', disabled: anyStudentPending || blocked, onSelect: onWarn }, { id: 'toggle', label: student.status === 'paused' ? 'Resume attempt' : 'Pause attempt', disabled: anyStudentPending || blocked, onSelect: student.status === 'paused' ? onResume : onPause }, { id: 'terminate', label: 'End attempt…', destructive: true, disabled: anyStudentPending || blocked, separatorBefore: true, onSelect: onTerminate }]} /></div></div>
    <dl className="mt-6 grid gap-x-8 gap-y-4 border-t border-[var(--sat-staff-border-hairline,rgba(0,0,0,0.06))] pt-5 sm:grid-cols-3">
      <div><dt className="sat-room__eyebrow">Current module</dt><dd className="mt-1.5 text-[14px] font-semibold text-[var(--sat-staff-text-primary,#18181b)]">{String(student.runtimeCurrentSection ?? student.currentSection)}</dd></div>
      <div><dt className="sat-room__eyebrow">Time remaining</dt><dd className="mt-1 text-[20px] font-semibold tabular-nums tracking-[-0.03em] text-[var(--sat-staff-text-primary,#18181b)]">{formatRemaining(remaining)}</dd></div>
      <div><dt className="sat-room__eyebrow">Attempt</dt><dd className="mt-1.5 text-[14px] font-semibold capitalize text-[var(--sat-staff-text-primary,#18181b)]">{student.status}</dd></div>
    </dl>
    <div className="mt-7 border-t border-[var(--sat-staff-border-hairline,rgba(0,0,0,0.06))] pt-5"><h3 className="text-[14px] font-semibold tracking-[-0.01em]">Attention</h3>{student.warnings === 0 && student.violations.length === 0 ? <div className="mt-3 flex items-center gap-2 text-[13px] font-medium text-[var(--sat-staff-text-secondary,#515154)]"><span className="h-1.5 w-1.5 rounded-full bg-[var(--sat-staff-success-dot,#059669)]" />No current warnings or integrity events.</div> : <div className="mt-3 space-y-2">{student.warnings > 0 ? <div className="rounded-[10px] bg-[var(--sat-staff-warning-tint,rgba(217,119,6,0.1))] px-3 py-2.5 text-[13px] font-medium text-[var(--sat-staff-warning-text,#92400e)]">{student.warnings} proctor warning{student.warnings === 1 ? '' : 's'}</div> : null}{student.violations.slice(0, 5).map((violation) => <div key={violation.id} className="rounded-[10px] bg-[var(--sat-staff-warning-tint,rgba(217,119,6,0.1))] px-3 py-2.5"><p className="text-[12px] font-semibold capitalize text-[var(--sat-staff-warning-text,#92400e)]">{violation.type.replace(/_/g, ' ')}</p><p className="mt-0.5 text-[12px] font-medium leading-5 text-[var(--sat-staff-warning-text,#92400e)]">{violation.description}</p></div>)}</div>}</div>
  </div>;
}
