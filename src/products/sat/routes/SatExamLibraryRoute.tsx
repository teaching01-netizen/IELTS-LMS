import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ArrowRight, BookOpen, Plus, SearchX, Trash2 } from 'lucide-react';
import { SatButton, SatInlineError, SatListColumns } from '../ui/SatPage';
import { useBulkDeleteExamsMutation, useExamListQuery } from '../../../features/exam-authoring/api/examQueries';
import { useAuthSession } from '../../../features/auth/authSession';
import { SatConfirmDialog } from '../ui/ConfirmDialog';
import { requestAuthoringDraftOnEntry } from '../../../features/exam-authoring/api/authoringEntryIntent';
import type { ExamEntity } from '../../../types/domain';
import { satPublishScopeCopy } from '../../../features/exam-authoring/ui/release/releaseSelectors';
import { CreateSatExamSheet } from '../../../features/exam-authoring/ui/create-exam/CreateSatExamSheet';
import { SatSegmentedControl } from '../ui/SegmentedControl';
import { useSatListParams, type SatLibraryTab } from '../ui/useSatListParams';
import { useSatListReturn } from '../ui/useSatListReturn';
import {
  SAT_ROW_ACTION_CLASS,
  SAT_ROW_PRIMARY_LINK_CLASS,
  SatContainer,
  SatEmptyState,
  SatList,
  SatListRowShell,
  SatListSkeleton,
  SatListToolbar,
  SatPageHeader,
  SatResultCount,
  SatSearchField,
  SatStatusPill,
  SatToolbarSelect,
  type SatStatusTone,
} from '../ui/SatPage';

type LibrarySort = 'updated' | 'title';

function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return '—';
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(time));
}

const TAB_NOUN: Record<SatLibraryTab, string> = { active: 'active', drafts: 'unused', published: 'room-ready', archived: 'archived' };

/**
 * One grid for the column labels and every row, so Select / Exam / Status /
 * Updated align. The trailing column is wide enough for a published exam's
 * explicit Edit control AND the chevron, and it is reserved on every row (and
 * in the header) so a row with a control never shifts its neighbours' columns.
 * Below md the row stacks: checkbox | title over status | chevron.
 */
const ROW_GRID = 'grid-cols-[24px_minmax(0,1fr)_16px] gap-x-3 md:grid-cols-[24px_minmax(0,1fr)_224px_120px_140px] md:gap-x-4';
const ROW_CELL = {
  select: 'row-span-2 md:row-span-1',
  title: 'col-start-2 min-w-0',
  status: 'col-start-2 row-start-2 mt-2 flex md:col-start-auto md:row-start-auto md:mt-0',
  chevron: 'col-start-3 row-span-2 row-start-1 md:col-start-auto md:row-span-1 md:row-start-auto',
} as const;
const CHECKBOX_CLASS = 'h-4 w-4 cursor-pointer accent-[var(--sat-staff-accent,#0071e3)] disabled:cursor-not-allowed disabled:opacity-40';

function examMeta(exam: ExamEntity): string {
  const parts: string[] = [];
  // The list payload omits question counts; never print a misleading "0 questions".
  if (exam.totalQuestions) parts.push(`${exam.totalQuestions} ${exam.totalQuestions === 1 ? 'question' : 'questions'}`);
  parts.push(exam.currentPublishedVersionId ? satPublishScopeCopy(exam.currentPublishedScope ?? 'full') : exam.satSectionScope && exam.satSectionScope !== 'full' ? satPublishScopeCopy(exam.satSectionScope) : 'Not in a room yet');
  return parts.join(' · ');
}

const plural = (n: number) => `${n} ${n === 1 ? 'exam' : 'exams'}`;

function libraryTabMatches(tab: SatLibraryTab, exam: ExamEntity): boolean {
  if (tab === 'archived') return exam.status === 'archived';
  if (exam.status === 'archived') return false;
  if (tab === 'published') return exam.status === 'published';
  if (tab === 'drafts') return exam.status !== 'published';
  return true;
}

