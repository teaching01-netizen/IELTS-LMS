import { useEffect, useId, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode, type RefObject } from 'react';
import clsx from 'clsx';
import {
  ArrowRight,
  BookOpen,
  ChevronRight,
  DoorOpen,
  FileText,
  MoreHorizontal,
  Plus,
  SearchX,
  Trash2,
} from 'lucide-react';
import {
  SAT_ROW_ACTION_CLASS,
  SAT_ROW_PRIMARY_LINK_CLASS,
  SatButton,
  SatContainer,
  SatEmptyState,
  SatInlineError,
  SatListRowShell,
  SatListSkeleton,
  SatSearchField,
  SatStatusPill,
  SatToolbarSelect,
  type SatStatusTone,
} from '../ui/SatPage';
import { useBulkDeleteExamsMutation, useExamListQuery } from '../../../features/exam-authoring/api/examQueries';
import { useAuthSession } from '../../../features/auth/authSession';
import { SatConfirmDialog } from '../ui/ConfirmDialog';
import { SatMenu, type SatMenuItem } from '../ui/Menu';
import { requestAuthoringDraftOnEntry } from '../../../features/exam-authoring/api/authoringEntryIntent';
import type { ExamEntity } from '../../../types/domain';
import { CreateSatExamSheet } from '../../../features/exam-authoring/ui/create-exam/CreateSatExamSheet';
import { useSatListParams } from '../ui/useSatListParams';
import { useSatListReturn } from '../ui/useSatListReturn';
import {
  useSatLibraryQuery,
  useCreateFolderMutation,
  useRenameFolderMutation,
  useMoveFolderMutation,
  useDeleteFolderMutation,
  useMoveExamsMutation,
} from '../library/queries';
import { ancestorsOf, childrenOf, descendantIds, folderIdOf, type LibraryFolder } from '../library/types';
import {
  ExamMoveDialog,
  FolderCreateDialog,
  FolderDeleteDialog,
  FolderMoveDialog,
  FolderRenameDialog,
} from '../library/FolderDialogs';
import {
  ExamDragHandle,
  FolderDragHandle,
  LibraryDragProvider,
  LibraryDroppable,
  folderFromDropTarget,
} from '../library/LibraryDnD';
import { LibraryContextMenu } from '../library/LibraryContextMenu';

type LibrarySort = 'updated' | 'title';

const CHECKBOX_CLASS = 'h-4 w-4 cursor-pointer accent-[var(--sat-staff-accent,#0071e3)] disabled:cursor-not-allowed disabled:opacity-40';
// Four columns on phones (checkbox, art, title, actions) with the meta and
// location on their own full-width lines. At a content width that can hold the
// date column, the row returns to one line per exam.
const EXAM_GRID =
  'grid-cols-[24px_44px_minmax(0,1fr)_44px] gap-x-2 @min-[720px]/list:grid-cols-[24px_44px_minmax(0,1fr)_112px_84px] @min-[720px]/list:gap-x-4';
// Folder rows have no selection checkbox; on phones the art starts the row so
// the name keeps a readable measure.
const FOLDER_GRID =
  'grid-cols-[44px_minmax(0,1fr)_84px] gap-x-2 @min-[720px]/list:grid-cols-[24px_44px_minmax(0,1fr)_112px_84px] @min-[720px]/list:gap-x-4';
const UPDATED_CELL =
  'hidden self-center text-right text-[13px] leading-5 tabular-nums text-[var(--sat-staff-text-secondary,#515154)] @min-[720px]/list:block';

const plural = (count: number): string => `${count} ${count === 1 ? 'exam' : 'exams'}`;

function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return '—';
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(time));
}

/** The creation taxonomy is metadata: it never filters or hides a row. */
function examTypeLabel(exam: ExamEntity): string {
  return exam.satCustomModules ? 'Custom modules' : 'Full SAT';
}

function statusTone(exam: ExamEntity): SatStatusTone {
  if (exam.status === 'published') return 'published';
  if (exam.status === 'archived') return 'archived';
  if (exam.currentPublishedVersionId) return 'changes';
  return 'draft';
}

function statusLabel(exam: ExamEntity): string {
  const tone = statusTone(exam);
  if (tone === 'published') return 'Rooms available';
  if (tone === 'archived') return 'Archived';
  return 'Editing';
}

function folderHref(id: string): string {
  return `/sat/exams?folder=${encodeURIComponent(id)}`;
}

/** Root is named Exams; a folder result names its parent path, never the whole library. */
function folderPath(folders: LibraryFolder[], folderId: string | null): string {
  if (!folderId) return 'Exams';
  const chain = ancestorsOf(folders, folderId);
  return chain.length > 0 ? chain.map((folder) => folder.name).join(' / ') : 'Exams';
}

function sortExams<T extends ExamEntity>(exams: T[], sort: LibrarySort): T[] {
  const timeOf = (value: string | null | undefined): number => {
    if (!value) return Number.NEGATIVE_INFINITY;
    const time = new Date(value).getTime();
    return Number.isNaN(time) ? Number.NEGATIVE_INFINITY : time;
  };
  return [...exams].sort((left, right) => sort === 'title'
    ? left.title.localeCompare(right.title, undefined, { sensitivity: 'base', numeric: true })
    : timeOf(right.updatedAt) - timeOf(left.updatedAt));
}

function matchesNeedle(value: string, needle: string): boolean {
  return value.toLocaleLowerCase().includes(needle);
}

// Frontend scope compatibility: normalized provider + organization compared
// distinctly, never the same sentinel for nil platform vs explicit "platform".
// Nil/blank org is platform:nil, an explicit org (even named "platform") is
// org:<exact>. Case-sensitive to match the backend tagged hash.
function scopeTagOf(providerKey: string | undefined, organizationId: string | null | undefined): string {
  const provider = (providerKey ?? 'sat').toLowerCase().trim() || 'sat';
  const organization = (organizationId ?? '').trim();
  return organization === '' ? `${provider}|platform:nil` : `${provider}|org:${organization}`;
}

function LibraryHeader({
  path,
  title,
  description,
  actions,
  headingRef,
}: {
  path?: ReactNode | undefined;
  title: string;
  description?: string | undefined;
  actions: ReactNode;
  headingRef: RefObject<HTMLHeadingElement | null>;
}) {
  return (
    <header className="flex flex-col gap-4 border-b border-[var(--sat-staff-border-header,rgba(0,0,0,0.065))] pb-6 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {path}
        <h1
          ref={headingRef}
          tabIndex={-1}
          className="break-words text-balance text-[length:var(--sat-staff-type-title-size,28px)] font-semibold leading-[var(--sat-staff-type-title-line,34px)] tracking-[-0.025em] text-[var(--sat-staff-text-primary,#1d1d1f)] outline-none"
        >
          {title}
        </h1>
        {description ? (
          <p className="mt-2 max-w-2xl text-pretty text-[14px] leading-5 text-[var(--sat-staff-text-secondary,#515154)]">{description}</p>
        ) : null}
      </div>
      <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:shrink-0 sm:justify-end">{actions}</div>
    </header>
  );
}

