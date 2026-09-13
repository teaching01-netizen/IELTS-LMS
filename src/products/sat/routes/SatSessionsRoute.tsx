import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, CalendarPlus } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { SatPageError } from '../ui/SatPage';
import { useAuthSession } from '../../../features/auth/authSession';
import { useExamListQuery } from '../../../features/exam-authoring/api/examQueries';
import { proctorKeys, useProctorSessionSummaries } from '../../../features/proctor/api/proctorQueries';
import { proctorFacade } from '../../../features/proctor/application/proctorFacade';
import { useSaveScheduleMutation } from '../../../features/scheduling/api/scheduleQueries';
import type { ExamSchedule } from '../../../types/domain';
import { SatConfirmDialog, SatFormDialog, isSatCreationDirty } from '../ui/ConfirmDialog';
import { SatSegmentedControl } from '../ui/SegmentedControl';
import {
  SatContainer,
  SatEmptyState,
  SatList,
  SatListRow,
  SatListSkeleton,
  SatPageHeader,
  SatPrimaryButton,
  SatResultCount,
  SatSearchField,
  SatStatStrip,
  SatStatusPill,
  type SatStatusTone,
} from '../ui/SatPage';
import { validateSatScheduleTimes, type SatScheduleTimeErrors } from './scheduleValidation';

type SessionBucket = 'upcoming' | 'live' | 'finished';

function bucketFor(status: string, runtimeStatus: string): SessionBucket {
  if (runtimeStatus === 'live' || runtimeStatus === 'paused' || status === 'live') return 'live';
  if (runtimeStatus === 'completed' || runtimeStatus === 'cancelled' || status === 'completed' || status === 'cancelled') return 'finished';
  return 'upcoming';
}

function formatSessionTime(value: string | null | undefined): string {
  if (!value) return '—';
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return '—';
  return new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(time));
}

