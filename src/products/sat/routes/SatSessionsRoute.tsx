import { FormEvent, useEffect, useMemo, useState } from 'react';
import { ArrowRight, CalendarPlus, Search } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { ErrorSurface } from '../../../components/ui/ErrorSurface';
import { LoadingSurface } from '../../../components/ui/LoadingSurface';
import { useAuthSession } from '../../../features/auth/authSession';
import { useExamListQuery } from '../../../features/exam-authoring/api/examQueries';
import { proctorKeys, useProctorSessionSummaries } from '../../../features/proctor/api/proctorQueries';
import { proctorFacade } from '../../../features/proctor/application/proctorFacade';
import { useSaveScheduleMutation } from '../../../features/scheduling/api/scheduleQueries';
import type { ExamSchedule } from '../../../types/domain';
import { SatFormDialog } from '../ui/ConfirmDialog';
import { SatSegmentedControl } from '../ui/SegmentedControl';
import { validateSatScheduleTimes, type SatScheduleTimeErrors } from './scheduleValidation';

type SessionBucket = 'upcoming' | 'live' | 'finished';

function bucketFor(status: string, runtimeStatus: string): SessionBucket {
  if (runtimeStatus === 'live' || runtimeStatus === 'paused' || status === 'live') return 'live';
  if (runtimeStatus === 'completed' || runtimeStatus === 'cancelled' || status === 'completed' || status === 'cancelled') return 'finished';
  return 'upcoming';
}

function formatSessionTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(value));
}

