import { useSatNavigate } from "../ui/useSatNavigate";
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowRight, CalendarPlus, Check, Radio, SearchX, X } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthSession } from '../../../features/auth/authSession';
import { requestAuthoringDraftOnEntry } from '../../../features/exam-authoring/api/authoringEntryIntent';
import { satIssueRoute } from '../../../features/exam-authoring/ui/release/satIssueRoute';
import { useExamListQuery } from '../../../features/exam-authoring/api/examQueries';
import { satPublishScopeCopy } from '../../../features/exam-authoring/ui/release/releaseSelectors';
import { proctorKeys, useProctorSessionSummaries } from '../../../features/proctor/api/proctorQueries';
import { proctorFacade } from '../../../features/proctor/api/proctorFacade';
import { proctorMutations } from '../../../features/proctor/api/proctorMutations';
import { isCommandConfirmed } from '../../../features/proctor/api/proctorRoomApi';
import { SatSegmentedControl } from '../ui/SegmentedControl';
import { useSatListParams, type SatListBucket } from '../ui/useSatListParams';
import { useSatListReturn } from '../ui/useSatListReturn';
import { viewerTimeZoneLabel } from './satTestTime';
import { SatConfirmDialog } from '../ui/ConfirmDialog';
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

// The start mode is resolved when a room is created (proctor or student code),
// so this help never promises one of them before the room knows its own.
const EMPTY_HINT: Record<SatListBucket, string> = {
  upcoming: 'Prepared rooms wait here until the exam starts.',
  live: 'Rooms appear here while students are taking the exam.',
  finished: 'Finished rooms move here automatically.',
};

const BUCKET_LABEL: Record<SatListBucket, string> = { upcoming: 'Upcoming', live: 'Live', finished: 'Finished' };

/** Shared by the column labels and every row: Room / Starts / Students / Exam status. */
const ROW_GRID = 'grid-cols-[minmax(0,1fr)_16px] gap-x-4 md:grid-cols-[minmax(0,1fr)_184px_112px_136px_16px]';

/**
 * Selection mode adds the checkbox column and drops the chevron: the row is a
 * toggle, not a destination, so nothing promises a drill-in that will not happen.
 */
const SELECT_ROW_GRID = 'grid-cols-[20px_minmax(0,1fr)] gap-x-3 md:grid-cols-[20px_minmax(0,1fr)_184px_112px_136px]';

/** Status drops under the room name, clearing the checkbox column. */
const SELECT_STATUS_STACK = 'col-start-2 row-start-2 mt-2 flex md:col-start-auto md:row-start-auto md:mt-0';

type BulkNotice = { tone: 'success' | 'error'; text: string };