/**
 * Ancestors-only trail. The current folder is the H1, so it appears exactly
 * once. Every ancestor is a real link and a drop target: `library-root` for
 * Exams, `tree-folder:<id>` for a folder (the existing DnD policy contract).
 */
function LibraryPath({
  folders,
  activeFolder,
  onOpen,
}: {
  folders: LibraryFolder[];
  activeFolder: LibraryFolder;
  onOpen: (id: string | null) => void;
}) {
  const ancestors = ancestorsOf(folders, activeFolder.id).slice(0, -1);
  const open = (event: ReactMouseEvent<HTMLAnchorElement>, id: string | null) => {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    onOpen(id);
  };
  return (
    <nav aria-label="Breadcrumb" className="mb-1 min-w-0">
      <ol className="flex min-w-0 flex-wrap items-center gap-x-1 text-[14px] leading-5">
        <li className="flex min-w-0 items-center gap-1">
          <LibraryDroppable id="library-root" label="Drop into Exams" className="inline-flex">
            <a
              href="/sat/exams"
              onClick={(event) => open(event, null)}
              className="inline-flex min-h-11 items-center truncate px-0.5 font-medium"
            >
              Exams
            </a>
          </LibraryDroppable>
        </li>
        {ancestors.map((folder) => (
          <li key={folder.id} className="flex min-w-0 items-center gap-1">
            <ChevronRight size={14} aria-hidden="true" className="shrink-0 text-[var(--sat-staff-text-tertiary,#6e6e73)]" />
            <LibraryDroppable id={`tree-folder:${folder.id}`} label={`Drop into ${folder.name}`} className="inline-flex">
              <a
                href={folderHref(folder.id)}
                onClick={(event) => open(event, folder.id)}
                className="inline-flex min-h-11 max-w-52 items-center truncate px-0.5 font-medium"
              >
                {folder.name}
              </a>
            </LibraryDroppable>
          </li>
        ))}
      </ol>
    </nav>
  );
}

function SectionHeader({
  id,
  title,
  count,
  children,
}: {
  id: string;
  title: string;
  count: number;
  children?: ReactNode;
}) {
  return (
    <div className="flex min-h-11 flex-wrap items-center gap-x-2 gap-y-1 border-b border-[var(--sat-staff-border-hairline,rgba(0,0,0,0.06))] bg-[var(--sat-staff-fill-faint,rgba(0,0,0,0.035))] px-4 py-1.5">
      <h2 id={id} className="text-[14px] font-semibold leading-5 text-[var(--sat-staff-text-secondary,#515154)]">{title}</h2>
      <span className="text-[14px] font-medium tabular-nums text-[var(--sat-staff-text-tertiary,#6e6e73)]">{count}</span>
      {children ? <div className="ml-auto flex min-h-11 items-center gap-2">{children}</div> : null}
    </div>
  );
}

function ArchivedHeader({
  count,
  expanded,
  onToggle,
}: {
  count: number;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="flex min-h-11 items-center border-b border-[var(--sat-staff-border-hairline,rgba(0,0,0,0.06))] bg-[var(--sat-staff-fill-faint,rgba(0,0,0,0.035))] px-4">
      <h2 className="min-w-0 text-[14px] font-semibold leading-5 text-[var(--sat-staff-text-secondary,#515154)]">
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls="sat-archived-list"
          onClick={onToggle}
          className="flex min-h-11 items-center gap-1.5 rounded-[8px] pr-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-staff-accent-ring,rgba(0,113,227,0.4))]"
        >
          <ChevronRight
            size={16}
            aria-hidden="true"
            className={clsx('shrink-0 text-[var(--sat-staff-text-tertiary,#6e6e73)] transition-transform', expanded && 'rotate-90')}
          />
          <span>Archived</span>
          <span className="font-medium tabular-nums text-[var(--sat-staff-text-tertiary,#6e6e73)]">{count}</span>
        </button>
      </h2>
    </div>
  );
}

function SelectAll({
  inputRef,
  allSelected,
  count,
  onToggle,
}: {
  inputRef: RefObject<HTMLInputElement | null>;
  allSelected: boolean;
  count: number;
  onToggle: (on: boolean) => void;
}) {
  const inputId = useId();
  return (
    <label htmlFor={inputId} className="flex min-h-11 cursor-pointer items-center gap-2 text-[13px] font-medium leading-5 text-[var(--sat-staff-text-secondary,#515154)]">
      <input
        ref={inputRef}
        id={inputId}
        type="checkbox"
        className={CHECKBOX_CLASS}
        checked={allSelected}
        onChange={(event) => onToggle(event.target.checked)}
        aria-label={allSelected ? 'Clear selection' : `Select all ${plural(count)}`}
      />
      <span>Select all</span>
    </label>
  );
}

function FolderRow({
  folder,
  index,
  pathLabel,
  searching,
  revealed,
  menuItems,
  onOpen,
}: {
  folder: LibraryFolder;
  index: number;
  pathLabel: string;
  searching: boolean;
  revealed: boolean;
  menuItems: SatMenuItem[];
  onOpen: (id: string) => void;
}) {
  return (
    <li>
      <LibraryDroppable id={`folder:${folder.id}`} label={`Drop into ${folder.name}`}>
        <LibraryContextMenu label={`Actions for ${folder.name}`} items={menuItems}>
          <div
            className={clsx('min-w-0', revealed && '[&_.sat-list-row]:bg-[var(--sat-staff-accent-tint,rgba(0,113,227,0.08))]')}
            data-revealed={revealed ? 'true' : undefined}
          >
            <SatListRowShell
              rowId={`folder-${folder.id}`}
              index={Math.min(index, 5)}
              primary={
                <a
                  href={folderHref(folder.id)}
                  aria-label={searching ? `${folder.name}, in ${pathLabel}` : folder.name}
                  className={SAT_ROW_PRIMARY_LINK_CLASS}
                  onClick={(event) => {
                    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                    event.preventDefault();
                    onOpen(folder.id);
                  }}
                />
              }
            >
              <span className={'grid w-full items-center py-1.5 ' + FOLDER_GRID}>
                <span aria-hidden="true" className="hidden @min-[720px]/list:block" />
                <span className="flex items-center">
                  <FolderDragHandle folderId={folder.id} name={folder.name} />
                </span>
                <span className="min-w-0 py-1">
                  <span className="flex min-h-11 items-center text-[14px] font-semibold leading-5 tracking-[-0.005em] text-[var(--sat-staff-text-primary,#1d1d1f)]">
                    <span className="min-w-0 break-words">{folder.name}</span>
                  </span>
                  {searching ? (
                    <span className="block text-[13px] leading-5 text-[var(--sat-staff-text-tertiary,#6e6e73)]">In {pathLabel}</span>
                  ) : null}
                </span>
                <span className={UPDATED_CELL}>{formatDate(folder.updatedAt)}</span>
                <span className="flex items-center justify-end gap-0.5">
                  <span className={SAT_ROW_ACTION_CLASS}>
                    <SatMenu
                      modal={false}
                      label={`Actions for ${folder.name}`}
                      compact
                      icon={MoreHorizontal}
                      items={menuItems}
                    />
                  </span>
                  <ArrowRight size={16} className="sat-row-chevron shrink-0 text-slate-400" aria-hidden="true" />
                </span>
              </span>
            </SatListRowShell>
          </div>
        </LibraryContextMenu>
      </LibraryDroppable>
    </li>
  );
}

