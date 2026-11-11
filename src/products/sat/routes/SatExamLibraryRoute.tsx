import { useEffect, useId, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import { Archive, ArrowDown, ArrowRight, ArrowUp, BookOpen, ChevronsUpDown, DoorOpen, FileText, Layers, Pencil, Plus, SearchX, Trash2 } from 'lucide-react';
import { SatButton, SatInlineError } from '../ui/SatPage';
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
  SatPageHeader,
  SatResultCount,
  SatSearchField,
  SatStatusPill,
  SatToolbarSelect,
  type SatStatusTone,
} from '../ui/SatPage';

type LibrarySort = 'updated' | 'title';
type ExamType = 'classroom' | 'practice';

const EXAM_TYPE_LABEL: Record<ExamType, string> = { classroom: 'Classroom', practice: 'Practice' };
// Custom-module exams run in Classroom rooms only; the full adaptive test is the Practice exam.
const examTypeOf = (exam: ExamEntity): ExamType => (exam.satCustomModules ? 'classroom' : 'practice');

// The last type tab is a per-browser preference, keyed by viewer so people
// sharing a browser keep their own. Blocked storage falls back to Classroom.
const examTypeKey = (userId: string | undefined) => `sat-exam-library-type:${userId ?? 'anonymous'}`;
function readExamType(key: string): ExamType {
  try {
    return window.localStorage.getItem(key) === 'practice' ? 'practice' : 'classroom';
  } catch {
    return 'classroom';
  }
}
function writeExamType(key: string, type: ExamType): void {
  try {
    window.localStorage.setItem(key, type);
  } catch {
    // Storage unavailable: the choice lasts for this visit only.
  }
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return '—';
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(time));
}

const TAB_NOUN: Record<SatLibraryTab, string> = { active: 'active', drafts: 'unused', published: 'room-ready', archived: 'archived' };

const GROUP_HEADING: Record<SatLibraryTab, string> = {
  active: 'All active',
  drafts: 'Not in a room',
  published: 'Rooms available',
  archived: 'Archived',
};

const LIBRARY_GROUPS: ReadonlyArray<{ value: SatLibraryTab; label: string; Icon: typeof Layers }> = [
  { value: 'active', label: GROUP_HEADING.active, Icon: Layers },
  { value: 'drafts', label: GROUP_HEADING.drafts, Icon: Pencil },
  { value: 'published', label: GROUP_HEADING.published, Icon: DoorOpen },
  { value: 'archived', label: GROUP_HEADING.archived, Icon: Archive },
];

/**
 * Finder-style library rail: the four real status groups with live counts.
 * Radiogroup semantics (roving tabindex + arrow keys) so the status filter
 * keeps its accessible contract; the rail only changes the presentation from
 * a horizontal strip to a sidebar once the LIBRARY container (not the
 * viewport: the SatRoot sidebar already takes 244px from md up) is wide
 * enough for a rail plus a usable list.
 */
