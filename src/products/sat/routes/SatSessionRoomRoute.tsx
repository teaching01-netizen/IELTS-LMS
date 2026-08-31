import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowLeft, ChevronDown, MoreHorizontal, Pause, Play, Search, UserRound } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { ErrorSurface } from '../../../components/ui/ErrorSurface';
import { LoadingSurface } from '../../../components/ui/LoadingSurface';
import { useAuthSession } from '../../../features/auth/authSession';
import { useProctorRouteController } from '../../../features/proctor/hooks/useProctorRouteController';
import { examDeliveryService } from '../../../features/proctor/infrastructure/proctorGateway';
import type { StudentSession } from '../../../types';

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

function studentTone(student: StudentSession): string {
  if (student.status === 'terminated') return 'bg-slate-300';
  if (student.status === 'paused' || student.status === 'warned' || student.violations.length > 0) return 'bg-amber-500';
  if (student.status === 'connecting' || student.status === 'idle') return 'bg-slate-300';
  return 'bg-emerald-500';
}

export function SatSessionRoomRoute() {
  const { scheduleId } = useParams<{ scheduleId: string }>();
  const navigate = useNavigate();
  const { session } = useAuthSession();
  const controller = useProctorRouteController({ providerKey: 'sat', initialScheduleId: scheduleId ?? null });
  const [search, setSearch] = useState('');
  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(null);
  const [sessionMenuOpen, setSessionMenuOpen] = useState(false);
  const [studentMenuOpen, setStudentMenuOpen] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<'complete' | 'terminate' | null>(null);

  const schedule = controller.schedules.find((item) => item.id === scheduleId) ?? null;
  const runtime = controller.runtimeSnapshots.find((item) => item.scheduleId === scheduleId) ?? null;
  const students = useMemo(() => controller.sessions.filter((item) => item.scheduleId === scheduleId), [controller.sessions, scheduleId]);
  const visibleStudents = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    return students.filter((student) => !needle || [student.name, student.studentId, student.email].some((value) => value.toLocaleLowerCase().includes(needle)));
  }, [search, students]);
  const selectedStudent = students.find((student) => student.id === selectedStudentId) ?? students[0] ?? null;
  const currentStage = runtime?.sections.find((section) => section.sectionKey === runtime.currentSectionKey)?.label ?? runtime?.currentSectionKey ?? 'Waiting to begin';
  const proctorName = session?.user.displayName?.trim() || session?.user.email || 'Proctor';
  const openAlerts = controller.alerts.filter((alert) => !alert.isAcknowledged).length;

  useEffect(() => {
    if (!selectedStudentId && students[0]) setSelectedStudentId(students[0].id);
    if (selectedStudentId && !students.some((student) => student.id === selectedStudentId)) setSelectedStudentId(students[0]?.id ?? null);
  }, [selectedStudentId, students]);

  const run = async (key: string, action: () => Promise<void>, success: string) => {
    if (pending) return;
    setPending(key);
    setMessage(null);
    try {
      await action();
      await controller.reload();
      setMessage(success);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The action could not be completed.');
    } finally {
      setPending(null);
      setSessionMenuOpen(false);
      setStudentMenuOpen(false);
    }
  };

  const runStudentAction = async (key: string, action: () => Promise<{ success: boolean; error?: string }>, success: string) => run(key, async () => {
    const result = await action();
    if (!result.success) throw new Error(result.error ?? 'The student could not be updated.');
  }, success);

  if (!scheduleId) return <ErrorSurface title="SAT session not found" description="A valid SAT session is required." actionLabel="Back to Sessions" onAction={() => navigate('/sat/sessions')} />;
  if (controller.isLoading && !schedule) return <LoadingSurface label="Opening SAT session…" />;
  if (controller.error && !schedule) return <ErrorSurface title="SAT session could not load" description={controller.error} actionLabel="Retry" onAction={() => void controller.reload()} />;
  if (!schedule || !runtime) return <ErrorSurface title="SAT session not found" description="This session is not part of the Digital SAT workspace." actionLabel="Back to Sessions" onAction={() => navigate('/sat/sessions')} />;

  return (
    <div className="min-h-screen bg-[#f5f5f7] text-slate-950">
      <header className="sticky top-0 z-50 border-b border-black/[0.065] bg-white/90 backdrop-blur-2xl">
        <div className="mx-auto flex min-h-[64px] max-w-[1500px] items-center gap-3 px-3 sm:px-5">
          <button type="button" onClick={() => navigate('/sat/sessions')} className="flex min-h-10 shrink-0 items-center gap-1 rounded-[10px] px-2 text-[11px] font-semibold text-slate-500 hover:bg-black/[0.04]"><ArrowLeft size={15} />Sessions</button>
          <div className="h-5 w-px bg-black/[0.075]" />
          <div className="min-w-0 flex-1"><div className="flex items-center gap-2"><p className="truncate text-[13px] font-semibold tracking-[-0.01em]">{schedule.examTitle}</p><span className={`h-1.5 w-1.5 rounded-full ${runtime.status === 'live' ? 'bg-emerald-500' : runtime.status === 'paused' ? 'bg-amber-500' : 'bg-slate-300'}`} /></div><p className="mt-0.5 truncate text-[9px] text-slate-400">{schedule.cohortName} · {runtimeLabel(runtime.status)}</p></div>
          {controller.error ? <span className="hidden text-[9px] font-semibold text-amber-700 sm:inline">Reconnecting</span> : null}
          {openAlerts > 0 ? <div className="hidden items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1.5 text-[9px] font-semibold text-amber-700 sm:flex"><AlertTriangle size={12} />{openAlerts} need attention</div> : null}
          <SessionControls runtimeStatus={runtime.status} pending={pending} menuOpen={sessionMenuOpen} setMenuOpen={setSessionMenuOpen} onStart={() => void run('start', () => controller.handleStartScheduledSession(scheduleId), 'Session started.')} onPause={() => void run('pause', () => controller.handlePauseCohort(scheduleId), 'Session paused.')} onResume={() => void run('resume', () => controller.handleResumeCohort(scheduleId), 'Session resumed.')} onExtend={(minutes) => void run(`extend-${minutes}`, () => controller.handleExtendCurrentSection(scheduleId, minutes), `Added ${minutes} minutes to the current stage.`)} onComplete={() => setConfirm('complete')} />
        </div>
      </header>

      {message ? <div role="status" className="mx-auto max-w-[1500px] px-4 pt-3"><div className="rounded-[10px] bg-black/[0.045] px-3 py-2 text-[10px] font-medium text-slate-600">{message}</div></div> : null}

      <main className="mx-auto grid min-h-[calc(100vh-64px)] max-w-[1500px] lg:grid-cols-[310px_minmax(0,1fr)]">
        <section className="border-b border-black/[0.065] bg-white/45 lg:border-b-0 lg:border-r" aria-label="Students">
          <div className="border-b border-black/[0.055] px-3 py-3">
            <div className="flex items-center justify-between"><div><p className="text-[10px] font-semibold text-slate-700">Students</p><p className="mt-0.5 text-[9px] tabular-nums text-slate-400">{students.length} joined · {students.filter((student) => student.status === 'active').length} active</p></div><span className="text-[10px] font-semibold tabular-nums text-slate-400">{formatRemaining(runtime.currentSectionRemainingSeconds)}</span></div>
            <label htmlFor="sat-room-student-search" className="relative mt-3 block"><Search size={13} className="pointer-events-none absolute left-3 top-2.5 text-slate-400" /><span className="sr-only">Search students</span><input id="sat-room-student-search" aria-label="Search students" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search students" className="h-9 w-full rounded-[10px] border border-black/[0.07] bg-white pl-8 pr-3 text-[11px] outline-none focus:border-[#0071e3]/40 focus:ring-4 focus:ring-[#0071e3]/10" /></label>
          </div>
          <div className="max-h-[44vh] overflow-y-auto lg:max-h-[calc(100vh-166px)]">
            {visibleStudents.length ? visibleStudents.map((student) => <button key={student.id} type="button" aria-label={`Open ${student.name}`} onClick={() => setSelectedStudentId(student.id)} className={`grid min-h-[64px] w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-black/[0.045] px-3 text-left transition ${selectedStudent?.id === student.id ? 'bg-white' : 'hover:bg-white/70'}`}><div className="min-w-0"><div className="flex items-center gap-2"><span className={`h-1.5 w-1.5 shrink-0 rounded-full ${studentTone(student)}`} /><p className="truncate text-[11px] font-semibold text-slate-800">{student.name}</p>{student.warnings > 0 || student.violations.length > 0 ? <AlertTriangle size={11} className="shrink-0 text-amber-500" /> : null}</div><p className="mt-1 truncate pl-3.5 text-[8px] text-slate-400">{String(student.runtimeCurrentSection ?? student.currentSection)}</p></div><div className="text-right"><p className="text-[11px] font-semibold tabular-nums text-slate-600">{formatRemaining(student.runtimeTimeRemainingSeconds ?? student.timeRemaining)}</p><p className="mt-1 text-[8px] capitalize text-slate-400">{student.status}</p></div></button>) : <div className="px-5 py-10 text-center text-[11px] text-slate-400">{students.length ? 'No matching students.' : 'Students appear here when they join.'}</div>}
          </div>
        </section>

        <section className="min-w-0 px-4 py-5 sm:px-6 lg:px-8 lg:py-7">
          <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_250px]">
            <div className="min-w-0">
              <div className="border-b border-black/[0.065] pb-6">
                <p className="text-[9px] font-semibold uppercase tracking-[0.13em] text-slate-400">Current stage</p>
                <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><h1 className="text-[25px] font-semibold tracking-[-0.04em]">{currentStage}</h1><p className="mt-1 text-[10px] text-slate-400">Server-authoritative session clock</p></div><p className="text-[36px] font-semibold tabular-nums tracking-[-0.045em] text-slate-900">{formatRemaining(runtime.currentSectionRemainingSeconds)}</p></div>
              </div>

              {selectedStudent ? <StudentDetail student={selectedStudent} pending={pending} menuOpen={studentMenuOpen} setMenuOpen={setStudentMenuOpen} onAddTime={(minutes) => void runStudentAction(`student-extend-${minutes}`, () => examDeliveryService.extendStudentAttempt(selectedStudent.id, proctorName, minutes), `Added ${minutes} minutes for ${selectedStudent.name}.`)} onWarn={() => void runStudentAction('student-warn', () => examDeliveryService.warnStudent(selectedStudent.id, 'Please return your attention to the exam.', proctorName), `Warning sent to ${selectedStudent.name}.`)} onPause={() => void runStudentAction('student-pause', () => examDeliveryService.pauseStudentAttempt(selectedStudent.id, proctorName), `${selectedStudent.name} paused.`)} onResume={() => void runStudentAction('student-resume', () => examDeliveryService.resumeStudentAttempt(selectedStudent.id, proctorName), `${selectedStudent.name} resumed.`)} onTerminate={() => setConfirm('terminate')} /> : <div className="flex min-h-[380px] flex-col items-center justify-center text-center"><UserRound size={24} className="text-slate-300" /><p className="mt-3 text-[12px] font-semibold text-slate-500">No student selected</p><p className="mt-1 text-[10px] text-slate-400">Select a student to inspect their SAT attempt.</p></div>}
            </div>

            <aside className="border-t border-black/[0.065] pt-5 xl:border-l xl:border-t-0 xl:pl-5 xl:pt-0">
              <p className="text-[9px] font-semibold uppercase tracking-[0.13em] text-slate-400">Session</p>
              <dl className="mt-4 space-y-4"><InfoRow label="Status" value={runtimeLabel(runtime.status)} /><InfoRow label="Current stage" value={currentStage} /><InfoRow label="Joined" value={String(students.length)} /><InfoRow label="Active" value={String(students.filter((student) => student.status === 'active').length)} /><InfoRow label="Warnings" value={String(openAlerts)} /></dl>
              {runtime.isOverrun ? <div className="mt-5 rounded-[12px] bg-amber-50 px-3 py-3 text-[10px] leading-5 text-amber-700"><span className="font-semibold">Running beyond the scheduled window.</span><br />Review current time extensions before ending the session.</div> : null}
            </aside>
          </div>
        </section>
      </main>

      {confirm ? <ConfirmSheet title={confirm === 'complete' ? 'Finish this SAT session?' : `End ${selectedStudent?.name ?? 'this student'}’s attempt?`} description={confirm === 'complete' ? 'The session will be completed for the cohort. This should only be used when testing is finished.' : 'This ends the student’s current attempt. Their recorded answers remain available.'} destructiveLabel={confirm === 'complete' ? 'Finish Session' : 'End Attempt'} onCancel={() => setConfirm(null)} onConfirm={() => { const action = confirm; setConfirm(null); if (action === 'complete') void run('complete', () => controller.handleCompleteExam(scheduleId), 'Session completed.'); else if (selectedStudent) void runStudentAction('student-terminate', () => examDeliveryService.terminateStudentAttempt(selectedStudent.id, proctorName), `${selectedStudent.name}’s attempt ended.`); }} /> : null}
    </div>
  );
}