function sessionStatusTone(status: string): { tone: SatStatusTone; pulse: boolean } {
  if (status === 'Live') return { tone: 'live', pulse: true };
  if (status === 'Paused') return { tone: 'paused', pulse: false };
  if (status === 'Ready') return { tone: 'ready', pulse: false };
  if (status === 'Finished') return { tone: 'finished', pulse: false };
  if (status === 'Cancelled') return { tone: 'cancelled', pulse: false };
  return { tone: 'neutral', pulse: false };
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

  if (summariesQuery.error) return <SatPageError title="SAT sessions could not load" description={summariesQuery.error instanceof Error ? summariesQuery.error.message : 'Sessions are unavailable.'} retryLabel="Retry" onRetry={() => void summariesQuery.refetch()} />;

  return (
    <SatContainer>
      <SatPageHeader
        eyebrow="Digital SAT"
        title="Sessions"
        description="Proctored SAT administrations across cohorts."
        actions={
          <>
            <SatSearchField
              id="sat-session-search"
              label="Search SAT sessions"
              value={search}
              onChange={setSearch}
              placeholder="Search exam, cohort, institution"
              widthClassName="sm:w-56 sm:flex-none"
            />
            {session?.user.role === 'admin' ? (
              <SatPrimaryButton onClick={() => setCreateOpen(true)} icon={<CalendarPlus size={15} aria-hidden="true" />}>New Session</SatPrimaryButton>
            ) : null}
          </>
        }
      />

      <SatStatStrip
        label="Session summary"
        stats={[
          { id: 'upcoming', label: 'Upcoming', value: counts.upcoming },
          { id: 'live', label: 'Live', value: counts.live },
          { id: 'finished', label: 'Finished', value: counts.finished },
        ]}
      />

      <SatSegmentedControl<SessionBucket>
        label="Session status"
        value={bucket}
        options={[
          { value: 'upcoming', label: 'Upcoming' },
          { value: 'live', label: 'Live' },
          { value: 'finished', label: 'Finished' },
        ]}
        onChange={setBucket}
        className="mt-5 max-w-[360px]"
      />

      {summariesQuery.isLoading ? (
        <SatListSkeleton rows={5} label="Loading SAT sessions" />
      ) : visible.length ? (
        <>
        <SatResultCount total={summaries.length} visible={visible.length} itemLabel={visible.length === 1 ? 'session' : 'sessions'} />
        <SatList>
          {visible.map((summary, rowIndex) => {
            const state = bucketFor(summary.schedule.status, summary.runtime.status);
            const status = summary.runtime.status === 'paused' ? 'Paused' : state === 'live' ? 'Live' : state === 'finished' ? summary.schedule.status === 'cancelled' ? 'Cancelled' : 'Finished' : 'Ready';
            const pill = sessionStatusTone(status);
            return (
              <SatListRow key={summary.schedule.id} index={Math.min(rowIndex, 5)} onOpen={() => navigate('/sat/sessions/' + summary.schedule.id)}>
                <span className="flex w-full items-center gap-3 py-3">
                  <span className="min-w-0 flex-1">
                    {/* Density ladder: Sessions names at 13px; Library titles at 14px, Results add a 17px score. */}
                    <span className="block truncate text-[13px] font-semibold tracking-[-0.012em] text-slate-900">{summary.schedule.examTitle}</span>
                    <span className="mt-1 block truncate text-[10px] text-slate-400">{summary.schedule.cohortName}{summary.schedule.institution ? ' · ' + summary.schedule.institution : ''}</span>
                    <span className="mt-1 block truncate text-[10px] tabular-nums text-slate-400">{formatSessionTime(summary.schedule.startTime)} · {summary.studentCount ?? 0} joined · {summary.activeCount ?? 0} active</span>
                  </span>
                  <SatStatusPill tone={pill.tone} pulse={pill.pulse}>{status}</SatStatusPill>
                  <ArrowRight size={15} className="sat-row-chevron shrink-0 text-slate-400 group-hover:text-slate-500" aria-hidden="true" />
                </span>
              </SatListRow>
            );
          })}
        </SatList>
        </>
      ) : (
        <>
          <SatResultCount total={summaries.length} visible={0} itemLabel="sessions" />
          <SatEmptyState
            icon={<span aria-hidden="true" className="h-2 w-2 rounded-full bg-slate-300" />}
            title={search.trim() ? 'No matching sessions' : 'No ' + bucket + ' sessions'}
            hint={search.trim() ? `No sessions match “${search.trim()}”.` : bucket === 'upcoming' ? 'Scheduled SAT sessions will wait here until they begin.' : bucket === 'live' ? 'Live SAT sessions appear here as soon as a proctor starts them.' : 'Completed SAT sessions move here automatically.'}
            action={search.trim() ? <SatPrimaryButton onClick={() => setSearch('')}>Clear Search</SatPrimaryButton> : undefined}
          />
        </>
      )}

      {createOpen ? <NewSatSessionSheet exams={(examsQuery.data?.entities ?? []).filter((exam) => exam.providerKey === 'sat' && Boolean(exam.currentPublishedVersionId))} examsLoading={examsQuery.isLoading} saving={saveSchedule.isPending} onClose={() => setCreateOpen(false)} onGoToExamLibrary={() => navigate('/sat/exams')} onCreate={async (schedule) => { await saveSchedule.mutateAsync(schedule); await queryClient.invalidateQueries({ queryKey: proctorKeys.sessions('sat') }); setCreateOpen(false); setBucket('upcoming'); setSearch(''); }} /> : null}
    </SatContainer>
  );
}


