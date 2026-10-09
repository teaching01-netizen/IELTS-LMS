import { useMemo, useState } from 'react';
import { ArrowRight, CalendarPlus, Radio, SearchX } from 'lucide-react';
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
  SAT_ROW_STACK,
  SatButton,
  SatContainer,
  SatEmptyState,
  SatInlineError,
  SatList,
  SatListColumns,
  SatListRow,
  SatListSkeleton,
  SatListToolbar,
  SatPageHeader,
  SatResultCount,
  SatSearchField,
  SatStatusPill,
  SatToolbarSelect,
  type SatStatusTone,
} from '../ui/SatPage';
import { SatNewSessionFlow } from './SatNewSessionFlow';

type SessionSort = 'soonest' | 'latest';
type SessionStatus = 'Not started' | 'Running' | 'Paused' | 'Finished' | 'Cancelled';

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
  'Not started': { tone: 'ready', pulse: false },
  Running: { tone: 'live', pulse: true },
  Paused: { tone: 'paused', pulse: false },
  Finished: { tone: 'finished', pulse: false },
  Cancelled: { tone: 'cancelled', pulse: false },
};

const EMPTY_HINT: Record<SatListBucket, string> = {
  upcoming: 'Prepared rooms wait here until a proctor starts the exam.',
  live: 'Rooms appear here as soon as a proctor starts the exam.',
  finished: 'Finished rooms move here automatically.',
};

const BUCKET_LABEL: Record<SatListBucket, string> = { upcoming: 'Upcoming', live: 'Live', finished: 'Finished' };

/** Shared by the column labels and every row: Room / Starts / Students / Exam status. */
const ROW_GRID = 'grid-cols-[minmax(0,1fr)_16px] gap-x-4 md:grid-cols-[minmax(0,1fr)_184px_112px_136px_16px]';

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

  const loadError = summariesQuery.error ? (summariesQuery.error instanceof Error ? summariesQuery.error.message : 'Rooms are unavailable.') : null;

  return (
    <SatContainer>
      <SatPageHeader
        title="Rooms"
        description="Every room across exams. Open a room to share its student link, start the exam, and monitor it."
        actions={session?.user.role === 'admin' ? (
          <SatButton variant="primary" onClick={() => setCreateOpen(true)} icon={<CalendarPlus size={16} aria-hidden="true" />}>Create room</SatButton>
        ) : undefined}
      />

      <SatListToolbar
        label="Room list controls"
        tabs={
          <SatSegmentedControl<SatListBucket>
            label="Room status"
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
          label="Search rooms"
          value={search}
          onChange={(value) => setParams({ q: value })}
          placeholder="Search rooms or exams"
          widthClassName="w-full sm:w-72 sm:flex-none"
        />
        <SatToolbarSelect<SessionSort>
          id="sat-session-sort"
          label="Sort"
          value={sort}
          options={[
            { value: 'soonest', label: 'Earliest start' },
            { value: 'latest', label: 'Latest start' },
          ]}
          onChange={(next) => setParams({ sort: next })}
        />
      </SatListToolbar>

      {loadError ? (
        <SatInlineError title="Rooms could not load" description={loadError} onRetry={() => void summariesQuery.refetch()} />
      ) : summariesQuery.isLoading ? (
        <SatListSkeleton rows={5} label="Loading rooms" />
      ) : visible.length ? (
        <>
        <SatResultCount total={counts[bucket]} visible={visible.length} itemLabel={visible.length === 1 ? 'room' : 'rooms'} />
        <SatList>
          <SatListColumns gridClassName={ROW_GRID} columns={[{ label: 'Room' }, { label: 'Starts' }, { label: 'Students', align: 'end' }, { label: 'Exam status' }, { label: '' }]} />
          {visible.map((summary, rowIndex) => {
            const state = bucketFor(summary.schedule.status, summary.runtime.status);
            const status: SessionStatus = summary.runtime.status === 'paused'
              ? 'Paused'
              : state === 'live' ? 'Running' : state === 'finished' ? summary.schedule.status === 'cancelled' ? 'Cancelled' : 'Finished' : 'Not started';
            const pill = STATUS_TONE[status];
            const target = '/sat/sessions/' + summary.schedule.id;
            const joined = summary.studentCount ?? 0;
            const active = summary.activeCount ?? 0;
            return (
              <SatListRow
                key={summary.schedule.id}
                index={Math.min(rowIndex, 5)}
                rowId={summary.schedule.id}
                current={summary.schedule.id === lastOpenedId}
                onOpen={() => openRecord(summary.schedule.id, target)}
              >
                <span className={'grid w-full items-center py-3 ' + ROW_GRID}>
                  <span className="min-w-0">
                    <span className="block truncate text-[14px] font-semibold leading-5 tracking-[-0.01em] text-[var(--sat-staff-text-primary,#1d1d1f)]">{summary.schedule.cohortName}</span>
                    <span className="block truncate text-[14px] leading-5 text-[var(--sat-staff-text-secondary,#515154)]">{summary.schedule.examTitle} · {satPublishScopeCopy(summary.schedule.publishScope ?? 'full')}{summary.schedule.institution ? ' · ' + summary.schedule.institution : ''}</span>
                    <span className="block truncate text-[14px] leading-5 tabular-nums text-[var(--sat-staff-text-secondary,#515154)] md:hidden">{formatSessionTime(summary.schedule.startTime)} · {joined} joined</span>
                  </span>
                  <span className="hidden truncate text-[14px] leading-5 tabular-nums text-[var(--sat-staff-text-secondary,#515154)] md:block">{formatSessionTime(summary.schedule.startTime)}</span>
                  <span className="hidden text-right text-[14px] leading-5 tabular-nums text-[var(--sat-staff-text-secondary,#515154)] md:block">
                    <span className="block text-[var(--sat-staff-text-primary,#1d1d1f)]">{joined} joined</span>
                    {state === 'live' ? <span className="block">{active} active</span> : null}
                  </span>
                  <span className={SAT_ROW_STACK.status}><SatStatusPill tone={pill.tone} pulse={pill.pulse}>{status}</SatStatusPill></span>
                  <ArrowRight size={16} className={'sat-row-chevron shrink-0 text-slate-400 group-hover:text-slate-500 ' + SAT_ROW_STACK.chevron} aria-hidden="true" />
                </span>
              </SatListRow>
            );
          })}
        </SatList>
        </>
      ) : (
        <>
        <SatResultCount total={counts[bucket]} visible={0} itemLabel="rooms" />
        <SatEmptyState
          icon={search.trim() ? <SearchX size={20} aria-hidden="true" /> : <Radio size={20} aria-hidden="true" />}
          title={search.trim() ? 'No matching rooms' : 'No ' + bucket + ' rooms'}
          hint={search.trim() ? `No rooms match “${search.trim()}” in ${BUCKET_LABEL[bucket]}.` : EMPTY_HINT[bucket]}
          action={search.trim() ? <SatButton variant="secondary" onClick={() => setParams({ q: '' })}>Clear search</SatButton> : undefined}
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