function SessionControls({ runtimeStatus, pending, menuOpen, setMenuOpen, onStart, onPause, onResume, onExtend, onComplete }: { runtimeStatus: string; pending: string | null; menuOpen: boolean; setMenuOpen: (open: boolean) => void; onStart: () => void; onPause: () => void; onResume: () => void; onExtend: (minutes: number) => void; onComplete: () => void }) {
  const primary = runtimeStatus === 'not_started' ? { label: 'Start', icon: Play, action: onStart } : runtimeStatus === 'live' ? { label: 'Pause', icon: Pause, action: onPause } : runtimeStatus === 'paused' ? { label: 'Resume', icon: Play, action: onResume } : null;
  const Icon = primary?.icon;
  const active = runtimeStatus === 'live' || runtimeStatus === 'paused';
  return <div className="relative flex shrink-0 items-center gap-1.5">{primary && Icon ? <button type="button" onClick={primary.action} disabled={Boolean(pending)} className="flex min-h-10 items-center gap-1.5 rounded-[10px] bg-[#0071e3] px-3 text-[10px] font-semibold text-white hover:bg-[#0077ed] disabled:opacity-40"><Icon size={13} />{pending ? 'Working…' : primary.label}</button> : null}{active ? <button type="button" onClick={() => setMenuOpen(!menuOpen)} className="flex h-10 w-10 items-center justify-center rounded-[10px] text-slate-500 hover:bg-black/[0.04]" aria-label="Session actions" aria-expanded={menuOpen}><MoreHorizontal size={17} /></button> : null}{menuOpen ? <div className="absolute right-0 top-11 z-50 w-44 overflow-hidden rounded-[13px] border border-black/[0.08] bg-white p-1.5 shadow-[0_14px_40px_rgba(0,0,0,0.14)]"><button type="button" onClick={() => onExtend(5)} className="min-h-9 w-full rounded-[9px] px-2.5 text-left text-[10px] font-medium text-slate-600 hover:bg-black/[0.04]">Add 5 minutes</button><button type="button" onClick={() => onExtend(10)} className="min-h-9 w-full rounded-[9px] px-2.5 text-left text-[10px] font-medium text-slate-600 hover:bg-black/[0.04]">Add 10 minutes</button><div className="my-1 h-px bg-black/[0.06]" /><button type="button" onClick={onComplete} className="min-h-9 w-full rounded-[9px] px-2.5 text-left text-[10px] font-semibold text-red-600 hover:bg-red-50">Finish session…</button></div> : null}</div>;
}