function ExamRow({
  exam,
  index,
  current,
  checked,
  disabled,
  searching,
  locationLabel,
  menuItems,
  onOpen,
  onReveal,
  onToggle,
}: {
  exam: ExamEntity;
  index: number;
  current: boolean;
  checked: boolean;
  disabled: boolean;
  searching: boolean;
  locationLabel: string;
  menuItems: SatMenuItem[];
  onOpen: () => void;
  onReveal: () => void;
  onToggle: (on: boolean) => void;
}) {
  const checkboxId = useId();
  const hasPublishedVersion = Boolean(exam.currentPublishedVersionId);
  const primaryPath = hasPublishedVersion ? `/sat/exams/${exam.id}/access` : `/sat/exams/${exam.id}`;
  return (
    <li>
      <LibraryContextMenu label={`Actions for ${exam.title}`} items={menuItems}>
        <div className={clsx('min-w-0', checked && '[&_.sat-list-row]:bg-[var(--sat-staff-accent-tint,rgba(0,113,227,0.08))]')}>
          <SatListRowShell
            rowId={exam.id}
            current={current}
            index={Math.min(index, 5)}
            primary={
              <a
                href={primaryPath}
                aria-label={hasPublishedVersion ? `Open rooms for ${exam.title}` : `Edit ${exam.title}`}
                className={SAT_ROW_PRIMARY_LINK_CLASS}
                onClick={(event) => {
                  if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                  event.preventDefault();
                  onOpen();
                }}
              />
            }
          >
            <span className={'grid w-full items-center py-2 ' + EXAM_GRID}>
              <span className="col-start-1 row-start-1 flex items-center">
                <label htmlFor={checkboxId} className={`-m-3.5 flex p-3.5 ${SAT_ROW_ACTION_CLASS}`}>
                  <input
                    id={checkboxId}
                    type="checkbox"
                    className={CHECKBOX_CLASS}
                    checked={checked}
                    disabled={disabled}
                    onChange={(event) => onToggle(event.target.checked)}
                    aria-label={`Select ${exam.title}`}
                  />
                </label>
              </span>
              <span className="col-start-2 row-start-1 flex items-center">
                <ExamDragHandle examId={exam.id} title={exam.title}>
                  <span className="flex h-8 w-8 items-center justify-center rounded-[10px] border border-[var(--sat-staff-border-hairline,rgba(0,0,0,0.06))] bg-[var(--sat-staff-fill-faint,rgba(0,0,0,0.035))] text-[var(--sat-staff-text-tertiary,#6e6e73)]">
                    {hasPublishedVersion ? <DoorOpen size={16} aria-hidden="true" /> : <FileText size={16} aria-hidden="true" />}
                  </span>
                </ExamDragHandle>
              </span>
              <span className="col-start-3 row-start-1 min-w-0 self-center">
                <span className="line-clamp-2 break-words text-[14px] font-semibold leading-5 tracking-[-0.01em] text-[var(--sat-staff-text-primary,#1d1d1f)]">
                  {exam.title}
                </span>
              </span>
              <span className={UPDATED_CELL}>{formatDate(exam.updatedAt)}</span>
              <span className="col-start-4 row-start-1 flex items-center justify-end @min-[720px]/list:col-start-5">
                <span className={SAT_ROW_ACTION_CLASS}>
                  <SatMenu
                    modal={false}
                    label={`Actions for ${exam.title}`}
                    compact
                    icon={MoreHorizontal}
                    items={menuItems}
                  />
                </span>
              </span>
              <span className="col-span-4 col-start-1 row-start-2 mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] leading-5 text-[var(--sat-staff-text-secondary,#515154)] @min-[720px]/list:col-span-3 @min-[720px]/list:col-start-3">
                <span>{examTypeLabel(exam)}</span>
                <SatStatusPill tone={statusTone(exam)}>{statusLabel(exam)}</SatStatusPill>
                <span className="tabular-nums @min-[720px]/list:hidden">Updated {formatDate(exam.updatedAt)}</span>
              </span>
              {searching ? (
                <span className="col-span-4 col-start-1 row-start-3 mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] leading-5 @min-[720px]/list:col-span-3 @min-[720px]/list:col-start-3">
                  <span className="min-w-0 break-words text-[var(--sat-staff-text-tertiary,#6e6e73)]">In {locationLabel}</span>
                  <button
                    type="button"
                    onClick={onReveal}
                    aria-label={`Show ${exam.title} in ${locationLabel === 'Exams' ? 'Exams' : 'folder'}`}
                    className={`min-h-11 rounded-[8px] px-2 text-[13px] font-semibold leading-5 text-[var(--sat-staff-accent,#0071e3)] hover:bg-[var(--sat-staff-accent-tint,rgba(0,113,227,0.08))] ${SAT_ROW_ACTION_CLASS}`}
                  >
                    {locationLabel === 'Exams' ? 'Show in Exams' : 'Show in folder'}
                  </button>
                </span>
              ) : null}
            </span>
          </SatListRowShell>
        </div>
      </LibraryContextMenu>
    </li>
  );
}