function LibraryRail({
  tab,
  counts,
  onChange,
}: {
  tab: SatLibraryTab;
  counts: Record<SatLibraryTab, number>;
  onChange: (next: SatLibraryTab) => void;
}) {
  const optionsRef = useRef<Array<HTMLButtonElement | null>>([]);
  const move = (from: number, delta: number) => {
    const next = (from + delta + LIBRARY_GROUPS.length) % LIBRARY_GROUPS.length;
    const option = LIBRARY_GROUPS[next];
    if (!option) return;
    onChange(option.value);
    optionsRef.current[next]?.focus();
  };
  return (
    <nav
      aria-label="Library"
      className="shrink-0 rounded-[var(--sat-staff-radius-card,16px)] border border-[var(--sat-staff-border-hairline,rgba(0,0,0,0.06))] bg-[var(--sat-staff-surface,#fff)] p-1.5 shadow-[var(--sat-staff-shadow-card-soft,0_1px_2px_rgba(0,0,0,0.04))] @min-[1080px]/library:sticky @min-[1080px]/library:top-4 @min-[1080px]/library:w-60"
    >
      <p aria-hidden="true" className="hidden px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--sat-staff-text-tertiary,#6e6e73)] @min-[1080px]/library:block">
        Library
      </p>
      {/* eslint-disable-next-line jsx-a11y/interactive-supports-focus -- APG radiogroup: focus lives on the roving-tabindex radio children, never the group itself. */}
      <div
        role="radiogroup"
        aria-label="Exam status"
        className="flex flex-row gap-1 overflow-x-auto @min-[1080px]/library:flex-col @min-[1080px]/library:overflow-visible"
        onKeyDown={(event) => {
          const index = LIBRARY_GROUPS.findIndex((option) => option.value === tab);
          if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
            event.preventDefault();
            move(index, 1);
          } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
            event.preventDefault();
            move(index, -1);
          } else if (event.key === 'Home' || event.key === 'End') {
            event.preventDefault();
            const next = event.key === 'Home' ? 0 : LIBRARY_GROUPS.length - 1;
            const option = LIBRARY_GROUPS[next];
            if (option) {
              onChange(option.value);
              optionsRef.current[next]?.focus();
            }
          }
        }}
      >
        {LIBRARY_GROUPS.map((group, index) => {
          const selected = group.value === tab;
          const Icon = group.Icon;
          return (
            <button
              key={group.value}
              ref={(node) => {
                optionsRef.current[index] = node;
              }}
              type="button"
              role="radio"
              aria-checked={selected}
              tabIndex={selected ? 0 : -1}
              aria-label={`${group.label} ${counts[group.value]}`}
              onClick={() => onChange(group.value)}
              className={clsx(
                'flex min-h-11 shrink-0 items-center gap-2.5 rounded-[10px] px-3 text-[14px] leading-5 outline-none transition-colors @min-[1080px]/library:w-full',
                selected
                  ? 'bg-[var(--sat-staff-accent-tint,rgba(0,113,227,0.08))] font-semibold text-[var(--sat-staff-text-primary,#1d1d1f)]'
                  : 'font-medium text-[var(--sat-staff-text-secondary,#515154)] hover:bg-[var(--sat-staff-fill-chip,rgba(0,0,0,0.04))] hover:text-[var(--sat-staff-text-primary,#1d1d1f)]',
              )}
            >
              <Icon
                size={16}
                aria-hidden="true"
                className={clsx('shrink-0', selected ? 'text-[var(--sat-staff-accent-text-on-tint,#0067c9)]' : 'text-[var(--sat-staff-text-tertiary,#6e6e73)]')}
              />
              <span className="whitespace-nowrap">{group.label}</span>
              <span
                className={clsx(
                  'ml-auto rounded-full px-2 py-0.5 text-[12px] font-semibold tabular-nums',
                  selected
                    ? 'bg-[var(--sat-staff-surface-solid-fallback,#fff)] text-[var(--sat-staff-text-secondary,#515154)]'
                    : 'bg-[var(--sat-staff-fill-chip,rgba(0,0,0,0.04))] text-[var(--sat-staff-text-tertiary,#6e6e73)]',
                )}
              >
                {counts[group.value]}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

/**
 * Column header that drives the existing list sort (no new sort modes).
 * Name sorts A–Z, Updated sorts newest first — the same two values the
 * toolbar select writes to the URL.
 */
function SortHeaderButton({
  label,
  active,
  direction,
  onSelect,
}: {
  label: string;
  active: boolean;
  direction: 'asc' | 'desc';
  onSelect: () => void;
}) {
  const Icon = active ? (direction === 'asc' ? ArrowUp : ArrowDown) : ChevronsUpDown;
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={active}
      aria-label={`Sort by ${label.toLowerCase()}${active ? ' (currently sorted)' : ''}`}
      className={clsx(
        'inline-flex min-h-11 items-center gap-1 rounded-[6px] px-1 text-[14px] font-semibold leading-5',
        active
          ? 'text-[var(--sat-staff-text-primary,#1d1d1f)]'
          : 'text-[var(--sat-staff-text-secondary,#515154)] hover:text-[var(--sat-staff-text-primary,#1d1d1f)]',
      )}
    >
      {label}
      <Icon size={14} aria-hidden="true" className={active ? undefined : 'opacity-60'} />
    </button>
  );
}

/**
 * One grid for the column labels and every row, so Select / file / Exam /
 * Status / Updated align. The trailing column is wide enough for a published
 * exam's explicit Edit control AND the chevron, and it is reserved on every
 * row (and in the header) so a row with a control never shifts its
 * neighbours' columns. The detailed columns key off the LIST container's own
 * width (not the viewport: the SatRoot sidebar and the rail already take
 * their share before the list measures); below ~820px of list the row
 * stacks: checkbox + file chip | title over status | chevron.
 */
const ROW_GRID = 'grid-cols-[24px_32px_minmax(0,1fr)_auto] gap-x-3 @min-[820px]/list:grid-cols-[24px_32px_minmax(0,1fr)_168px_112px_88px] @min-[820px]/list:gap-x-4';
const ROW_CELL = {
  select: 'row-span-2 @min-[820px]/list:row-span-1',
  art: 'col-start-2 row-span-2 row-start-1 flex items-start pt-0.5 @min-[820px]/list:row-span-1 @min-[820px]/list:row-start-auto @min-[820px]/list:items-center @min-[820px]/list:pt-0',
  title: 'col-start-3 min-w-0',
  status: 'col-span-2 col-start-3 row-start-2 mt-2 flex @min-[820px]/list:col-span-1 @min-[820px]/list:col-start-4 @min-[820px]/list:row-start-auto @min-[820px]/list:mt-0',
  updated: '@min-[820px]/list:col-start-5',
  chevron: 'col-start-4 row-start-1 @min-[820px]/list:col-start-6 @min-[820px]/list:row-start-auto',
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
  const { session } = useAuthSession();
  const typeKey = examTypeKey(session?.user.id);
  const [typeChoice, setTypeChoice] = useState<{ key: string; type: ExamType } | null>(null);
  const examType = typeChoice?.key === typeKey ? typeChoice.type : readExamType(typeKey);
  const setExamType = (next: ExamType) => {
    writeExamType(typeKey, next);
    setTypeChoice({ key: typeKey, type: next });
  };
  const allSatExams = useMemo(() => (query.data?.entities ?? []).filter((exam) => exam.providerKey === 'sat'), [query.data?.entities]);
  const typeCounts = useMemo(() => {
    const classroom = allSatExams.filter((exam) => examTypeOf(exam) === 'classroom').length;
    return { classroom, practice: allSatExams.length - classroom };
  }, [allSatExams]);
  const satExams = useMemo(() => allSatExams.filter((exam) => examTypeOf(exam) === examType), [allSatExams, examType]);
  const otherType: ExamType = examType === 'classroom' ? 'practice' : 'classroom';
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
    <SatContainer className="@container/library">
      <SatPageHeader
        title="Exams"
        description="Author Digital SAT practice exams and prepare rooms. Changes are saved automatically."
        actions={<SatButton variant="primary" onClick={openCreate} icon={<Plus size={16} aria-hidden="true" />}>Create exam</SatButton>}
      />

      <div className="mt-6">
        <SatSegmentedControl<ExamType>
          label="Exam type"
          value={examType}
          options={[
            { value: 'classroom', label: EXAM_TYPE_LABEL.classroom, count: typeCounts.classroom },
            { value: 'practice', label: EXAM_TYPE_LABEL.practice, count: typeCounts.practice },
          ]}
          onChange={setExamType}
        />
      </div>

      {/* The page measures room for the rail; the list measures room for columns. */}
      <div className="mt-4 flex flex-col gap-4 @min-[1080px]/library:flex-row @min-[1080px]/library:items-start">
        <LibraryRail tab={tab} counts={counts} onChange={(next) => setParams({ tab: next === 'active' ? '' : next })} />
        <div className="@container/list min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <h2 className="text-[length:var(--sat-staff-type-section-size,20px)] font-semibold leading-[var(--sat-staff-type-section-line,28px)] tracking-[-0.015em] text-[var(--sat-staff-text-primary,#1d1d1f)]">{GROUP_HEADING[tab]}</h2>
            <p className="text-[14px] font-medium leading-5 text-[var(--sat-staff-text-secondary,#515154)]">{EXAM_TYPE_LABEL[examType]} exams</p>
          </div>
          <div className="mt-3 flex min-w-0 flex-wrap items-center gap-2" role="group" aria-label="Exam list controls">
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
          </div>

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
                    <SatButton variant="quiet" onClick={() => toggleAll(false)}>Clear selection</SatButton>
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
                <div className={clsx('hidden min-h-10 items-center bg-[var(--sat-staff-fill-faint,rgba(0,0,0,0.035))] px-4 text-[14px] font-semibold leading-5 text-[var(--sat-staff-text-secondary,#515154)] @min-[820px]/list:grid', ROW_GRID)}>
                  <span />
                  <span />
                  <span><SortHeaderButton label="Name" active={sort === 'title'} direction="asc" onSelect={() => setParams({ sort: 'title' })} /></span>
                  <span className="flex min-h-11 items-center">Status</span>
                  <span className="flex min-h-11 items-center justify-end"><SortHeaderButton label="Updated" active={sort === 'updated'} direction="desc" onSelect={() => setParams({ sort: '' })} /></span>
                  <span />
                </div>
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
                        <span className={ROW_CELL.art} aria-hidden="true">
                          <span className="flex h-8 w-8 items-center justify-center rounded-[10px] border border-[var(--sat-staff-border-hairline,rgba(0,0,0,0.06))] bg-[var(--sat-staff-fill-faint,rgba(0,0,0,0.035))] text-[var(--sat-staff-text-tertiary,#6e6e73)]">
                            {hasPublishedVersion ? <DoorOpen size={16} /> : <FileText size={16} />}
                          </span>
                        </span>
                        <span className={ROW_CELL.title}>
                          <span className="block truncate text-[14px] font-semibold leading-5 tracking-[-0.01em] text-[var(--sat-staff-text-primary,#1d1d1f)]">{exam.title}</span>
                          <span className="block truncate text-[14px] leading-5 tabular-nums text-[var(--sat-staff-text-secondary,#515154)]">{examMeta(exam)}<span className="@min-[820px]/list:hidden"> · Updated {formatDate(exam.updatedAt)}</span></span>
                        </span>
                        <span className={ROW_CELL.status}><SatStatusPill tone={tone}>{status}</SatStatusPill></span>
                        <span className={clsx('hidden text-right text-[14px] leading-5 tabular-nums text-[var(--sat-staff-text-secondary,#515154)] @min-[820px]/list:block', ROW_CELL.updated)}>{formatDate(exam.updatedAt)}</span>
                        <span className={'flex items-center justify-end gap-2 ' + ROW_CELL.chevron}>
                          {hasPublishedVersion ? (
                            <a
                              href={`/sat/exams/${exam.id}`}
                              aria-label={`Edit ${exam.title}`}
                              className={`sat-btn sat-btn--secondary sat-press min-h-11 px-3 ${SAT_ROW_ACTION_CLASS}`}
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
                          <ArrowRight size={16} className={clsx('sat-row-chevron shrink-0 text-slate-400 group-hover:text-slate-500', hasPublishedVersion && 'hidden @min-[820px]/list:block')} aria-hidden="true" />
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
              hint={`No ${TAB_NOUN[tab]} ${EXAM_TYPE_LABEL[examType]} exams match “${search.trim()}”.`}
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
          ) : typeCounts[otherType] > 0 ? (
            <SatEmptyState
              icon={<BookOpen size={20} aria-hidden="true" />}
              title={`No ${EXAM_TYPE_LABEL[examType]} exams`}
              hint={examType === 'classroom'
                ? 'Exams with custom modules appear here. Full SAT exams are under Practice.'
                : 'Full SAT exams appear here. Exams with custom modules are under Classroom.'}
              action={<SatButton variant="secondary" onClick={() => setExamType(otherType)}>Show {EXAM_TYPE_LABEL[otherType]} exams</SatButton>}
            />
          ) : (
            <SatEmptyState
              icon={<BookOpen size={20} aria-hidden="true" />}
              title="No exams yet"
              hint="Create an exam. The standard Digital SAT structure — Reading & Writing and Math, with adaptive modules — is ready immediately."
              action={<SatButton variant="primary" onClick={openCreate} icon={<Plus size={16} aria-hidden="true" />}>Create exam</SatButton>}
            />
          )}
        </div>
      </div>

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
