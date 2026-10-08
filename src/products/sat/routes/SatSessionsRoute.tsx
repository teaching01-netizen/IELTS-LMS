import { useMemo, useState } from 'react';
import { ArrowRight, CalendarPlus } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthSession } from '../../../features/auth/authSession';
import { useExamListQuery } from '../../../features/exam-authoring/api/examQueries';
import { satPublishScopeCopy } from '../../../features/exam-authoring/ui/release/releaseSelectors';
import { proctorKeys, useProctorSessionSummaries } from '../../../features/proctor/api/proctorQueries';
import { proctorFacade } from '../../../features/proctor/application/proctorFacade';
import { SatSegmentedControl } from '../ui/SegmentedControl';
import { useSatListParams, type SatListBucket } from '../ui/useSatListParams';
import { useSatListReturn } from '../ui/useSatListReturn';
import {
  SatContainer,
  SatEmptyState,
  SatList,
  SatListRow,
  SatListSkeleton,
  SatListToolbar,
  SatPageError,
  SatPageHeader,
  SatPrimaryButton,
  SatResultCount,
  SatSearchField,
  SatStatusPill,
  SatToolbarSelect,
  type SatStatusTone,
} from '../ui/SatPage';
import { SatNewSessionFlow } from './SatNewSessionFlow';

type SessionSort = 'soonest' | 'latest';
type SessionStatus = 'Ready' | 'Running' | 'Paused' | 'Finished' | 'Cancelled';