export function SatSessionsRoute() {
  const navigate = useSatNavigate();
  const queryClient = useQueryClient();
  const { session } = useAuthSession();
  const summariesQuery = useProctorSessionSummaries(4_000, 'sat');
  const examsQuery = useExamListQuery(session?.user.role === 'admin', 'sat', false);
  const { params, setParams } = useSatListParams();
  const search = params.q ?? '';
  const examFilter = params.exam ?? null;
  const [createOpen, setCreateOpen] = useState(false);
  const allSummaries = useMemo(() => (summariesQuery.data ?? []).filter((summary) => !proctorFacade.isPreviewRuntimeCohortName(summary.schedule.cohortName)), [summariesQuery.data]);
  const summaries = useMemo(() => (examFilter ? allSummaries.filter((summary) => summary.schedule.examId === examFilter) : allSummaries), [allSummaries, examFilter]);
  const examFilterTitle = examFilter
    ? allSummaries.find((summary) => summary.schedule.examId === examFilter)?.schedule.examTitle
      ?? examsQuery.data?.entities.find((exam) => exam.id === examFilter)?.title
      ?? 'Selected exam'
    : null;
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

  // ---------------------------------------------------------- bulk end of exams
  // Ending an exam is irreversible, so selection exists only where it applies:
  // live rooms. Leaving the view (tab or search) resets it.
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(() => new Set());
  const [confirmEndOpen, setConfirmEndOpen] = useState(false);
  const [endPending, setEndPending] = useState(false);
  const [bulkNotice, setBulkNotice] = useState<BulkNotice | null>(null);
  // Ending applies to every room that has not finished: a room that never
  // started can still be closed (the server completes the runtime with no
  // attempts to submit). Finished rooms are already terminal.
  const bucketCanEnd = bucket === 'live' || bucket === 'upcoming';
  const selectedCount = visible.reduce((count, summary) => (selectedIds.has(summary.schedule.id) ? count + 1 : count), 0);
  const allVisibleSelected = visible.length > 0 && selectedCount === visible.length;

  useEffect(() => {
    setSelectMode(false);
    setSelectedIds(new Set());
    setConfirmEndOpen(false);
    setBulkNotice(null);
  }, [bucket, search]);

  const toggleRowSelection = useCallback((scheduleId: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(scheduleId)) next.delete(scheduleId);
      else next.add(scheduleId);
      return next;
    });
  }, []);

  /**
   * One command per room, in batches of five. No fail-fast: every selected room
   * gets its own attempt, and the notice names the ones that failed.
   */
  const endSelectedExams = async () => {
    const ids = visible.map((summary) => summary.schedule.id).filter((id) => selectedIds.has(id));
    if (ids.length === 0) return;
    const namesById = new Map(visible.map((summary) => [summary.schedule.id, summary.schedule.cohortName]));
    setConfirmEndOpen(false);
    setEndPending(true);
    const ended: string[] = [];
    const failed: string[] = [];
    for (let offset = 0; offset < ids.length; offset += 5) {
      const batch = ids.slice(offset, offset + 5);
      const outcomes = await Promise.allSettled(batch.map(async (scheduleId) => {
        const outcome = await proctorMutations.completeRuntime(scheduleId, 'Proctor');
        if (!isCommandConfirmed(outcome)) throw new Error(outcome.error);
      }));
      outcomes.forEach((outcome, index) => {
        const scheduleId = batch[index] as string;
        if (outcome.status === 'fulfilled') ended.push(scheduleId);
        else failed.push(namesById.get(scheduleId) ?? scheduleId);
      });
    }
    setEndPending(false);
    setSelectedIds(new Set());
    setSelectMode(false);
    setBulkNotice(failed.length
      ? {
        tone: 'error',
        text: `${ended.length} ended, ${failed.length} failed: ${failed.slice(0, 5).join(', ')}${failed.length > 5 ? ` (+${failed.length - 5} more)` : ''}.`,
      }
      : { tone: 'success', text: `${ended.length} room${ended.length === 1 ? '' : 's'} ended.` });
    await queryClient.invalidateQueries({ queryKey: proctorKeys.sessions('sat') });
  };

  return (
    <SatContainer>
      <SatPageHeader
        title="Rooms"
        description="Every room across exams. Open a room to share its student link, see how the sitting starts, and monitor it."
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
        {examFilterTitle ? (
          <span className="inline-flex min-h-11 max-w-full items-center gap-1 rounded-full bg-[var(--sat-staff-fill-chip,rgba(0,0,0,0.04))] pl-3.5 text-[14px] font-medium text-[var(--sat-staff-text-primary,#1d1d1f)]">
            <span className="truncate"><span className="text-[var(--sat-staff-text-secondary,#515154)]">Exam: </span>{examFilterTitle}</span>
            <button
              type="button"
              onClick={() => setParams({ exam: '' })}
              aria-label={`Show rooms from all exams (remove filter ${examFilterTitle})`}
              className="sat-press flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[var(--sat-staff-text-tertiary,#6e6e73)] hover:text-[var(--sat-staff-text-primary,#1d1d1f)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-au-accent/40"
            >
              <X size={14} aria-hidden="true" />
            </button>
          </span>
        ) : null}
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
        {/* Every room that has not finished can be ended, so Upcoming and Live both offer it. */}
        {bucketCanEnd && visible.length > 0 ? (
          <SatButton
            variant="secondary"
            aria-pressed={selectMode}
            onClick={() => {
              setSelectMode((current) => !current);
              setSelectedIds(new Set());
              setBulkNotice(null);
            }}
          >
            Select rooms
          </SatButton>
        ) : null}
      </SatListToolbar>

      <p className="mt-3 text-[14px] leading-5 text-[var(--sat-staff-text-secondary,#515154)]">
        Room start times use your local timezone ({viewerTimeZoneLabel()}). The live run sheet uses Thailand time · ICT (UTC+7).
      </p>

      {selectMode ? (
        <div
          role="group"
          aria-label="Bulk room actions"
          className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-[var(--sat-staff-radius-card,14px)] border border-[var(--sat-staff-border-hairline,rgba(0,0,0,0.06))] bg-[var(--sat-staff-fill-faint,rgba(0,0,0,0.035))] px-4 py-2"
        >
          <label htmlFor="sat-room-select-all" className="inline-flex min-h-11 items-center gap-2 text-[14px] font-medium text-[var(--sat-staff-text-primary,#1d1d1f)]">
            <input
              id="sat-room-select-all"
              type="checkbox"
              aria-label="Select all"
              checked={allVisibleSelected}
              ref={(node) => { if (node) node.indeterminate = selectedCount > 0 && !allVisibleSelected; }}
              onChange={(event) => setSelectedIds(event.target.checked ? new Set(visible.map((summary) => summary.schedule.id)) : new Set())}
              className="h-4 w-4 shrink-0 accent-[var(--sat-staff-accent,#0071e3)]"
            />
            Select all
          </label>
          <p role="status" aria-live="polite" className="text-[14px] font-medium tabular-nums text-[var(--sat-staff-text-secondary,#515154)]">
            {selectedCount} selected
          </p>
          <span className="ml-auto flex flex-wrap items-center gap-2">
            <SatButton variant="quiet" onClick={() => setSelectedIds(new Set())} disabled={selectedCount === 0}>Clear</SatButton>
            <SatButton variant="danger" onClick={() => setConfirmEndOpen(true)} disabled={selectedCount === 0} pending={endPending}>
              End exam
            </SatButton>
          </span>
        </div>
      ) : null}

      {bulkNotice ? (
        <div
          role={bulkNotice.tone === 'error' ? 'alert' : 'status'}
          className="mt-3 flex items-start gap-3 rounded-[var(--sat-staff-radius-card,14px)] border border-[var(--sat-staff-border-hairline,rgba(0,0,0,0.06))] bg-[var(--sat-staff-surface,#fff)] px-4 py-3"
        >
          <p className={'min-w-0 flex-1 text-[14px] leading-5 ' + (bulkNotice.tone === 'error' ? 'text-[var(--sat-staff-danger,#b42318)]' : 'text-[var(--sat-staff-text-primary,#1d1d1f)]')}>
            {bulkNotice.text}
          </p>
          <button
            type="button"
            onClick={() => setBulkNotice(null)}
            aria-label="Dismiss room result"
            className="sat-press flex h-8 w-8 shrink-0 -my-1 items-center justify-center rounded-full text-[var(--sat-staff-text-tertiary,#6e6e73)] hover:text-[var(--sat-staff-text-primary,#1d1d1f)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-au-accent/40"
          >
            <X size={14} aria-hidden="true" />
          </button>
        </div>
      ) : null}

      {loadError ? (
        <SatInlineError title="Rooms could not load" description={loadError} onRetry={() => void summariesQuery.refetch()} />
      ) : summariesQuery.isLoading ? (
        <SatListSkeleton rows={5} label="Loading rooms" />
      ) : visible.length ? (
        <>
        <SatResultCount total={counts[bucket]} visible={visible.length} itemLabel={visible.length === 1 ? 'room' : 'rooms'} />
        <SatList>
          <SatListColumns
            gridClassName={selectMode ? SELECT_ROW_GRID : ROW_GRID}
            columns={selectMode
              ? [{ label: '' }, { label: 'Room' }, { label: 'Starts' }, { label: 'Students', align: 'end' }, { label: 'Exam status' }]
              : [{ label: 'Room' }, { label: 'Starts' }, { label: 'Students', align: 'end' }, { label: 'Exam status' }, { label: '' }]}
          />
          {visible.map((summary, rowIndex) => {
            const state = bucketFor(summary.schedule.status, summary.runtime.status);
            const status: SessionStatus = summary.runtime.status === 'paused'
              ? 'Paused'
              : state === 'live' ? 'Running' : state === 'finished' ? summary.schedule.status === 'cancelled' ? 'Cancelled' : 'Finished' : 'Not started';
            const pill = STATUS_TONE[status];
            const target = '/sat/sessions/' + summary.schedule.id;
            const joined = summary.studentCount ?? 0;
            const active = summary.activeCount ?? 0;
            const selected = selectMode && selectedIds.has(summary.schedule.id);
            const roomCell = (
              <span className="min-w-0">
                <span className="block truncate text-[14px] font-semibold leading-5 tracking-[-0.01em] text-[var(--sat-staff-text-primary,#1d1d1f)]">{summary.schedule.cohortName}</span>
                <span className="block truncate text-[14px] leading-5 text-[var(--sat-staff-text-secondary,#515154)]">{summary.schedule.examTitle} · {satPublishScopeCopy(summary.schedule.publishScope ?? 'full')}{summary.schedule.institution ? ' · ' + summary.schedule.institution : ''}</span>
                <span className="block truncate text-[14px] leading-5 tabular-nums text-[var(--sat-staff-text-secondary,#515154)] md:hidden">{formatSessionTime(summary.schedule.startTime)} · {joined} joined</span>
              </span>
            );
            if (selectMode) {
              // Selecting ends the exam, so the whole row is the toggle and the
              // chevron is gone: nothing promises a drill-in that will not happen.
              return (
                <SatListRow
                  key={summary.schedule.id}
                  index={Math.min(rowIndex, 5)}
                  rowId={summary.schedule.id}
                  current={false}
                  ariaLabel={`${selected ? 'Deselect' : 'Select'} ${summary.schedule.cohortName}`}
                  pressed={selected}
                  onOpen={() => toggleRowSelection(summary.schedule.id)}
                >
                  <span className={'grid w-full items-center py-3 ' + SELECT_ROW_GRID}>
                    <span
                      aria-hidden="true"
                      className={'flex h-[18px] w-[18px] items-center justify-center rounded-[5px] border ' + (selected
                        ? 'border-[var(--sat-staff-accent,#0071e3)] bg-[var(--sat-staff-accent,#0071e3)] text-white'
                        : 'border-[var(--sat-staff-border-control,rgba(0,0,0,0.42))] bg-[var(--sat-staff-surface,#fff)]')}
                    >
                      {selected ? <Check size={12} strokeWidth={3} /> : null}
                    </span>
                    {roomCell}
                    <span className="hidden truncate text-[14px] leading-5 tabular-nums text-[var(--sat-staff-text-secondary,#515154)] md:block">{formatSessionTime(summary.schedule.startTime)}</span>
                    <span className="hidden text-right text-[14px] leading-5 tabular-nums text-[var(--sat-staff-text-secondary,#515154)] md:block">
                      <span className="block text-[var(--sat-staff-text-primary,#1d1d1f)]">{joined} joined</span>
                      {state === 'live' ? <span className="block">{active} active</span> : null}
                    </span>
                    <span className={SELECT_STATUS_STACK}><SatStatusPill tone={pill.tone} pulse={pill.pulse}>{status}</SatStatusPill></span>
                  </span>
                </SatListRow>
              );
            }
            return (
              <SatListRow
                key={summary.schedule.id}
                index={Math.min(rowIndex, 5)}
                rowId={summary.schedule.id}
                current={summary.schedule.id === lastOpenedId}
                onOpen={() => openRecord(summary.schedule.id, target)}
              >
                <span className={'grid w-full items-center py-3 ' + ROW_GRID}>
                  {roomCell}
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
          action={search.trim()
            ? <SatButton variant="secondary" onClick={() => setParams({ q: '' })}>Clear search</SatButton>
            : examFilter ? <SatButton variant="secondary" onClick={() => setParams({ exam: '' })}>Show all exams</SatButton> : undefined}
        />
        </>
      )}

      <SatConfirmDialog
        open={confirmEndOpen}
        title={`End exam in ${selectedCount} room${selectedCount === 1 ? '' : 's'}?`}
        description="Selected rooms stop now and every student in them moves to the post-exam phase. This cannot be undone."
        confirmLabel={`End ${selectedCount} exam${selectedCount === 1 ? '' : 's'}`}
        destructive
        onCancel={() => setConfirmEndOpen(false)}
        onConfirm={() => { void endSelectedExams(); }}
      />

      {createOpen ? (
        <SatNewSessionFlow
          exams={(examsQuery.data?.entities ?? []).filter((exam) => exam.providerKey === 'sat' && exam.status !== 'archived')}
          examsLoading={examsQuery.isLoading}
          onClose={() => setCreateOpen(false)}
          onGoToExamLibrary={() => navigate('/sat/exams')}
          onFixIssue={(examId, issue) => {
            const target = satIssueRoute(examId, issue);
            if (!target) return;
            setCreateOpen(false);
            if (target.needsDraft) requestAuthoringDraftOnEntry(examId);
            navigate(target.path);
          }}
          onCreated={(scheduleId) => {
            void queryClient.invalidateQueries({ queryKey: proctorKeys.sessions('sat') });
            setCreateOpen(false);
            navigate('/sat/sessions/' + encodeURIComponent(scheduleId), { state: { satCreatedRoom: scheduleId } });
          }}
        />
      ) : null}
    </SatContainer>
  );
}