function StudentDetail({ student, pending, menuOpen, setMenuOpen, onAddTime, onWarn, onPause, onResume, onTerminate }: { student: StudentSession; pending: string | null; menuOpen: boolean; setMenuOpen: (open: boolean) => void; onAddTime: (minutes: number) => void; onWarn: () => void; onPause: () => void; onResume: () => void; onTerminate: () => void }) {
  const remaining = student.runtimeTimeRemainingSeconds ?? student.timeRemaining;
  return <div className="pt-6"><div className="flex items-start justify-between gap-4"><div className="min-w-0"><p className="text-[9px] font-semibold uppercase tracking-[0.13em] text-slate-400">Student</p><h2 className="mt-1 truncate text-[22px] font-semibold tracking-[-0.035em]">{student.name}</h2><p className="mt-1 text-[10px] text-slate-400">{student.studentId}{student.email ? ` · ${student.email}` : ''}</p></div><div className="relative"><button type="button" onClick={() => setMenuOpen(!menuOpen)} className="flex h-10 items-center gap-1 rounded-[10px] px-2.5 text-[10px] font-semibold text-slate-500 hover:bg-black/[0.04]" aria-expanded={menuOpen}>Actions<ChevronDown size={12} /></button>{menuOpen ? <div className="absolute right-0 top-11 z-40 w-44 rounded-[13px] border border-black/[0.08] bg-white p-1.5 shadow-[0_14px_40px_rgba(0,0,0,0.14)]"><button type="button" disabled={Boolean(pending)} onClick={() => onAddTime(5)} className="min-h-9 w-full rounded-[9px] px-2.5 text-left text-[10px] font-medium text-slate-600 hover:bg-black/[0.04]">Add 5 minutes</button><button type="button" disabled={Boolean(pending)} onClick={onWarn} className="min-h-9 w-full rounded-[9px] px-2.5 text-left text-[10px] font-medium text-slate-600 hover:bg-black/[0.04]">Send warning</button><button type="button" disabled={Boolean(pending)} onClick={student.status === 'paused' ? onResume : onPause} className="min-h-9 w-full rounded-[9px] px-2.5 text-left text-[10px] font-medium text-slate-600 hover:bg-black/[0.04]">{student.status === 'paused' ? 'Resume attempt' : 'Pause attempt'}</button><div className="my-1 h-px bg-black/[0.06]" /><button type="button" disabled={Boolean(pending)} onClick={onTerminate} className="min-h-9 w-full rounded-[9px] px-2.5 text-left text-[10px] font-semibold text-red-600 hover:bg-red-50">End attempt…</button></div> : null}</div></div>
    <div className="mt-7 grid gap-4 border-y border-black/[0.055] py-5 sm:grid-cols-3"><div><p className="text-[9px] text-slate-400">Current module</p><p className="mt-1 text-[12px] font-semibold text-slate-700">{String(student.runtimeCurrentSection ?? student.currentSection)}</p></div><div><p className="text-[9px] text-slate-400">Time remaining</p><p className="mt-1 text-[19px] font-semibold tabular-nums tracking-[-0.03em]">{formatRemaining(remaining)}</p></div><div><p className="text-[9px] text-slate-400">Attempt</p><p className="mt-1 text-[12px] font-semibold capitalize text-slate-700">{student.status}</p></div></div>
    <div className="mt-6"><h3 className="text-[12px] font-semibold tracking-[-0.01em]">Attention</h3>{student.warnings === 0 && student.violations.length === 0 ? <div className="mt-3 flex items-center gap-2 text-[10px] text-slate-400"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />No current warnings or integrity events.</div> : <div className="mt-3 space-y-2">{student.warnings > 0 ? <div className="rounded-[11px] bg-amber-50 px-3 py-2.5 text-[10px] text-amber-700">{student.warnings} proctor warning{student.warnings === 1 ? '' : 's'}</div> : null}{student.violations.slice(0, 5).map((violation) => <div key={violation.id} className="rounded-[11px] bg-amber-50 px-3 py-2.5"><p className="text-[10px] font-semibold text-amber-800">{violation.type.replace(/_/g, ' ')}</p><p className="mt-1 text-[9px] leading-4 text-amber-700">{violation.description}</p></div>)}</div>}</div>
  </div>;
}