export function SatExamLibraryRoute() {
  const query = useExamListQuery(true, 'sat', false);
  const library = useSatLibraryQuery(true);
  const libraryLoading = library.isLoading;
  const libraryError = library.error
    ? (library.error instanceof Error ? library.error.message : 'The exams list is unavailable.')
    : null;
  const libraryLoaded = !libraryLoading && !libraryError && Boolean(library.data);
  // Fail closed: until BOTH authoritative queries load, gate folder/exam
  // content and mutations. Missing library data must never render filed exams
  // as unfiled.
  const folders = useMemo(() => (libraryLoaded ? (library.data?.folders ?? []) : []), [libraryLoaded, library.data]);
  const entriesByExam = useMemo(() => (libraryLoaded ? (library.data?.byExam ?? {}) : {}), [libraryLoaded, library.data]);

  const { params, setParams } = useSatListParams();
  const search = params.q ?? '';
  const needle = search.trim().toLocaleLowerCase();
  const searching = needle.length > 0;
  const sort: LibrarySort = params.sort === 'title' ? 'title' : 'updated';
  const folderParam = params.folder;
  // `all` is a retired smart view: the Exams browser is one place now. The
  // effect below rewrites the URL with replace, preserving q/sort.
  const activeFolderId = folderParam && folderParam !== 'all' ? folderParam : null;
  const activeFolder = activeFolderId ? (folders.find((folder) => folder.id === activeFolderId) ?? null) : null;
  const unknownFolder = Boolean(activeFolderId) && libraryLoaded && !activeFolder;
  const levelFolderId = activeFolder ? activeFolder.id : null;
  const locationKnown = libraryLoaded && !unknownFolder;

  const [createOpen, setCreateOpen] = useState(false);
  const { session } = useAuthSession();
  const allSatExams = useMemo(() => (query.data?.entities ?? []).filter((exam) => exam.providerKey === 'sat'), [query.data?.entities]);
  const levelExams = useMemo(() => {
    if (!libraryLoaded || unknownFolder) return [] as typeof allSatExams;
    return allSatExams.filter((exam) => folderIdOf(entriesByExam, exam.id) === levelFolderId);
  }, [allSatExams, levelFolderId, entriesByExam, libraryLoaded, unknownFolder]);
  const matchingExams = useMemo(
    () => (searching ? allSatExams.filter((exam) => matchesNeedle(exam.title, needle)) : levelExams),
    [allSatExams, levelExams, needle, searching],
  );
  const activeExams = useMemo(
    () => sortExams(matchingExams.filter((exam) => exam.status !== 'archived'), sort),
    [matchingExams, sort],
  );
  const archivedExams = useMemo(
    () => sortExams(matchingExams.filter((exam) => exam.status === 'archived'), sort),
    [matchingExams, sort],
  );
  const folderList = useMemo(() => {
    if (!libraryLoaded || unknownFolder) return [] as typeof folders;
    if (searching) {
      return [...folders]
        .filter((folder) => matchesNeedle(folder.name, needle))
        .sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: 'base', numeric: true }));
    }
    return childrenOf(folders, levelFolderId);
  }, [folders, levelFolderId, libraryLoaded, needle, searching, unknownFolder]);

  const [archivedOpen, setArchivedOpen] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const [pendingReveal, setPendingReveal] = useState<{ id: string; parentId: string | null } | null>(null);
  const [revealedFolderId, setRevealedFolderId] = useState<string | null>(null);

  // Compatibility: legacy `folder=all` becomes root; legacy tab values never
  // hide content. `tab=archived` opens the real Archived disclosure once.
  useEffect(() => {
    const patch: { folder?: string; tab?: '' } = {};
    if (params.folder === 'all') patch.folder = '';
    if (params.tab) {
      if (params.tab === 'archived') setArchivedOpen(true);
      patch.tab = '';
    }
    if (patch.folder !== undefined || patch.tab !== undefined) setParams(patch, { replace: true });
  }, [params.folder, params.tab, setParams]);

  const { lastOpenedId, openRecord } = useSatListReturn(!query.isLoading);

  const setSearch = (value: string) => setParams({ q: value });

  // Every folder navigation is a history push and clears the query. Back then
  // restores the previous location and search exactly.
  const openFolder = (id: string | null) => {
    setPicked(new Set());
    setNotice(null);
    setPendingReveal(null);
    setSingleMoveExam(null);
    setParams({ folder: id ?? '', q: '' }, { replace: false });
  };
  const returnToExams = () => {
    setPicked(new Set());
    setNotice(null);
    setPendingReveal(null);
    setParams({ folder: '', q: '' }, { replace: true });
  };

  const bulkDelete = useBulkDeleteExamsMutation();
  const [picked, setPicked] = useState<ReadonlySet<string>>(() => new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  useEffect(() => {
    setPicked(new Set());
  }, [folderParam]);
  const selectAllRef = useRef<HTMLInputElement>(null);
  const archivedVisible = searching || archivedOpen;
  const visibleExams = useMemo(
    () => (archivedVisible ? [...activeExams, ...archivedExams] : activeExams),
    [activeExams, archivedExams, archivedVisible],
  );
  const selectedExams = useMemo(() => visibleExams.filter((exam) => picked.has(exam.id)), [picked, visibleExams]);
  const selectedIds = selectedExams.map((exam) => exam.id);
  const allSelected = visibleExams.length > 0 && selectedIds.length === visibleExams.length;
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
    setPicked((previous) => {
      const next = new Set(previous);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  };
  const toggleAll = (on: boolean) => {
    setNotice(null);
    setPicked(on ? new Set(visibleExams.map((exam) => exam.id)) : new Set());
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

  const openCreate = () => {
    if (!locationKnown) {
      setNotice({ tone: 'error', text: 'Exams are still loading. Try again.' });
      return;
    }
    setCreateOpen(true);
  };
  const createFolderId = levelFolderId;
  const openNewFolderDialog = () => {
    if (!locationKnown) {
      setNotice({ tone: 'error', text: 'Exams are still loading. Try again.' });
      return;
    }
    setFolderCreateError(null);
    setFolderCreateParent(createFolderId);
  };

  // Folder dialogs + mutations.
  const createFolder = useCreateFolderMutation();
  const renameFolder = useRenameFolderMutation();
  const moveFolder = useMoveFolderMutation();
  const deleteFolder = useDeleteFolderMutation();
  const moveExams = useMoveExamsMutation();
  const [folderCreateParent, setFolderCreateParent] = useState<string | null | undefined>(undefined);
  const [folderCreateError, setFolderCreateError] = useState<string | null>(null);
  const [renameTarget, setRenameTarget] = useState<string | null>(null);
  const [renameError, setRenameError] = useState<string | null>(null);
  const [moveFolderTarget, setMoveFolderTarget] = useState<string | null>(null);
  const [moveFolderError, setMoveFolderError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [deleteFolderError, setDeleteFolderError] = useState<string | null>(null);
  const [examMoveOpen, setExamMoveOpen] = useState(false);
  const [examMoveError, setExamMoveError] = useState<string | null>(null);
  const [singleMoveExam, setSingleMoveExam] = useState<ExamEntity | null>(null);

  const renameFolderRow = folders.find((folder) => folder.id === renameTarget) ?? null;
  const moveFolderRow = folders.find((folder) => folder.id === moveFolderTarget) ?? null;
  const deleteFolderRow = folders.find((folder) => folder.id === deleteTarget) ?? null;
  const deleteExamCount = deleteTarget ? allSatExams.filter((exam) => folderIdOf(entriesByExam, exam.id) === deleteTarget).length : 0;
  const deleteChildFolderCount = deleteTarget ? childrenOf(folders, deleteTarget).length : 0;

  const focusHeadingSoon = () => {
    requestAnimationFrame(() => headingRef.current?.focus());
  };

  // After authoritative data renders, reveal the created folder in its real
  // parent and focus its row. If it was created in another folder, creation
  // already navigated there.
  useEffect(() => {
    if (!pendingReveal || unknownFolder) return;
    if (levelFolderId !== pendingReveal.parentId) return;
    const row = document.querySelector<HTMLElement>(`[data-sat-row-id="folder-${CSS.escape(pendingReveal.id)}"]`);
    if (!row) return;
    setPendingReveal(null);
    setRevealedFolderId(pendingReveal.id);
    // The creation dialog animates out, and only then restores focus to its
    // trigger. Wait for that portal to leave so the created row is where the
    // staff member actually lands.
    const startedAt = performance.now();
    const focusCreatedRow = () => {
      if (!row.isConnected) return;
      if (document.querySelector('.sat-dialog[data-state]') && performance.now() - startedAt < 1000) {
        window.requestAnimationFrame(focusCreatedRow);
        return;
      }
      const link = row.querySelector<HTMLAnchorElement>('a');
      (link ?? row).focus({ preventScroll: true });
      row.scrollIntoView?.({ block: 'nearest' });
    };
    window.requestAnimationFrame(focusCreatedRow);
  }, [folders, levelFolderId, needle, pendingReveal, unknownFolder]);
  useEffect(() => {
    if (!revealedFolderId) return;
    const timer = window.setTimeout(() => setRevealedFolderId(null), 2400);
    return () => window.clearTimeout(timer);
  }, [revealedFolderId]);

  const runCreateFolder = async (name: string) => {
    if (!locationKnown) {
      setFolderCreateError('Exams are still loading. Try again.');
      return;
    }
    setFolderCreateError(null);
    const parentId = folderCreateParent ?? null;
    try {
      const created = await createFolder.mutateAsync({
        name,
        ...(parentId ? { parentId } : { parentId: null }),
      });
      setFolderCreateParent(undefined);
      setNotice({ tone: 'ok', text: parentId ? `Created folder ${created.name}.` : `Created folder ${created.name} in Exams.` });
      setPendingReveal({ id: created.id, parentId });
      setPicked(new Set());
      if (parentId !== levelFolderId) {
        // New subfolder was invoked on another folder: land in that parent so
        // the new row is visible, and drop the search that hid the hierarchy.
        setParams({ folder: parentId ?? '', q: '' }, { replace: false });
      } else if (searching) {
        setParams({ q: '' });
      }
    } catch (error) {
      setFolderCreateError(error instanceof Error ? error.message : 'The folder could not be created.');
    }
  };
  const runRenameFolder = async (name: string) => {
    if (!renameFolderRow) return;
    setRenameError(null);
    try {
      await renameFolder.mutateAsync({ id: renameFolderRow.id, name, revision: renameFolderRow.revision });
      setRenameTarget(null);
      returnFocusRef.current?.focus();
    } catch (error) {
      setRenameError(error instanceof Error ? error.message : 'The folder could not be renamed.');
    }
  };
  const runMoveFolder = async (parentId: string | null) => {
    if (!moveFolderRow) return;
    setMoveFolderError(null);
    const isCurrent = moveFolderRow.id === activeFolder?.id;
    try {
      await moveFolder.mutateAsync({ id: moveFolderRow.id, parentId, revision: moveFolderRow.revision });
      setMoveFolderTarget(null);
      if (isCurrent) focusHeadingSoon();
      else returnFocusRef.current?.focus();
    } catch (error) {
      setMoveFolderError(error instanceof Error ? error.message : 'The folder could not be moved.');
    }
  };
  const runDeleteFolder = async () => {
    if (!deleteFolderRow || deleteFolder.isPending) return;
    setDeleteFolderError(null);
    const isCurrent = deleteFolderRow.id === activeFolder?.id;
    const parentId = deleteFolderRow.parentId ?? null;
    try {
      await deleteFolder.mutateAsync({ id: deleteFolderRow.id, revision: deleteFolderRow.revision });
      setDeleteTarget(null);
      setNotice({ tone: 'ok', text: `Deleted folder ${deleteFolderRow.name}.` });
      if (isCurrent) {
        setPicked(new Set());
        setParams({ folder: parentId ?? '', q: '' }, { replace: false });
      }
      focusHeadingSoon();
    } catch (error) {
      // Keep the alert open with the server sentence so the staff member can
      // retry without losing context.
      setDeleteFolderError(error instanceof Error ? error.message : 'The folder could not be deleted.');
    }
  };

  const moveTargetExams = useMemo(
    () => (singleMoveExam ? [singleMoveExam] : selectedExams),
    [singleMoveExam, selectedExams],
  );
  const moveCompatible = useMemo(() => {
    const scopes = new Set(moveTargetExams.map((exam) => scopeTagOf(exam.providerKey, exam.organizationId)));
    return scopes.size <= 1;
  }, [moveTargetExams]);
  const moveTargetScope = useMemo(
    () => (moveTargetExams.length ? scopeTagOf(moveTargetExams[0]?.providerKey, moveTargetExams[0]?.organizationId) : null),
    [moveTargetExams],
  );
  const moveDestinations = useMemo(() => {
    if (!moveTargetScope) return folders;
    return folders.filter((folder) => scopeTagOf(folder.providerKey, folder.organizationId ?? null) === moveTargetScope);
  }, [folders, moveTargetScope]);
  const folderMoveDestinations = useMemo(() => {
    if (!moveFolderRow) return folders;
    const excluded = descendantIds(folders, moveFolderRow.id);
    excluded.add(moveFolderRow.id);
    const scope = scopeTagOf(moveFolderRow.providerKey, moveFolderRow.organizationId ?? null);
    return folders.filter((folder) => !excluded.has(folder.id) && scopeTagOf(folder.providerKey, folder.organizationId ?? null) === scope);
  }, [folders, moveFolderRow]);
  const runMoveExams = async (folderId: string | null) => {
    if (!locationKnown) {
      setExamMoveError('Exams are still loading. Try again.');
      return;
    }
    setExamMoveError(null);
    const items = moveTargetExams.map((exam) => ({ examId: exam.id, revision: entriesByExam[exam.id]?.revision ?? 0 }));
    try {
      await moveExams.mutateAsync({ items, folderId });
      setPicked(new Set());
      setSingleMoveExam(null);
      setExamMoveOpen(false);
      setNotice({ tone: 'ok', text: folderId ? `Moved ${plural(items.length)}.` : `Moved ${plural(items.length)} to Exams.` });
      // Release the dialog's focus trap before focusing outside it. The
      // original row may have disappeared from this folder after the move.
      focusHeadingSoon();
    } catch (error) {
      setExamMoveError(error instanceof Error ? error.message : 'The exams could not be moved. Try again.');
    }
  };
  const examInitialDestination = useMemo(() => {
    // Start the exam chooser in the exams' common current folder so Move is
    // one step when everything already sits together; root otherwise.
    if (!moveTargetExams.length) return null;
    const first = folderIdOf(entriesByExam, moveTargetExams[0]?.id ?? '');
    if (first !== null && !folders.some((folder) => folder.id === first)) return null;
    return moveTargetExams.every((exam) => folderIdOf(entriesByExam, exam.id) === first) ? first : null;
  }, [moveTargetExams, entriesByExam, folders]);
  const runNewFolderFromMove = async (name: string, parentId: string | null) => {
    // Create-only: the dialog selects and browses into the new folder and the
    // user presses Move afterwards. Never moves implicitly, so a failed move
    // cannot strand exams and a created folder never fires twice. This path
    // deliberately leaves the main browser search alone.
    if (createFolder.isPending) return null;
    if (!locationKnown) {
      setExamMoveError('Exams are still loading. Try again.');
      return null;
    }
    if (!moveCompatible || moveTargetExams.length === 0) {
      setExamMoveError('Selected exams belong to different libraries. Move one library at a time.');
      return null;
    }
    const trimmed = name.trim();
    // Disallow incompatible mixed-scope creation: new folder inherits the
    // selected exams' scope via context exam, or the dialog destination.
    const contextExam = singleMoveExam ?? selectedExams[0] ?? null;
    const destScope = parentId ? folders.find((folder) => folder.id === parentId) ?? null : null;
    if (destScope && contextExam && scopeTagOf(destScope.providerKey, destScope.organizationId ?? null) !== scopeTagOf(contextExam.providerKey, contextExam.organizationId)) {
      setExamMoveError('Selected exams and the destination folder belong to different libraries.');
      return null;
    }
    try {
      const created = await createFolder.mutateAsync({
        name: trimmed,
        ...(parentId ? { parentId } : { parentId: null }),
        ...(contextExam && !parentId ? { contextExamId: contextExam.id } : {}),
      });
      setNotice({ tone: 'ok', text: parentId ? `Created folder ${created.name}.` : `Created folder ${created.name} in Exams.` });
      return created;
    } catch (error) {
      setExamMoveError(error instanceof Error ? error.message : 'The folder could not be created.');
      return null;
    }
  };

  const folderMenuItems = (folder: LibraryFolder): SatMenuItem[] => [
    { id: 'open', label: 'Open', onSelect: () => openFolder(folder.id) },
    {
      id: 'subfolder',
      label: 'New subfolder',
      onSelect: (trigger) => {
        returnFocusRef.current = trigger;
        setFolderCreateError(null);
        setFolderCreateParent(folder.id);
      },
    },
    {
      id: 'rename',
      label: 'Rename',
      onSelect: (trigger) => {
        returnFocusRef.current = trigger;
        setRenameError(null);
        setRenameTarget(folder.id);
      },
    },
    {
      id: 'move',
      label: 'Move to',
      onSelect: (trigger) => {
        returnFocusRef.current = trigger;
        setMoveFolderError(null);
        setMoveFolderTarget(folder.id);
      },
    },
    {
      id: 'delete',
      label: 'Delete',
      destructive: true,
      onSelect: (trigger) => {
        returnFocusRef.current = trigger;
        setDeleteFolderError(null);
        setDeleteTarget(folder.id);
      },
    },
  ];
  const currentFolderMenuItems: SatMenuItem[] = activeFolder
    ? [{
        id: 'delete',
        label: 'Delete',
        destructive: true,
        onSelect: (trigger) => {
          returnFocusRef.current = trigger;
          setDeleteFolderError(null);
          setDeleteTarget(activeFolder.id);
        },
      }]
    : [];
  const examMenuItems = (exam: ExamEntity, hasPublishedVersion: boolean): SatMenuItem[] => {
    const locationId = folderIdOf(entriesByExam, exam.id);
    return [
      ...(searching
        ? [{
            id: 'reveal',
            label: locationId ? 'Show in folder' : 'Show in Exams',
            onSelect: () => openFolder(locationId),
          } as SatMenuItem]
        : []),
      {
        id: 'move',
        label: 'Move to',
        onSelect: (trigger) => {
          returnFocusRef.current = trigger;
          setExamMoveError(null);
          setSingleMoveExam(exam);
          setExamMoveOpen(true);
        },
      },
      ...(hasPublishedVersion
        ? [{
            id: 'edit',
            label: 'Edit exam',
            onSelect: () => {
              requestAuthoringDraftOnEntry(exam.id);
              openRecord(exam.id, `/sat/exams/${exam.id}`);
            },
          } as SatMenuItem]
        : []),
    ];
  };

  const canDrop = (sourceId: string, targetId: string): boolean => {
    if (!locationKnown || moveExams.isPending || moveFolder.isPending || bulkDelete.isPending) return false;
    const destination = folderFromDropTarget(targetId);
    if (destination === undefined) return false;
    const target = destination ? folders.find((folder) => folder.id === destination) : null;
    if (destination && !target) return false;
    if (sourceId.startsWith('exam:')) {
      const source = visibleExams.find((exam) => exam.id === sourceId.slice(5));
      if (!source) return false;
      const batch = picked.has(source.id) ? selectedExams : [source];
      const scope = scopeTagOf(source.providerKey, source.organizationId);
      if (batch.some((exam) => scopeTagOf(exam.providerKey, exam.organizationId) !== scope)) return false;
      if (target && scopeTagOf(target.providerKey, target.organizationId) !== scope) return false;
      return batch.some((exam) => folderIdOf(entriesByExam, exam.id) !== destination);
    }
    if (sourceId.startsWith('folder:')) {
      const source = folders.find((folder) => folder.id === sourceId.slice(7));
      if (!source || destination === source.id || (source.parentId ?? null) === destination) return false;
      if (target && scopeTagOf(target.providerKey, target.organizationId) !== scopeTagOf(source.providerKey, source.organizationId)) return false;
      return destination === null || !descendantIds(folders, source.id).has(destination);
    }
    return false;
  };
  const handleDrop = (sourceId: string, targetId: string) => {
    if (!canDrop(sourceId, targetId)) return;
    const destination = folderFromDropTarget(targetId);
    if (destination === undefined) return;
    if (sourceId.startsWith('exam:')) {
      const source = visibleExams.find((exam) => exam.id === sourceId.slice(5));
      if (!source) return;
      const batch = picked.has(source.id) ? selectedExams : [source];
      const items = batch.map((exam) => ({ examId: exam.id, revision: entriesByExam[exam.id]?.revision ?? 0 }));
      moveExams.mutate({ items, folderId: destination }, {
        onSuccess: () => {
          setPicked(new Set());
          setNotice({ tone: 'ok', text: destination ? `Moved ${plural(items.length)}.` : `Moved ${plural(items.length)} to Exams.` });
          focusHeadingSoon();
        },
        onError: (error) => setNotice({ tone: 'error', text: error.message }),
      });
    } else {
      const source = folders.find((folder) => folder.id === sourceId.slice(7));
      if (!source) return;
      moveFolder.mutate({ id: source.id, parentId: destination, revision: source.revision }, {
        onSuccess: () => {
          setPicked(new Set());
          setNotice({ tone: 'ok', text: `Moved folder ${source.name}.` });
          focusHeadingSoon();
        },
        onError: (error) => setNotice({ tone: 'error', text: error.message }),
      });
    }
  };

  const loadError = query.error
    ? (query.error instanceof Error ? query.error.message : 'The exams list is unavailable.')
    : libraryError;
  const hasSurface = folderList.length > 0 || activeExams.length > 0 || archivedExams.length > 0;
  const examSectionTitle = searching || levelFolderId ? 'Exams' : 'Exams not in a folder';
  const announcement = !locationKnown
    ? ''
    : searching
      ? `${folderList.length} ${folderList.length === 1 ? 'folder' : 'folders'} and ${activeExams.length + archivedExams.length} ${activeExams.length + archivedExams.length === 1 ? 'exam' : 'exams'} match “${search.trim()}”.`
      : `${activeExams.length} ${activeExams.length === 1 ? 'exam' : 'exams'} in ${activeFolder ? activeFolder.name : 'Exams'}${archivedExams.length ? `, ${archivedExams.length} archived` : ''}.`;

  return (
    <SatContainer measure="full" className="@container/library">
      <LibraryDragProvider onDrop={handleDrop} canDrop={canDrop}>
        <LibraryHeader
          path={activeFolder ? <LibraryPath folders={folders} activeFolder={activeFolder} onOpen={openFolder} /> : undefined}
          title={activeFolder ? activeFolder.name : 'Exams'}
          description={activeFolder ? undefined : 'Create exams, organize them in folders, and prepare rooms.'}
          headingRef={headingRef}
          actions={
            <>
              {activeFolder ? (
                <>
                  <SatButton
                    variant="quiet"
                    onClick={(event) => {
                      returnFocusRef.current = event.currentTarget;
                      setRenameError(null);
                      setRenameTarget(activeFolder.id);
                    }}
                  >
                    Rename
                  </SatButton>
                  <SatButton
                    variant="quiet"
                    onClick={(event) => {
                      returnFocusRef.current = event.currentTarget;
                      setMoveFolderError(null);
                      setMoveFolderTarget(activeFolder.id);
                    }}
                  >
                    Move
                  </SatButton>
                  <SatMenu
                    modal={false}
                    label="More folder actions"
                    compact
                    icon={MoreHorizontal}
                    items={currentFolderMenuItems}
                  />
                </>
              ) : null}
              <SatButton
                variant="primary"
                onClick={openCreate}
                disabled={!locationKnown}
                icon={<Plus size={16} aria-hidden="true" />}
              >
                Create exam
              </SatButton>
            </>
          }
        />

        <div className="sticky top-[calc(3.5rem+env(safe-area-inset-top))] z-30 -mx-4 mt-4 border-b border-[var(--sat-staff-border-hairline,rgba(0,0,0,0.06))] bg-[var(--sat-staff-canvas,var(--sat-canvas))] px-4 py-2 sm:-mx-6 sm:px-6 md:top-0">
          {selectedIds.length > 0 ? (
            // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- Escape clears selection from anywhere in the toolbar; the group itself is not focusable.
            <div
              role="group"
              aria-label="Selection actions"
              onKeyDown={(event) => {
                // Only the focused selection toolbar clears selection; menus and
                // dialogs keep their own Escape contract.
                if (event.key === 'Escape') {
                  event.stopPropagation();
                  setPicked(new Set());
                }
              }}
              className="flex min-h-11 flex-wrap items-center gap-2"
            >
              <p role="status" aria-live="polite" className="text-[14px] font-semibold tabular-nums text-[var(--sat-staff-text-primary,#1d1d1f)]">
                {selectedIds.length} selected
              </p>
              <div className="ml-auto flex flex-wrap items-center gap-2">
                <SatButton
                  variant="secondary"
                  disabled={!locationKnown}
                  onClick={() => {
                    setExamMoveError(null);
                    setSingleMoveExam(null);
                    setExamMoveOpen(true);
                  }}
                >
                  Move to
                </SatButton>
                <SatButton
                  variant="danger-secondary"
                  icon={<Trash2 size={16} aria-hidden="true" />}
                  pending={bulkDelete.isPending}
                  onClick={() => setConfirmOpen(true)}
                >
                  Delete {plural(selectedIds.length)}
                </SatButton>
                <SatButton variant="quiet" onClick={() => setPicked(new Set())}>Clear selection</SatButton>
              </div>
            </div>
          ) : (
            <div role="group" aria-label="Exams controls" className="flex min-w-0 flex-wrap items-center gap-2">
              <SatSearchField
                id="sat-exam-search"
                label="Search all exams and folders"
                value={search}
                onChange={setSearch}
                placeholder="Search all exams and folders"
                widthClassName="sm:max-w-xl sm:flex-1"
              />
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <SatToolbarSelect<LibrarySort>
                  id="sat-exam-sort"
                  label="Sort"
                  value={sort}
                  options={[
                    { value: 'updated', label: 'Last updated' },
                    { value: 'title', label: 'Name A–Z' },
                  ]}
                  onChange={(next) => setParams({ sort: next === 'updated' ? '' : next })}
                />
                <SatButton
                  variant="secondary"
                  onClick={openNewFolderDialog}
                  disabled={!locationKnown}
                  icon={<Plus size={16} aria-hidden="true" />}
                >
                  New folder
                </SatButton>
              </div>
            </div>
          )}
        </div>
        {searching ? (
          <p className="mt-2 text-[13px] leading-5 text-[var(--sat-staff-text-tertiary,#6e6e73)]">
            Results from all folders for “{search.trim()}”.
          </p>
        ) : null}
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
        <p aria-live="polite" className="sr-only">{announcement}</p>

        <div className="@container/list min-w-0">
          {loadError ? (
            <SatInlineError
              title="Exams could not load"
              description={loadError}
              onRetry={() => { void query.refetch(); void library.refetch(); }}
            />
          ) : query.isLoading || libraryLoading ? (
            <SatListSkeleton rows={6} label="Loading exams" />
          ) : unknownFolder ? (
            <SatInlineError
              title="Folder unavailable"
              description="This folder was deleted or you no longer have access to it."
              onRetry={returnToExams}
              retryLabel="Return to Exams"
            />
          ) : hasSurface ? (
            <div className="mt-3 overflow-hidden rounded-[var(--sat-staff-radius-card,16px)] border border-[var(--sat-staff-border-hairline,rgba(0,0,0,0.06))] bg-[var(--sat-staff-surface,#fff)] shadow-[var(--sat-staff-shadow-card,none)]">
              {folderList.length > 0 ? (
                <section className="border-t border-[var(--sat-staff-border-hairline,rgba(0,0,0,0.06))] first:border-t-0" aria-labelledby="sat-library-folders">
                  <SectionHeader id="sat-library-folders" title="Folders" count={folderList.length} />
                  <ul aria-label="Folders" className="m-0 list-none divide-y divide-[var(--sat-staff-border-hairline,rgba(0,0,0,0.06))] p-0">
                    {folderList.map((folder, index) => (
                      <FolderRow
                        key={folder.id}
                        folder={folder}
                        index={index}
                        pathLabel={folderPath(folders, folder.parentId ?? null)}
                        searching={searching}
                        revealed={revealedFolderId === folder.id}
                        menuItems={folderMenuItems(folder)}
                        onOpen={openFolder}
                      />
                    ))}
                  </ul>
                </section>
              ) : null}
              {activeExams.length > 0 ? (
                <section className="border-t border-[var(--sat-staff-border-hairline,rgba(0,0,0,0.06))] first:border-t-0" aria-labelledby="sat-library-exams">
                  <SectionHeader id="sat-library-exams" title={examSectionTitle} count={activeExams.length}>
                    <SelectAll
                      inputRef={selectAllRef}
                      allSelected={allSelected}
                      count={visibleExams.length}
                      onToggle={toggleAll}
                    />
                  </SectionHeader>
                  <ul aria-label="Exams" className="m-0 list-none divide-y divide-[var(--sat-staff-border-hairline,rgba(0,0,0,0.06))] p-0">
                    {activeExams.map((exam, index) => (
                      <ExamRow
                        key={exam.id}
                        exam={exam}
                        index={index}
                        current={exam.id === lastOpenedId}
                        checked={picked.has(exam.id)}
                        disabled={bulkDelete.isPending}
                        searching={searching}
                        locationLabel={folderPath(folders, folderIdOf(entriesByExam, exam.id))}
                        menuItems={examMenuItems(exam, Boolean(exam.currentPublishedVersionId))}
                        onOpen={() => {
                          const hasPublishedVersion = Boolean(exam.currentPublishedVersionId);
                          if (!hasPublishedVersion) requestAuthoringDraftOnEntry(exam.id);
                          openRecord(exam.id, hasPublishedVersion ? `/sat/exams/${exam.id}/access` : `/sat/exams/${exam.id}`);
                        }}
                        onReveal={() => openFolder(folderIdOf(entriesByExam, exam.id))}
                        onToggle={(on) => toggle(exam.id, on)}
                      />
                    ))}
                  </ul>
                </section>
              ) : null}
              {archivedExams.length > 0 ? (
                <section className="border-t border-[var(--sat-staff-border-hairline,rgba(0,0,0,0.06))] first:border-t-0" aria-labelledby="sat-library-archived">
                  {searching ? (
                    <SectionHeader id="sat-library-archived" title="Archived" count={archivedExams.length} />
                  ) : (
                    <ArchivedHeader
                      count={archivedExams.length}
                      expanded={archivedOpen}
                      onToggle={() => setArchivedOpen((value) => !value)}
                    />
                  )}
                  {archivedVisible ? (
                    <ul id="sat-archived-list" aria-label="Archived exams" className="m-0 list-none divide-y divide-[var(--sat-staff-border-hairline,rgba(0,0,0,0.06))] p-0">
                      {archivedExams.map((exam, index) => (
                        <ExamRow
                          key={exam.id}
                          exam={exam}
                          index={index}
                          current={exam.id === lastOpenedId}
                          checked={picked.has(exam.id)}
                          disabled={bulkDelete.isPending}
                          searching={searching}
                          locationLabel={folderPath(folders, folderIdOf(entriesByExam, exam.id))}
                          menuItems={examMenuItems(exam, Boolean(exam.currentPublishedVersionId))}
                          onOpen={() => {
                            const hasPublishedVersion = Boolean(exam.currentPublishedVersionId);
                            if (!hasPublishedVersion) requestAuthoringDraftOnEntry(exam.id);
                            openRecord(exam.id, hasPublishedVersion ? `/sat/exams/${exam.id}/access` : `/sat/exams/${exam.id}`);
                          }}
                          onReveal={() => openFolder(folderIdOf(entriesByExam, exam.id))}
                          onToggle={(on) => toggle(exam.id, on)}
                        />
                      ))}
                    </ul>
                  ) : null}
                </section>
              ) : null}
            </div>
          ) : searching ? (
            <SatEmptyState
              icon={<SearchX size={20} aria-hidden="true" />}
              title={`No matches for “${search.trim()}”`}
              hint="Search looks across all exams and folders, including archived ones."
              action={<SatButton variant="secondary" onClick={() => setSearch('')}>Clear search</SatButton>}
            />
          ) : (
            <SatEmptyState
              icon={<BookOpen size={20} aria-hidden="true" />}
              title={levelFolderId ? 'This folder is empty' : 'No exams yet'}
              hint={levelFolderId
                ? 'Create an exam here, or add a subfolder to organize what comes next.'
                : 'Create an exam, or start with a folder to organize your exams. The standard Digital SAT structure is ready immediately.'}
              action={
                <div className="flex flex-wrap items-center justify-center gap-2">
                  <SatButton variant="primary" onClick={openCreate} icon={<Plus size={16} aria-hidden="true" />}>Create exam</SatButton>
                  <SatButton variant="secondary" onClick={openNewFolderDialog} icon={<Plus size={16} aria-hidden="true" />}>New folder</SatButton>
                </div>
              }
            />
          )}
        </div>
      </LibraryDragProvider>

      <CreateSatExamSheet open={createOpen} onClose={() => setCreateOpen(false)} folderId={createFolderId} />
      <FolderCreateDialog
        open={folderCreateParent !== undefined}
        parentName={folderCreateParent ? (folders.find((folder) => folder.id === folderCreateParent)?.name ?? null) : null}
        onClose={() => { createFolder.reset(); setFolderCreateParent(undefined); }}
        onCreate={(name) => void runCreateFolder(name)}
        pending={createFolder.isPending}
        serverError={folderCreateError}
      />
      <FolderRenameDialog
        key={renameTarget ?? 'closed'}
        folder={renameFolderRow}
        onClose={() => setRenameTarget(null)}
        onRename={(name) => void runRenameFolder(name)}
        pending={renameFolder.isPending}
        serverError={renameError}
      />
      {moveFolderRow ? (
        <FolderMoveDialog
          open
          folders={folderMoveDestinations}
          currentParentId={moveFolderRow.parentId ?? null}
          onClose={() => setMoveFolderTarget(null)}
          onMove={(parentId) => void runMoveFolder(parentId)}
          pending={moveFolder.isPending}
          serverError={moveFolderError}
          title={`Move ${moveFolderRow.name} to`}
        />
      ) : null}
      <FolderDeleteDialog
        folder={deleteFolderRow}
        examCount={deleteExamCount}
        childFolderCount={deleteChildFolderCount}
        onClose={() => {
          if (!deleteFolder.isPending) {
            setDeleteTarget(null);
            setDeleteFolderError(null);
          }
        }}
        onConfirm={() => void runDeleteFolder()}
        pending={deleteFolder.isPending}
        serverError={deleteFolderError}
      />
      <ExamMoveDialog
        open={examMoveOpen || singleMoveExam !== null}
        folders={moveDestinations}
        count={moveTargetExams.length}
        compatible={moveCompatible && moveTargetExams.length > 0}
        initialDestination={examInitialDestination}
        onClose={() => {
          createFolder.reset();
          setExamMoveOpen(false);
          setSingleMoveExam(null);
          setExamMoveError(null);
        }}
        onMove={(folderId) => void runMoveExams(folderId)}
        onNewFolder={runNewFolderFromMove}
        pending={moveExams.isPending || createFolder.isPending}
        serverError={examMoveError}
      />
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