function toLocalDateTimeInput(date: Date): string {
  const offsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

function defaultTimes() {
  const now = new Date();
  const start = new Date(now);
  start.setMinutes(0, 0, 0);
  start.setHours(start.getHours() + 1);
  const end = new Date(start.getTime() + 4 * 60 * 60 * 1000);
  return { start: toLocalDateTimeInput(start), end: toLocalDateTimeInput(end) };
}

export function SatSessionsRoute() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { session } = useAuthSession();
  const summariesQuery = useProctorSessionSummaries(4_000, 'sat');
  const examsQuery = useExamListQuery(session?.user.role === 'admin', 'sat');
  const saveSchedule = useSaveScheduleMutation();
  const [bucket, setBucket] = useState<SessionBucket>('upcoming');
  const [search, setSearch] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const summaries = useMemo(() => (summariesQuery.data ?? []).filter((summary) => !proctorFacade.isPreviewRuntimeCohortName(summary.schedule.cohortName)), [summariesQuery.data]);
  const counts = useMemo(() => summaries.reduce((result, summary) => {
    result[bucketFor(summary.schedule.status, summary.runtime.status)] += 1;
    return result;
  }, { upcoming: 0, live: 0, finished: 0 } as Record<SessionBucket, number>), [summaries]);

  useEffect(() => {
    if (bucket === 'upcoming' && counts.upcoming === 0 && counts.live > 0) setBucket('live');
  }, [bucket, counts.live, counts.upcoming]);

  const visible = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    return summaries
      .filter((summary) => bucketFor(summary.schedule.status, summary.runtime.status) === bucket)
      .filter((summary) => !needle || [summary.schedule.examTitle, summary.schedule.cohortName, summary.schedule.institution ?? ''].some((value) => value.toLocaleLowerCase().includes(needle)))
      .sort((left, right) => new Date(left.schedule.startTime).getTime() - new Date(right.schedule.startTime).getTime());
  }, [bucket, search, summaries]);

  if (summariesQuery.isLoading) return <LoadingSurface label="Opening SAT sessions…" />;
  if (summariesQuery.error) return <ErrorSurface title="SAT sessions could not load" description={summariesQuery.error instanceof Error ? summariesQuery.error.message : 'Sessions are unavailable.'} actionLabel="Retry" onAction={() => void summariesQuery.refetch()} />;

  return (
    <div className="mx-auto w-full max-w-[1180px] px-4 pb-14 pt-7 sm:px-6 md:pt-10 lg:px-10">
      <div className="flex flex-col gap-5 border-b border-black/[0.065] pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div><p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">Digital SAT</p><h1 className="mt-1 text-[30px] font-semibold tracking-[-0.045em]">Sessions</h1></div>
        <div className="flex w-full items-center gap-2 sm:w-auto">
          <label htmlFor="sat-session-search" className="relative min-w-0 flex-1 sm:w-56 sm:flex-none"><Search size={15} className="pointer-events-none absolute left-3 top-3 text-slate-400" /><span className="sr-only">Search SAT sessions</span><input id="sat-session-search" aria-label="Search SAT sessions" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search sessions" className="h-10 w-full rounded-[11px] border border-black/[0.075] bg-white pl-9 pr-3 text-sm outline-none focus:border-[#0071e3]/40 focus:ring-4 focus:ring-[#0071e3]/10" /></label>
          {session?.user.role === 'admin' ? <button type="button" onClick={() => setCreateOpen(true)} className="flex h-10 shrink-0 items-center gap-1.5 rounded-[11px] bg-[#0071e3] px-3.5 text-[12px] font-semibold text-white hover:bg-[#0077ed]"><CalendarPlus size={15} />New Session</button> : null}
        </div>
      </div>

      <SatSegmentedControl<SessionBucket>
        label="Session status"
        value={bucket}
        options={[
          { value: 'upcoming', label: `Upcoming ${counts.upcoming}` },
          { value: 'live', label: `Live ${counts.live}` },
          { value: 'finished', label: `Finished ${counts.finished}` },
        ]}
        onChange={setBucket}
        className="mt-5 max-w-[360px]"
      />

      {visible.length ? (
        <div className="mt-4 divide-y divide-black/[0.055] border-y border-black/[0.055]">
          {visible.map((summary) => {
            const state = bucketFor(summary.schedule.status, summary.runtime.status);
            const status = summary.runtime.status === 'paused' ? 'Paused' : state === 'live' ? 'Live' : state === 'finished' ? summary.schedule.status === 'cancelled' ? 'Cancelled' : 'Finished' : 'Ready';
            return (
              <button key={summary.schedule.id} type="button" onClick={() => navigate(`/sat/sessions/${summary.schedule.id}`)} className="group grid min-h-[88px] w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-1 text-left hover:bg-black/[0.018] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#0071e3] sm:grid-cols-[120px_minmax(0,1fr)_170px_30px]">
                <div className="hidden text-[11px] tabular-nums text-slate-500 sm:block">{formatSessionTime(summary.schedule.startTime)}</div>
                <div className="min-w-0 py-3"><div className="flex items-center gap-2"><span className={`h-1.5 w-1.5 shrink-0 rounded-full ${state === 'live' ? 'bg-emerald-500' : summary.runtime.status === 'paused' ? 'bg-amber-500' : 'bg-slate-300'}`} /><p className="truncate text-[13px] font-semibold text-slate-900">{summary.schedule.examTitle}</p></div><p className="mt-1 truncate pl-3.5 text-[10px] text-slate-400">{summary.schedule.cohortName}{summary.schedule.institution ? ` · ${summary.schedule.institution}` : ''}</p><p className="mt-1 pl-3.5 text-[9px] text-slate-400 sm:hidden">{formatSessionTime(summary.schedule.startTime)}</p></div>
                <div className="text-right"><p className={`text-[10px] font-semibold ${state === 'live' ? 'text-emerald-700' : 'text-slate-500'}`}>{status}</p><p className="mt-1 text-[9px] tabular-nums text-slate-400">{summary.studentCount ?? 0} joined · {summary.activeCount ?? 0} active</p></div>
                <ArrowRight size={15} className="hidden text-slate-300 transition-transform group-hover:translate-x-0.5 group-hover:text-slate-500 sm:block" />
              </button>
            );
          })}
        </div>
      ) : (
        <div className="flex min-h-[330px] flex-col items-center justify-center text-center"><div className="h-2 w-2 rounded-full bg-slate-300" /><h2 className="mt-4 text-[16px] font-semibold tracking-[-0.02em]">No {bucket} sessions</h2><p className="mt-1 max-w-sm text-[12px] leading-5 text-slate-400">{bucket === 'upcoming' ? 'Scheduled SAT sessions will wait here until they begin.' : bucket === 'live' ? 'Live SAT sessions appear here as soon as a proctor starts them.' : 'Completed SAT sessions move here automatically.'}</p></div>
      )}

      {createOpen ? <NewSatSessionSheet exams={(examsQuery.data?.entities ?? []).filter((exam) => exam.providerKey === 'sat' && Boolean(exam.currentPublishedVersionId))} saving={saveSchedule.isPending} onClose={() => setCreateOpen(false)} onCreate={async (schedule) => { await saveSchedule.mutateAsync(schedule); await queryClient.invalidateQueries({ queryKey: proctorKeys.sessions('sat') }); setCreateOpen(false); }} /> : null}
    </div>
  );
}