function InfoRow({ label, value }: { label: string; value: string }) { return <div><dt className="text-[8px] font-semibold uppercase tracking-[0.1em] text-slate-400">{label}</dt><dd className="mt-1 text-[11px] font-semibold text-slate-700">{value}</dd></div>; }

function ConfirmSheet({ title, description, destructiveLabel, onCancel, onConfirm }: { title: string; description: string; destructiveLabel: string; onCancel: () => void; onConfirm: () => void }) { return <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/25 p-4 backdrop-blur-[2px]" role="dialog" aria-modal="true"><div className="w-full max-w-[390px] rounded-[20px] border border-black/[0.08] bg-white p-5 shadow-[0_20px_70px_rgba(0,0,0,0.18)]"><h2 className="text-[18px] font-semibold tracking-[-0.025em]">{title}</h2><p className="mt-2 text-[11px] leading-5 text-slate-500">{description}</p><div className="mt-5 flex justify-end gap-2"><button type="button" onClick={onCancel} className="min-h-10 rounded-[10px] px-3 text-[11px] font-semibold text-slate-500 hover:bg-black/[0.04]">Cancel</button><button type="button" onClick={onConfirm} className="min-h-10 rounded-[10px] bg-red-600 px-3.5 text-[11px] font-semibold text-white">{destructiveLabel}</button></div></div></div>; }