function randomScheduleId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `sat-schedule-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function NewSatSessionSheet({ exams, examsLoading, saving, onClose, onGoToExamLibrary, onCreate }: { exams: Array<{ id: string; title: string; currentPublishedVersionId: string | null }>; examsLoading: boolean; saving: boolean; onClose: () => void; onGoToExamLibrary: () => void; onCreate: (schedule: ExamSchedule) => Promise<void> }) {
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const initial = defaultTimes();
  const initialRef = useRef(initial);
  const firstFieldRef = useRef<HTMLSelectElement | HTMLInputElement | null>(null);
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => firstFieldRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, []);
  const [examId, setExamId] = useState(exams[0]?.id ?? '');
  useEffect(() => { if (!examId && exams[0]) setExamId(exams[0].id); }, [examId, exams]);
  const [cohort, setCohort] = useState('');
  const [institution, setInstitution] = useState('');
  const [start, setStart] = useState(initial.start);
  const [end, setEnd] = useState(initial.end);
  const [error, setError] = useState<string | null>(null);
  const [timeErrors, setTimeErrors] = useState<SatScheduleTimeErrors>({});
  const selectedExam = exams.find((exam) => exam.id === examId) ?? null;
  const dirty = isSatCreationDirty({
    title: cohort,
    cohort: "",
    exam: "",
    start: start !== initialRef.current.start ? start : "",
    end: end !== initialRef.current.end ? end : "",
  }) || institution.trim() !== "";
  const requestClose = () => {
    if (saving) return;
    if (dirty) setConfirmDiscard(true);
    else onClose();
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedExam?.currentPublishedVersionId || !cohort.trim()) return;
    const nextTimeErrors = validateSatScheduleTimes(start, end);
    setTimeErrors(nextTimeErrors);
    if (Object.keys(nextTimeErrors).length > 0 || !start || !end) return;
    setError(null);
    const now = new Date().toISOString();
    const schedule: ExamSchedule = {
      id: randomScheduleId(), examId: selectedExam.id, providerKey: 'sat', examTitle: selectedExam.title,
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
    <>
    <SatFormDialog open eyebrow="Digital SAT" title="New Session" onClose={requestClose}>
      <form onSubmit={submit}>
        <div className="space-y-4 px-5 py-4">
    {examsLoading && !exams.length ? <p role="status" className="rounded-[12px] bg-black/[0.035] px-4 py-4 text-[12px] leading-5 text-slate-500">Loading published SAT exams…</p> : exams.length ? <><label htmlFor="sat-session-exam" className="block text-[11px] font-semibold text-slate-600">Exam<select ref={firstFieldRef as React.RefObject<HTMLSelectElement>} id="sat-session-exam" aria-label="SAT exam" value={examId} onChange={(event) => setExamId(event.target.value)} className="mt-1.5 h-11 w-full rounded-[11px] border border-[var(--sat-staff-border-strong,rgba(0,0,0,0.09))] bg-white px-3 text-[13px] outline-none focus:border-[var(--sat-staff-accent-ring,rgba(0,113,227,0.4))] focus:ring-4 focus:ring-[var(--sat-staff-accent-ring-soft,rgba(0,113,227,0.1))]">{exams.map((exam) => <option key={exam.id} value={exam.id}>{exam.title}</option>)}</select></label><label htmlFor="sat-session-name" className="block text-[11px] font-semibold text-slate-600">Session name<input id="sat-session-name" aria-label="Session name" value={cohort} onChange={(event) => setCohort(event.target.value)} placeholder="September Mock · Morning" maxLength={255} className="mt-1.5 h-11 w-full rounded-[11px] border border-[var(--sat-staff-border-strong,rgba(0,0,0,0.09))] px-3 text-[13px] outline-none focus:border-[var(--sat-staff-accent-ring,rgba(0,113,227,0.4))] focus:ring-4 focus:ring-[var(--sat-staff-accent-ring-soft,rgba(0,113,227,0.1))]" /></label><label htmlFor="sat-session-institution" className="block text-[11px] font-semibold text-slate-600">Institution <span className="font-normal text-slate-400">Optional</span><input id="sat-session-institution" aria-label="Institution" value={institution} onChange={(event) => setInstitution(event.target.value)} className="mt-1.5 h-11 w-full rounded-[11px] border border-[var(--sat-staff-border-strong,rgba(0,0,0,0.09))] px-3 text-[13px] outline-none focus:border-[var(--sat-staff-accent-ring,rgba(0,113,227,0.4))] focus:ring-4 focus:ring-[var(--sat-staff-accent-ring-soft,rgba(0,113,227,0.1))]" /></label><div className="grid gap-3 sm:grid-cols-2"><label htmlFor="sat-session-start" className="block text-[11px] font-semibold text-slate-600">Starts<input id="sat-session-start" aria-label="Session start time" aria-invalid={Boolean(timeErrors.start)} aria-describedby={timeErrors.start ? 'sat-session-start-error' : undefined} type="datetime-local" value={start} onChange={(event) => { setStart(event.target.value); setTimeErrors(({ end }) => (end ? { end } : {})); }} className="mt-1.5 h-11 w-full rounded-[11px] border border-[var(--sat-staff-border-strong,rgba(0,0,0,0.09))] px-3 text-[12px] outline-none focus:border-[var(--sat-staff-accent-ring,rgba(0,113,227,0.4))] focus:ring-4 focus:ring-[var(--sat-staff-accent-ring-soft,rgba(0,113,227,0.1))]" />{timeErrors.start ? <span id="sat-session-start-error" role="alert" className="mt-1 block text-[10px] font-medium text-red-600">{timeErrors.start}</span> : null}</label><label htmlFor="sat-session-end" className="block text-[11px] font-semibold text-slate-600">Ends<input id="sat-session-end" aria-label="Session end time" aria-invalid={Boolean(timeErrors.end)} aria-describedby={timeErrors.end ? 'sat-session-end-error' : undefined} type="datetime-local" value={end} onChange={(event) => { setEnd(event.target.value); setTimeErrors(({ start }) => (start ? { start } : {})); }} className="mt-1.5 h-11 w-full rounded-[11px] border border-[var(--sat-staff-border-strong,rgba(0,0,0,0.09))] px-3 text-[12px] outline-none focus:border-[var(--sat-staff-accent-ring,rgba(0,113,227,0.4))] focus:ring-4 focus:ring-[var(--sat-staff-accent-ring-soft,rgba(0,113,227,0.1))]" />{timeErrors.end ? <span id="sat-session-end-error" role="alert" className="mt-1 block text-[10px] font-medium text-red-600">{timeErrors.end}</span> : null}</label></div></> : <><div className="rounded-[12px] bg-black/[0.035] px-4 py-4 text-[12px] leading-5 text-slate-500">Publish a SAT exam before scheduling a session.</div><div className="mt-3"><button type="button" onClick={() => { onClose(); onGoToExamLibrary(); }} className="min-h-10 rounded-[10px] bg-white px-3 text-[12px] font-semibold text-slate-700 shadow-sm ring-1 ring-black/[0.08] hover:bg-slate-50">Go to Exam Library</button></div></>}
    <p className="text-[10px] leading-4 text-slate-400">Times are entered in your local timezone.{start && end && !Number.isNaN(new Date(start).getTime()) && !Number.isNaN(new Date(end).getTime()) ? ` This schedules ${new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(start))} – ${new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(end))} local time.` : ''}</p>
    {error ? <p role="alert" className="text-[11px] font-medium text-red-600">{error}</p> : null}
  </div>
        <div className="flex justify-end gap-2 border-t border-[var(--sat-staff-border-hairline,rgba(0,0,0,0.06))] px-5 py-3">
          <button type="button" onClick={requestClose} className="min-h-10 rounded-[10px] px-3 text-[12px] font-semibold text-slate-500 hover:bg-black/[0.04]">Cancel</button>
          <button type="submit" disabled={!selectedExam || !cohort.trim() || !start || !end || saving} className="min-h-10 rounded-[10px] bg-[var(--sat-staff-accent,#0071e3)] px-4 text-[12px] font-semibold text-white transition-colors hover:bg-[var(--sat-staff-accent-hover,#0077ed)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-staff-accent-ring,rgba(0,113,227,0.4))] active:bg-[var(--sat-staff-accent-active,#0067c9)] disabled:bg-slate-200 disabled:text-slate-400">{saving ? 'Scheduling…' : 'Schedule'}</button>
        </div>
      </form>
    </SatFormDialog>
    {confirmDiscard ? <SatConfirmDialog open title="Discard this session?" description="The session name and details you entered will be lost." confirmLabel="Discard" destructive onCancel={() => setConfirmDiscard(false)} onConfirm={() => { if (saving) return; setConfirmDiscard(false); onClose(); }} /> : null}
    </>
  );
}