function NewSatSessionSheet({ exams, saving, onClose, onCreate }: { exams: Array<{ id: string; title: string; currentPublishedVersionId: string | null }>; saving: boolean; onClose: () => void; onCreate: (schedule: ExamSchedule) => Promise<void> }) {
  const initial = defaultTimes();
  const [examId, setExamId] = useState(exams[0]?.id ?? '');
  const [cohort, setCohort] = useState('');
  const [institution, setInstitution] = useState('');
  const [start, setStart] = useState(initial.start);
  const [end, setEnd] = useState(initial.end);
  const [error, setError] = useState<string | null>(null);
  const [timeErrors, setTimeErrors] = useState<SatScheduleTimeErrors>({});
  const selectedExam = exams.find((exam) => exam.id === examId) ?? null;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedExam?.currentPublishedVersionId || !cohort.trim()) return;
    const nextTimeErrors = validateSatScheduleTimes(start, end);
    setTimeErrors(nextTimeErrors);
    if (Object.keys(nextTimeErrors).length > 0 || !start || !end) return;
    setError(null);
    const now = new Date().toISOString();
    const schedule: ExamSchedule = {
      id: crypto.randomUUID(), examId: selectedExam.id, providerKey: 'sat', examTitle: selectedExam.title,
      proctorDisplayName: selectedExam.title, gradingDisplayName: selectedExam.title,
      publishedVersionId: selectedExam.currentPublishedVersionId, cohortName: cohort.trim(),
      ...(institution.trim() ? { institution: institution.trim() } : {}),
      startTime: new Date(start).toISOString(), endTime: new Date(end).toISOString(), plannedDurationMinutes: 0,
      deliveryMode: 'proctor_start', autoStart: false, autoStop: false, status: 'scheduled',
      createdAt: now, createdBy: 'SAT Workspace', updatedAt: now,
    };
    try { await onCreate(schedule); } catch (createError) { setError(createError instanceof Error ? createError.message : 'The session could not be scheduled.'); }
  };

  return (
    <SatFormDialog open eyebrow="Digital SAT" title="New Session" onClose={onClose}>
      <form onSubmit={submit}>
        <div className="space-y-4 px-5 py-4">
    {exams.length ? <><label htmlFor="sat-session-exam" className="block text-[11px] font-semibold text-slate-600">Exam<select id="sat-session-exam" aria-label="SAT exam" value={examId} onChange={(event) => setExamId(event.target.value)} className="mt-1.5 h-11 w-full rounded-[11px] border border-black/[0.09] bg-white px-3 text-[13px] outline-none focus:border-[#0071e3]/40">{exams.map((exam) => <option key={exam.id} value={exam.id}>{exam.title}</option>)}</select></label><label htmlFor="sat-session-name" className="block text-[11px] font-semibold text-slate-600">Session name<input id="sat-session-name" aria-label="Session name" value={cohort} onChange={(event) => setCohort(event.target.value)} placeholder="September Mock · Morning" maxLength={255} className="mt-1.5 h-11 w-full rounded-[11px] border border-black/[0.09] px-3 text-[13px] outline-none focus:border-[#0071e3]/40" /></label><label htmlFor="sat-session-institution" className="block text-[11px] font-semibold text-slate-600">Institution <span className="font-normal text-slate-400">Optional</span><input id="sat-session-institution" aria-label="Institution" value={institution} onChange={(event) => setInstitution(event.target.value)} className="mt-1.5 h-11 w-full rounded-[11px] border border-black/[0.09] px-3 text-[13px] outline-none focus:border-[#0071e3]/40" /></label><div className="grid gap-3 sm:grid-cols-2"><label htmlFor="sat-session-start" className="block text-[11px] font-semibold text-slate-600">Starts<input id="sat-session-start" aria-label="Session start time" aria-invalid={Boolean(timeErrors.start)} aria-describedby={timeErrors.start ? 'sat-session-start-error' : undefined} type="datetime-local" value={start} onChange={(event) => { setStart(event.target.value); setTimeErrors(({ end }) => (end ? { end } : {})); }} className="mt-1.5 h-11 w-full rounded-[11px] border border-black/[0.09] px-3 text-[12px] outline-none focus:border-[#0071e3]/40" />{timeErrors.start ? <span id="sat-session-start-error" role="alert" className="mt-1 block text-[10px] font-medium text-red-600">{timeErrors.start}</span> : null}</label><label htmlFor="sat-session-end" className="block text-[11px] font-semibold text-slate-600">Ends<input id="sat-session-end" aria-label="Session end time" aria-invalid={Boolean(timeErrors.end)} aria-describedby={timeErrors.end ? 'sat-session-end-error' : undefined} type="datetime-local" value={end} onChange={(event) => { setEnd(event.target.value); setTimeErrors(({ start }) => (start ? { start } : {})); }} className="mt-1.5 h-11 w-full rounded-[11px] border border-black/[0.09] px-3 text-[12px] outline-none focus:border-[#0071e3]/40" />{timeErrors.end ? <span id="sat-session-end-error" role="alert" className="mt-1 block text-[10px] font-medium text-red-600">{timeErrors.end}</span> : null}</label></div></> : <div className="rounded-[12px] bg-black/[0.035] px-4 py-4 text-[12px] leading-5 text-slate-500">Publish a SAT exam before scheduling a session.</div>}
    {error ? <p role="alert" className="text-[11px] font-medium text-red-600">{error}</p> : null}
  </div>
        <div className="flex justify-end gap-2 border-t border-black/[0.055] px-5 py-3">
          <button type="button" onClick={onClose} className="min-h-10 rounded-[10px] px-3 text-[12px] font-semibold text-slate-500 hover:bg-black/[0.04]">Cancel</button>
          <button type="submit" disabled={!selectedExam || !cohort.trim() || !start || !end || saving} className="min-h-10 rounded-[10px] bg-[#0071e3] px-4 text-[12px] font-semibold text-white disabled:bg-slate-200 disabled:text-slate-400">{saving ? 'Scheduling…' : 'Schedule'}</button>
        </div>
      </form>
    </SatFormDialog>
  );
}