function bucketFor(status: string, runtimeStatus: string): SatListBucket {
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

const STATUS_TONE: Record<SessionStatus, { tone: SatStatusTone; pulse: boolean }> = {
  Ready: { tone: 'ready', pulse: false },
  Running: { tone: 'live', pulse: true },
  Paused: { tone: 'paused', pulse: false },
  Finished: { tone: 'finished', pulse: false },
  Cancelled: { tone: 'cancelled', pulse: false },
};

const EMPTY_HINT: Record<SatListBucket, string> = {
  upcoming: 'Scheduled SAT sessions wait here until a proctor starts the exam.',
  live: 'Sessions appear here as soon as a proctor starts the exam.',
  finished: 'Finished SAT sessions move here automatically.',
};

export function SatSessionsRoute() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { session } = useAuthSession();
  const summariesQuery = useProctorSessionSummaries(4_000, 'sat');
  const examsQuery = useExamListQuery(session?.user.role === 'admin', 'sat');
  const { params, setParams } = useSatListParams();
  const search = params.q ?? '';
  const [createOpen, setCreateOpen] = useState(false);
  const summaries = useMemo(() => (summariesQuery.data ?? []).filter((summary) => !proctorFacade.isPreviewRuntimeCohortName(summary.schedule.cohortName)), [summariesQuery.data]);
  const counts = useMemo(() => summaries.reduce((result, summary) => {
    result[bucketFor(summary.schedule.status, summary.runtime.status)] += 1;
    return result;
  }, { upcoming: 0, live: 0, finished: 0 } as Record<SatListBucket, number>), [summaries]);
  // No explicit tab: open where the work is (a running session beats an empty Upcoming).
  const bucket: SatListBucket = params.bucket ?? (counts.upcoming === 0 && counts.live > 0 ? 'live' : 'upcoming');
  // Upcoming and live read soonest-first; finished reads most recent first.
  const sort: SessionSort = params.sort === 'soonest' || params.sort === 'latest' ? params.sort : bucket === 'finished' ? 'latest' : 'soonest';
  const { lastOpenedId, openRecord } = useSatListReturn(!summariesQuery.isLoading);

  const visible = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    const direction = sort === 'latest' ? -1 : 1;
    return summaries
      .filter((summary) => bucketFor(summary.schedule.status, summary.runtime.status) === bucket)
      .filter((summary) => !needle || [summary.schedule.examTitle, summary.schedule.cohortName, summary.schedule.institution ?? ''].some((value) => value.toLocaleLowerCase().includes(needle)))
      .sort((left, right) => direction * (new Date(left.schedule.startTime).getTime() - new Date(right.schedule.startTime).getTime()));
  }, [bucket, search, sort, summaries]);

  if (summariesQuery.error) return <SatPageError title="SAT sessions could not load" description={summariesQuery.error instanceof Error ? summariesQuery.error.message : 'Sessions are unavailable.'} retryLabel="Retry" onRetry={() => void summariesQuery.refetch()} />;

  return (
    <SatContainer>
      <SatPageHeader
        eyebrow="Digital SAT"
        title="Sessions"
        description="Every SAT sitting, across exams. Create one here or from an exam’s Sessions tab."
        actions={session?.user.role === 'admin' ? (
          <SatPrimaryButton onClick={() => setCreateOpen(true)} icon={<CalendarPlus size={15} aria-hidden="true" />}>New Session</SatPrimaryButton>
        ) : undefined}
      />

      <SatListToolbar
        label="Session list controls"
        tabs={
          <SatSegmentedControl<SatListBucket>
            label="Session status"
            value={bucket}
            options={[
              { value: 'upcoming', label: 'Upcoming', count: counts.upcoming },
              { value: 'live', label: 'Live', count: counts.live },
              { value: 'finished', label: 'Finished', count: counts.finished },
            ]}
            // Changing tab resets a tab-specific sort back to that tab's natural order.
            onChange={(next) => setParams({ bucket: next, sort: '' })}
            className="sm:max-w-[420px]"
          />
        }
      >
        <SatSearchField
          id="sat-session-search"
          label="Search SAT sessions"
          value={search}
          onChange={(value) => setParams({ q: value })}
          placeholder="Search exam, cohort, institution"
          widthClassName="w-full sm:w-72 sm:flex-none"
        />
        <SatToolbarSelect<SessionSort>
          id="sat-session-sort"
          label="Sort"
          value={sort}
          options={[
            { value: 'soonest', label: 'Start time: earliest first' },
            { value: 'latest', label: 'Start time: latest first' },
          ]}
          onChange={(next) => setParams({ sort: next })}
        />
      </SatListToolbar>

      {summariesQuery.isLoading ? (
        <SatListSkeleton rows={5} label="Loading SAT sessions" />
      ) : visible.length ? (
        <>
        <SatResultCount total={counts[bucket]} visible={visible.length} itemLabel={visible.length === 1 ? 'session' : 'sessions'} />
        <SatList>
          {visible.map((summary, rowIndex) => {
            const state = bucketFor(summary.schedule.status, summary.runtime.status);
            const status: SessionStatus = summary.runtime.status === 'paused'
              ? 'Paused'
              : state === 'live' ? 'Running' : state === 'finished' ? summary.schedule.status === 'cancelled' ? 'Cancelled' : 'Finished' : 'Ready';
            const pill = STATUS_TONE[status];
            const target = '/sat/sessions/' + summary.schedule.id;
            return (
              <SatListRow
                key={summary.schedule.id}
                index={Math.min(rowIndex, 5)}
                rowId={summary.schedule.id}
                current={summary.schedule.id === lastOpenedId}
                onOpen={() => openRecord(summary.schedule.id, target)}
              >
                <span className="grid w-full items-center gap-x-4 gap-y-1 py-2.5 sm:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_120px_16px]">
                  <span className="min-w-0">
                    <span className="block truncate text-[14px] font-semibold tracking-[-0.012em] text-slate-900">{summary.schedule.examTitle}</span>
                    <span className="mt-0.5 block truncate text-[12px] text-slate-500">{summary.schedule.cohortName}{summary.schedule.institution ? ' · ' + summary.schedule.institution : ''} · {satPublishScopeCopy(summary.schedule.publishScope ?? 'full')}</span>
                  </span>
                  <span className="min-w-0 text-[12px] tabular-nums text-slate-600">
                    <span className="block truncate">{formatSessionTime(summary.schedule.startTime)}</span>
                    <span className="block truncate text-slate-500">{summary.studentCount ?? 0} joined · {summary.activeCount ?? 0} active</span>
                  </span>
                  <span><SatStatusPill tone={pill.tone} pulse={pill.pulse}>{status}</SatStatusPill></span>
                  <ArrowRight size={15} className="sat-row-chevron hidden shrink-0 text-slate-400 group-hover:text-slate-500 sm:block" aria-hidden="true" />
                </span>
              </SatListRow>
            );
          })}
        </SatList>
        </>
      ) : (
        <>
        <SatResultCount total={counts[bucket]} visible={0} itemLabel="sessions" />
        <SatEmptyState
          icon={<span aria-hidden="true" className="h-2 w-2 rounded-full bg-slate-300" />}
          title={search.trim() ? 'No matching sessions' : 'No ' + bucket + ' sessions'}
          hint={search.trim() ? `No sessions match “${search.trim()}” in ${bucket === 'live' ? 'Live' : bucket === 'finished' ? 'Finished' : 'Upcoming'}.` : EMPTY_HINT[bucket]}
          action={search.trim() ? <SatPrimaryButton onClick={() => setParams({ q: '' })}>Clear Search</SatPrimaryButton> : undefined}
        />
        </>
      )}

      {createOpen ? (
        <SatNewSessionFlow
          exams={(examsQuery.data?.entities ?? []).filter((exam) => exam.providerKey === 'sat' && Boolean(exam.currentPublishedVersionId))}
          examsLoading={examsQuery.isLoading}
          onClose={() => setCreateOpen(false)}
          onGoToExamLibrary={() => navigate('/sat/exams')}
          onCreated={(scheduleId) => {
            void queryClient.invalidateQueries({ queryKey: proctorKeys.sessions('sat') });
            setCreateOpen(false);
            navigate('/sat/sessions/' + encodeURIComponent(scheduleId));
          }}
        />
      ) : null}
    </SatContainer>
  );
}