function statusTone(exam: ExamEntity): SatStatusTone {
  if (exam.status === 'published') return 'published';
  if (exam.status === 'archived') return 'archived';
  if (exam.currentPublishedVersionId) return 'changes';
  return 'draft';
}

function statusLabel(exam: ExamEntity): string {
  const tone = statusTone(exam);
  // Staff never publish: "available" means a room has captured a saved version.
  if (tone === 'published') return 'Rooms available';
  if (tone === 'archived') return 'Archived';
  return 'Editing';
}

export function SatExamLibraryRoute() {
  const query = useExamListQuery(true, 'sat', false);
  const { params, setParams } = useSatListParams();
  const search = params.q ?? '';
  const tab: SatLibraryTab = params.tab ?? 'active';
  const sort: LibrarySort = params.sort === 'title' ? 'title' : 'updated';
  const [createOpen, setCreateOpen] = useState(false);
  const satExams = useMemo(() => (query.data?.entities ?? []).filter((exam) => exam.providerKey === 'sat'), [query.data?.entities]);
  const counts = useMemo(() => {
    const active = satExams.filter((exam) => exam.status !== 'archived');
    const published = active.filter((exam) => exam.status === 'published').length;
    return { active: active.length, drafts: active.length - published, published, archived: satExams.length - active.length };
  }, [satExams]);
  const exams = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    const timeOf = (value: string | null | undefined): number => {
      if (!value) return Number.NEGATIVE_INFINITY;
      const time = new Date(value).getTime();
      return Number.isNaN(time) ? Number.NEGATIVE_INFINITY : time;
    };
    return satExams
      .filter((exam) => libraryTabMatches(tab, exam))
      .filter((exam) => !needle || exam.title.toLocaleLowerCase().includes(needle))
      .sort((left, right) => sort === 'title'
        ? left.title.localeCompare(right.title, undefined, { sensitivity: 'base', numeric: true })
        : timeOf(right.updatedAt) - timeOf(left.updatedAt));
  }, [satExams, search, sort, tab]);
  const { lastOpenedId, openRecord } = useSatListReturn(!query.isLoading);
  const setSearch = (value: string) => setParams({ q: value });

  const { session } = useAuthSession();
  const bulkDelete = useBulkDeleteExamsMutation();
  const [picked, setPicked] = useState<ReadonlySet<string>>(() => new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const selectAllRef = useRef<HTMLInputElement>(null);
  const checkboxId = useId();
  // Selection only ever counts rows the user can see, so a filter change can
  // never send a hidden exam to the delete call.
  const selectedExams = useMemo(() => exams.filter((exam) => picked.has(exam.id)), [exams, picked]);
  const selectedIds = selectedExams.map((exam) => exam.id);
  const allSelected = exams.length > 0 && selectedIds.length === exams.length;
  // The delete is permanent and takes an exam's rooms, attempts and results with it.
  const withRooms = selectedExams.filter((exam) => exam.currentPublishedVersionId).length;
  const deleteWarning = [
    `${selectedIds.length === 1 ? 'This exam' : `These ${selectedIds.length} exams`} will be permanently deleted.`,
    withRooms
      ? `${withRooms === selectedIds.length ? (withRooms === 1 ? 'Its' : 'Their') : `${withRooms} of them ${withRooms === 1 ? 'has' : 'have'} rooms. Those`} rooms, student attempts and results will be deleted too.`
      : '',
    "This can't be undone.",
  ].filter(Boolean).join(' ');
  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = selectedIds.length > 0 && !allSelected;
  }, [selectedIds.length, allSelected]);

  const toggle = (id: string, on: boolean) => {
    setNotice(null);
    setPicked((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  };
  const toggleAll = (on: boolean) => {
    setNotice(null);
    setPicked(on ? new Set(exams.map((exam) => exam.id)) : new Set());
  };
  const runDelete = async () => {
    setConfirmOpen(false);
    const examIds = selectedIds;
    try {
      const result = await bulkDelete.mutateAsync({ examIds, actor: session?.user.id ?? 'Staff' });
      const failed = result.results.filter((item) => !item.success);
      setPicked(new Set(failed.map((item) => item.examId)));
      setNotice(failed.length === 0
        ? { tone: 'ok', text: `Deleted ${plural(result.succeeded)}.` }
        : {
            tone: 'error',
            text: `Deleted ${result.succeeded} of ${plural(result.total)}. Couldn't delete ${failed.map((item) => `“${item.examTitle}” (${item.error ?? 'unknown error'})`).join(', ')}.`,
          });
    } catch (error) {
      setNotice({ tone: 'error', text: error instanceof Error ? error.message : 'The exams could not be deleted. Try again.' });
    }
  };

  const openCreate = () => setCreateOpen(true);

  const loadError = query.error ? (query.error instanceof Error ? query.error.message : 'The exam library is unavailable.') : null;

  return (
    <SatContainer>
      <SatPageHeader
        title="Exams"
        description="Author Digital SAT practice exams and prepare rooms. Changes are saved automatically."
        actions={<SatButton variant="primary" onClick={openCreate} icon={<Plus size={16} aria-hidden="true" />}>Create exam</SatButton>}
      />

      <SatListToolbar
        label="Exam list controls"
        tabs={
          <SatSegmentedControl<SatLibraryTab>
            label="Exam status"
            value={tab}
            options={[
              { value: 'active', label: 'All active', count: counts.active },
              { value: 'drafts', label: 'Not in a room', count: counts.drafts },
              { value: 'published', label: 'Rooms available', count: counts.published },
              { value: 'archived', label: 'Archived', count: counts.archived },
            ]}
            onChange={(next) => setParams({ tab: next === 'active' ? '' : next })}
            className="sm:w-auto"
          />
        }
      >
        <SatSearchField
          id="sat-exam-search"
          label="Search exams"
          value={search}
          onChange={setSearch}
          placeholder="Search exams"
          widthClassName="w-full sm:w-72 sm:flex-none"
        />
        <SatToolbarSelect<LibrarySort>
          id="sat-exam-sort"
          label="Sort"
          value={sort}
          options={[
            { value: 'updated', label: 'Last updated' },
            { value: 'title', label: 'Title A–Z' },
          ]}
          onChange={(next) => setParams({ sort: next === 'updated' ? '' : next })}
        />
      </SatListToolbar>

      {loadError ? (
        <SatInlineError title="Exams could not load" description={loadError} onRetry={() => void query.refetch()} />
      ) : query.isLoading ? (
        <SatListSkeleton rows={5} label="Loading exams" />
      ) : exams.length ? (
        <>
        <div className="mt-3 flex min-h-10 flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <div className="flex items-center gap-3">
            {exams.length ? (
              <label htmlFor={`${checkboxId}-all`} className="-my-2 flex cursor-pointer items-center gap-2 py-2 pl-4 text-[14px] font-medium text-[var(--sat-staff-text-secondary,#515154)]">
                <input
                  id={`${checkboxId}-all`}
                  ref={selectAllRef}
                  type="checkbox"
                  className={CHECKBOX_CLASS}
                  checked={allSelected}
                  onChange={(event) => toggleAll(event.target.checked)}
                  aria-label={allSelected ? 'Clear selection' : `Select all ${plural(exams.length)}`}
                />
              </label>
            ) : null}
            {selectedIds.length ? (
              <p role="status" aria-live="polite" className="text-[14px] font-semibold tabular-nums text-[var(--sat-staff-text-primary,#1d1d1f)]">
                {selectedIds.length} selected
              </p>
            ) : (
              <span className="[&>p]:mt-0"><SatResultCount total={counts[tab]} visible={exams.length} itemLabel={exams.length === 1 ? 'exam' : 'exams'} /></span>
            )}
          </div>
          {selectedIds.length ? (
            <div className="flex items-center gap-2">
              <SatButton variant="quiet" onClick={() => toggleAll(false)}>Clear</SatButton>
              <SatButton
                variant="danger-secondary"
                icon={<Trash2 size={16} aria-hidden="true" />}
                pending={bulkDelete.isPending}
                onClick={() => setConfirmOpen(true)}
              >
                Delete {plural(selectedIds.length)}
              </SatButton>
            </div>
          ) : null}
        </div>
        {notice ? (
          <p
            role={notice.tone === 'error' ? 'alert' : 'status'}
            className={'mt-2 rounded-[10px] px-3 py-2 text-[14px] leading-5 ' + (notice.tone === 'error'
              ? 'bg-[var(--sat-staff-danger-tint,rgba(215,0,21,0.08))] text-[var(--sat-staff-danger,#d70015)]'
              : 'bg-[var(--sat-staff-success-tint,rgba(36,138,61,0.1))] text-[var(--sat-staff-success-text,#248a3d)]')}
          >
            {notice.text}
          </p>
        ) : null}
        <SatList>
          <SatListColumns gridClassName={ROW_GRID} columns={[{ label: '' }, { label: 'Exam' }, { label: 'Status' }, { label: 'Updated', align: 'end' }, { label: '' }]} />
          {exams.map((exam, rowIndex) => {
            const status = statusLabel(exam);
            const tone = statusTone(exam);
            // A published exam's job in this list is running the exam, not
            // editing it: opening the row reaches Rooms WITHOUT arming a draft
            // intent (publishing seals the draft). Editing stays available as
            // its own explicit control beside the row link.
            const hasPublishedVersion = Boolean(exam.currentPublishedVersionId);
            const primaryPath = hasPublishedVersion
              ? `/sat/exams/${exam.id}/access`
              : `/sat/exams/${exam.id}`;
            const openPrimary = () => {
              // A published exam has no editable draft, so the edit gesture is
              // what lets its workspace continue from the published version
              // instead of stopping at "No editable draft". The shell READ stays
              // a read: nothing here fires on a reload.
              if (!hasPublishedVersion) requestAuthoringDraftOnEntry(exam.id);
              openRecord(exam.id, primaryPath);
            };
            return (
              <SatListRowShell
                key={exam.id}
                index={Math.min(rowIndex, 5)}
                rowId={exam.id}
                current={exam.id === lastOpenedId}
                primary={
                  <a
                    href={primaryPath}
                    aria-label={
                      hasPublishedVersion
                        ? `Open rooms for ${exam.title}`
                        : `Edit ${exam.title}`
                    }
                    className={SAT_ROW_PRIMARY_LINK_CLASS}
                    onClick={(event) => {
                      // Modified clicks keep their native behavior (new tab).
                      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                      event.preventDefault();
                      openPrimary();
                    }}
                  />
                }
              >
                <span className={'grid w-full items-center py-3 ' + ROW_GRID}>
                  <span className={ROW_CELL.select + ' flex items-center'}>
                    <label
                      htmlFor={`${checkboxId}-${exam.id}`}
                      className={`-m-3 flex p-3 ${SAT_ROW_ACTION_CLASS}`}
                    >
                      <input
                        id={`${checkboxId}-${exam.id}`}
                        type="checkbox"
                        className={CHECKBOX_CLASS}
                        checked={picked.has(exam.id)}
                        disabled={bulkDelete.isPending}
                        onChange={(event) => toggle(exam.id, event.target.checked)}
                        aria-label={`Select ${exam.title}`}
                      />
                    </label>
                  </span>
                  <span className={ROW_CELL.title}>
                    <span className="block truncate text-[14px] font-semibold leading-5 tracking-[-0.01em] text-[var(--sat-staff-text-primary,#1d1d1f)]">{exam.title}</span>
                    <span className="block truncate text-[14px] leading-5 tabular-nums text-[var(--sat-staff-text-secondary,#515154)]">{examMeta(exam)}<span className="md:hidden"> · Updated {formatDate(exam.updatedAt)}</span></span>
                  </span>
                  <span className={ROW_CELL.status}><SatStatusPill tone={tone}>{status}</SatStatusPill></span>
                  <span className="hidden text-right text-[14px] leading-5 tabular-nums text-[var(--sat-staff-text-secondary,#515154)] md:block">{formatDate(exam.updatedAt)}</span>
                  <span className={'flex items-center justify-end gap-2 ' + ROW_CELL.chevron}>
                    {hasPublishedVersion ? (
                      <a
                        href={`/sat/exams/${exam.id}`}
                        aria-label={`Edit ${exam.title}`}
                        className={`sat-btn sat-btn--secondary sat-press hidden min-h-9 px-3 md:inline-flex ${SAT_ROW_ACTION_CLASS}`}
                        onClick={(event) => {
                          if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                          event.preventDefault();
                          requestAuthoringDraftOnEntry(exam.id);
                          openRecord(exam.id, `/sat/exams/${exam.id}`);
                        }}
                      >
                        Edit
                      </a>
                    ) : null}
                    <ArrowRight size={16} className="sat-row-chevron shrink-0 text-slate-400 group-hover:text-slate-500" aria-hidden="true" />
                  </span>
                </span>
              </SatListRowShell>
            );
          })}
        </SatList>
        </>
      ) : search.trim() ? (
        <SatEmptyState
          icon={<SearchX size={20} aria-hidden="true" />}
          title="No matching exams"
          hint={`No ${TAB_NOUN[tab]} exams match “${search.trim()}”.`}
          action={<SatButton variant="secondary" onClick={() => setSearch('')}>Clear search</SatButton>}
        />
      ) : tab === 'archived' ? (
        <SatEmptyState
          icon={<BookOpen size={20} aria-hidden="true" />}
          title="No archived exams"
          hint="Archived exams appear here and stay available for reference."
          action={<SatButton variant="secondary" onClick={() => setParams({ tab: '' })}>Show active exams</SatButton>}
        />
      ) : tab !== 'active' ? (
        <SatEmptyState
          icon={<BookOpen size={20} aria-hidden="true" />}
          title={`No ${TAB_NOUN[tab]} exams`}
          hint="Exams move between these groups as rooms are created from them."
          action={<SatButton variant="secondary" onClick={() => setParams({ tab: '' })}>Show all active</SatButton>}
        />
      ) : counts.archived > 0 ? (
        <SatEmptyState
          icon={<BookOpen size={20} aria-hidden="true" />}
          title="No active exams"
          hint={`${counts.archived} archived ${counts.archived === 1 ? 'exam is' : 'exams are'} in the Archived tab. Create a new exam or open an archived one.`}
          action={<SatButton variant="secondary" onClick={() => setParams({ tab: 'archived' })}>Show archived</SatButton>}
        />
      ) : (
        <SatEmptyState
          icon={<BookOpen size={20} aria-hidden="true" />}
          title="No exams yet"
          hint="Create an exam. The standard Digital SAT structure — Reading & Writing and Math, with adaptive modules — is ready immediately."
          action={<SatButton variant="primary" onClick={openCreate} icon={<Plus size={16} aria-hidden="true" />}>Create exam</SatButton>}
        />
      )}

      <CreateSatExamSheet open={createOpen} onClose={() => setCreateOpen(false)} />
      <SatConfirmDialog
        open={confirmOpen}
        destructive
        title={`Delete ${plural(selectedIds.length)}?`}
        description={deleteWarning}
        confirmLabel="Delete"
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => void runDelete()}
      />
    </SatContainer>
  );
}
