import { useEffect, useId, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import { Archive, ArrowDown, ArrowRight, ArrowUp, BookOpen, ChevronsUpDown, DoorOpen, FileText, Folder, Layers, MoreHorizontal, Pencil, Plus, SearchX, Trash2 } from 'lucide-react';
import { SatButton, SatInlineError, SatBreadcrumbs } from '../ui/SatPage';
import { useBulkDeleteExamsMutation, useExamListQuery } from '../../../features/exam-authoring/api/examQueries';
import { useAuthSession } from '../../../features/auth/authSession';
import { SatConfirmDialog } from '../ui/ConfirmDialog';
import { SatMenu } from '../ui/Menu';
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
import { useSatLibraryQuery, useCreateFolderMutation, useRenameFolderMutation, useMoveFolderMutation, useDeleteFolderMutation, useMoveExamsMutation } from '../library/queries';
import { ancestorsOf, childrenOf, descendantIds, folderIdOf } from '../library/types';
import { FolderTree } from '../library/FolderTree';
import { ExamMoveDialog, FolderCreateDialog, FolderDeleteDialog, FolderMoveDialog, FolderRenameDialog } from '../library/FolderDialogs';
import { ExamDragHandle, FolderDragHandle, LibraryDragProvider, LibraryDroppable, folderFromDropTarget } from '../library/LibraryDnD';

type LibrarySort = 'updated' | 'title';
type ExamType = 'classroom' | 'practice';

const EXAM_TYPE_LABEL: Record<ExamType, string> = { classroom: 'Classroom', practice: 'Practice' };
const examTypeOf = (exam: ExamEntity): ExamType => (exam.satCustomModules ? 'classroom' : 'practice');

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

// Frontend scope compatibility: normalized provider + organization compared
// distinctly, never the same sentinel for nil platform vs explicit "platform".
// Nil/blank org is platform:nil, an explicit org (even named "platform") is
// org:<exact>. Case-sensitive to match the backend tagged hash.
function scopeTag(provider: string | undefined, org: string | null | undefined): string {
  const p = (provider ?? 'sat').toLowerCase().trim() || 'sat';
  const o = (org ?? '').trim();
  if (o === '') return `${p}|platform:nil`;
  return `${p}|org:${o}`;
}

function folderHref(id: string | null | 'all'): string {
  if (id === null) return '/sat/exams';
  if (id === 'all') return '/sat/exams?folder=all';
  return `/sat/exams?folder=${encodeURIComponent(id)}`;
}

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

const ROW_GRID = 'grid-cols-[24px_44px_minmax(0,1fr)_44px] gap-x-3 @min-[820px]/list:grid-cols-[24px_44px_minmax(0,1fr)_168px_112px_132px] @min-[820px]/list:gap-x-4';
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
  if (tone === 'published') return 'Rooms available';
  if (tone === 'archived') return 'Archived';
  return 'Editing';
}

export function SatExamLibraryRoute() {
  const query = useExamListQuery(true, 'sat', false);
  const library = useSatLibraryQuery(true);
  const libraryLoading = library.isLoading;
  const libraryError = library.error ? (library.error instanceof Error ? library.error.message : 'The exam library is unavailable.') : null;
  const libraryLoaded = !libraryLoading && !libraryError && Boolean(library.data);
  // Fail closed: until BOTH authoritative queries load, gate folder/exam
  // content and mutations. Missing library data must never render filed exams
  // as unfiled.
  const folders = useMemo(() => (libraryLoaded ? (library.data?.folders ?? []) : []), [libraryLoaded, library.data]);
  const entriesByExam = useMemo(() => (libraryLoaded ? (library.data?.byExam ?? {}) : {}), [libraryLoaded, library.data]);
  const { params, setParams } = useSatListParams();
  const search = params.q ?? '';
  const tab: SatLibraryTab = params.tab ?? 'active';
  const sort: LibrarySort = params.sort === 'title' ? 'title' : 'updated';
  const folderParam = params.folder;
  const activeFolderId = folderParam === 'all' ? 'all' : (folderParam ?? null);
  const activeFolder = typeof activeFolderId === 'string' && activeFolderId !== 'all'
    ? (folders.find((folder) => folder.id === activeFolderId) ?? null)
    : null;
  const activeIsAll = activeFolderId === 'all';
  // Unknown/deleted folder URLs fail closed: show Folder unavailable instead of
  // silently pretending the user is at root.
  const unknownFolder = typeof activeFolderId === 'string' && activeFolderId !== 'all' && !activeFolder && libraryLoaded;
  const effectiveFolderId: string | null | 'all' = unknownFolder ? null : activeFolderId;
  const effectiveFolder = typeof effectiveFolderId === 'string' && effectiveFolderId !== 'all'
    ? (folders.find((folder) => folder.id === effectiveFolderId) ?? null)
    : null;
  const locationKnown = libraryLoaded && !unknownFolder;

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
  // Folder scoping: root shows unfiled exams (missing entry = root), a folder
  // shows its direct members, All exams searches across folders. Gated on
  // libraryLoaded so filed exams never flash as unfiled while loading.
  const folderScoped = useMemo(() => {
    if (!libraryLoaded || unknownFolder) return [] as typeof allSatExams;
    if (effectiveFolderId === 'all') return allSatExams;
    if (effectiveFolderId === null) return allSatExams.filter((exam) => folderIdOf(entriesByExam, exam.id) === null);
    return allSatExams.filter((exam) => folderIdOf(entriesByExam, exam.id) === effectiveFolderId);
  }, [allSatExams, effectiveFolderId, entriesByExam, libraryLoaded, unknownFolder]);
  const typeCounts = useMemo(() => {
    const classroom = folderScoped.filter((exam) => examTypeOf(exam) === 'classroom').length;
    return { classroom, practice: folderScoped.length - classroom };
  }, [folderScoped]);
  const satExams = useMemo(() => folderScoped.filter((exam) => examTypeOf(exam) === examType), [folderScoped, examType]);
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
  const childFolders = useMemo(() => {
    if (!libraryLoaded || unknownFolder) return [] as typeof folders;
    const parent = effectiveFolderId === 'all' ? null : effectiveFolderId;
    if (effectiveFolderId === 'all') return [] as typeof folders;
    const needle = search.trim().toLocaleLowerCase();
    return childrenOf(folders, parent).filter((folder) => !needle || folder.name.toLocaleLowerCase().includes(needle));
  }, [folders, effectiveFolderId, search, libraryLoaded, unknownFolder]);
  const crumbs = useMemo(() => {
    if (effectiveFolderId === 'all') {
      return [
        { label: 'Library', href: folderHref(null), onSelect: () => setParams({ folder: '' }, { replace: false }) },
        { label: 'All exams' },
      ];
    }
    const chain = effectiveFolder ? ancestorsOf(folders, effectiveFolder.id) : [];
    return [
      ...(chain.length > 0 || effectiveFolder
        ? [{ label: 'Library', href: folderHref(null), onSelect: () => setParams({ folder: '' }, { replace: false }) }]
        : [{ label: 'Library' }]),
      ...chain.slice(0, -1).map((folder) => ({ label: folder.name, href: folderHref(folder.id), onSelect: () => setParams({ folder: folder.id }, { replace: false }) })),
      ...(effectiveFolder ? [{ label: effectiveFolder.name }] : []),
    ];
  }, [effectiveFolder, effectiveFolderId, folders, setParams]);
  const heading = effectiveFolderId === 'all' ? 'All exams' : effectiveFolder ? effectiveFolder.name : 'Library';
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [foldersOpen, setFoldersOpen] = useState(false);
  // Deep-link/Back into a nested folder expands its ancestor path.
  const [expandedPaths, setExpandedPaths] = useState<ReadonlySet<string>>(() => new Set());
  useEffect(() => {
    if (!effectiveFolder || effectiveFolderId === 'all') return;
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      for (const folder of ancestorsOf(folders, effectiveFolder.id)) next.add(folder.id);
      return next;
    });
  }, [effectiveFolder, effectiveFolderId, folders]);
  const { lastOpenedId, openRecord } = useSatListReturn(!query.isLoading);
  const setSearch = (value: string) => setParams({ q: value });
  // Central navigation callback clears selection consistently, including
  // breadcrumbs and Back. Notices clear so a new location never shows a stale
  // receipt.
  const openFolder = (id: string | null | 'all') => {
    setPicked(new Set());
    setNotice(null);
    if (id === null) setParams({ folder: '' }, { replace: false });
    else if (id === 'all') setParams({ folder: 'all' }, { replace: false });
    else setParams({ folder: id }, { replace: false });
  };

  const bulkDelete = useBulkDeleteExamsMutation();
  const [picked, setPicked] = useState<ReadonlySet<string>>(() => new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  useEffect(() => {
    setPicked(new Set());
    setNotice(null);
    setFoldersOpen(false);
  }, [folderParam]);
  const selectAllRef = useRef<HTMLInputElement>(null);
  const checkboxId = useId();
  const selectedExams = useMemo(() => exams.filter((exam) => picked.has(exam.id)), [exams, picked]);
  const selectedIds = selectedExams.map((exam) => exam.id);
  const allSelected = exams.length > 0 && selectedIds.length === exams.length;
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

  const openCreate = () => {
    if (!locationKnown) {
      setNotice({ tone: 'error', text: 'The library is still loading. Try again.' });
      return;
    }
    setCreateOpen(true);
  };
  const createFolderId = effectiveFolderId === 'all' || effectiveFolderId === null ? null : effectiveFolderId;

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
  const [examMoveOpen, setExamMoveOpen] = useState(false);
  const [examMoveError, setExamMoveError] = useState<string | null>(null);
  const [singleMoveExam, setSingleMoveExam] = useState<ExamEntity | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  const renameFolderRow = folders.find((folder) => folder.id === renameTarget) ?? null;
  const moveFolderRow = folders.find((folder) => folder.id === moveFolderTarget) ?? null;
  const deleteFolderRow = folders.find((folder) => folder.id === deleteTarget) ?? null;
  const deleteExamCount = deleteTarget ? allSatExams.filter((exam) => folderIdOf(entriesByExam, exam.id) === deleteTarget).length : 0;

  const runCreateFolder = async (name: string) => {
    if (!locationKnown) {
      setFolderCreateError('The library is still loading. Try again.');
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
      setNotice({ tone: 'ok', text: parentId ? `Created folder ${created.name}.` : `Created folder ${created.name} in the Library.` });
      headingRef.current?.focus?.();
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
    try {
      await moveFolder.mutateAsync({ id: moveFolderRow.id, parentId, revision: moveFolderRow.revision });
      setMoveFolderTarget(null);
      returnFocusRef.current?.focus();
    } catch (error) {
      setMoveFolderError(error instanceof Error ? error.message : 'The folder could not be moved.');
    }
  };
  const runDeleteFolder = async () => {
    if (!deleteFolderRow || deleteFolder.isPending) return;
    try {
      await deleteFolder.mutateAsync({ id: deleteFolderRow.id, revision: deleteFolderRow.revision });
      setDeleteTarget(null);
      if (effectiveFolderId === deleteFolderRow.id) openFolder(null);
      returnFocusRef.current?.focus();
    } catch (error) {
      setNotice({ tone: 'error', text: error instanceof Error ? error.message : 'The folder could not be deleted.' });
      setDeleteTarget(null);
    }
  };
  const moveTargetExams = useMemo(
    () => (singleMoveExam ? [singleMoveExam] : selectedExams),
    [singleMoveExam, selectedExams],
  );
  const moveCompatible = useMemo(() => {
    const scopes = new Set(moveTargetExams.map((exam) => scopeTag(exam.providerKey, exam.organizationId)));
    return scopes.size <= 1;
  }, [moveTargetExams]);
  const moveTargetScope = useMemo(
    () => (moveTargetExams.length ? scopeTag(moveTargetExams[0]?.providerKey, moveTargetExams[0]?.organizationId) : null),
    [moveTargetExams],
  );
  const moveDestinations = useMemo(() => {
    if (!moveTargetScope) return folders;
    return folders.filter((folder) => scopeTag(folder.providerKey, folder.organizationId ?? null) === moveTargetScope);
  }, [folders, moveTargetScope]);
  const folderMoveDestinations = useMemo(() => {
    if (!moveFolderRow) return folders;
    const excluded = descendantIds(folders, moveFolderRow.id);
    excluded.add(moveFolderRow.id);
    const scope = scopeTag(moveFolderRow.providerKey, moveFolderRow.organizationId ?? null);
    return folders.filter((folder) => !excluded.has(folder.id) && scopeTag(folder.providerKey, folder.organizationId ?? null) === scope);
  }, [folders, moveFolderRow]);
  const runMoveExams = async (folderId: string | null) => {
    if (!locationKnown) {
      setExamMoveError('The library is still loading. Try again.');
      return;
    }
    setExamMoveError(null);
    const items = moveTargetExams.map((exam) => ({ examId: exam.id, revision: entriesByExam[exam.id]?.revision ?? 0 }));
    try {
      await moveExams.mutateAsync({ items, folderId });
      setPicked(new Set());
      setSingleMoveExam(null);
      setExamMoveOpen(false);
      setNotice({ tone: 'ok', text: folderId ? `Moved ${plural(items.length)}.` : `Moved ${plural(items.length)} to the Library.` });
      headingRef.current?.focus?.();
    } catch (error) {
      setExamMoveError(error instanceof Error ? error.message : 'The exams could not be moved. Try again.');
    }
  };
  const runNewFolderFromMove = async (name: string, parentId: string | null) => {
    if (!locationKnown) {
      setExamMoveError('The library is still loading. Try again.');
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
    const destScope = parentId ? folders.find((f) => f.id === parentId) ?? null : null;
    if (destScope && contextExam && scopeTag(destScope.providerKey, destScope.organizationId ?? null) !== scopeTag(contextExam.providerKey, contextExam.organizationId)) {
      setExamMoveError('Selected exams and the destination folder belong to different libraries.');
      return null;
    }
    try {
      const created = await createFolder.mutateAsync({
        name: trimmed,
        ...(parentId ? { parentId } : { parentId: null }),
        ...(contextExam && !parentId ? { contextExamId: contextExam.id } : {}),
      });
      await runMoveExams(created.id);
      return created.id;
    } catch (error) {
      setExamMoveError(error instanceof Error ? error.message : 'The folder could not be created.');
      return null;
    }
  };

  const canDrop = (sourceId: string, targetId: string): boolean => {
    if (!locationKnown || moveExams.isPending || moveFolder.isPending || bulkDelete.isPending) return false;
    const destination = folderFromDropTarget(targetId);
    if (destination === undefined) return false;
    const target = destination ? folders.find((folder) => folder.id === destination) : null;
    if (destination && !target) return false;
    if (sourceId.startsWith('exam:')) {
      const source = exams.find((exam) => exam.id === sourceId.slice(5));
      if (!source) return false;
      const batch = picked.has(source.id) ? selectedExams : [source];
      const scope = scopeTag(source.providerKey, source.organizationId);
      if (batch.some((exam) => scopeTag(exam.providerKey, exam.organizationId) !== scope)) return false;
      if (target && scopeTag(target.providerKey, target.organizationId) !== scope) return false;
      return batch.some((exam) => folderIdOf(entriesByExam, exam.id) !== destination);
    }
    if (sourceId.startsWith('folder:')) {
      const source = folders.find((folder) => folder.id === sourceId.slice(7));
      if (!source || destination === source.id || (source.parentId ?? null) === destination) return false;
      if (target && scopeTag(target.providerKey, target.organizationId) !== scopeTag(source.providerKey, source.organizationId)) return false;
      return destination === null || !descendantIds(folders, source.id).has(destination);
    }
    return false;
  };
  const handleDrop = (sourceId: string, targetId: string) => {
    if (!canDrop(sourceId, targetId)) return;
    const destination = folderFromDropTarget(targetId);
    if (destination === undefined) return;
    if (sourceId.startsWith('exam:')) {
      const source = exams.find((exam) => exam.id === sourceId.slice(5));
      if (!source) return;
      const batch = picked.has(source.id) ? selectedExams : [source];
      const items = batch.map((exam) => ({ examId: exam.id, revision: entriesByExam[exam.id]?.revision ?? 0 }));
      moveExams.mutate({ items, folderId: destination }, {
        onSuccess: () => {
          setPicked(new Set());
          setNotice({ tone: 'ok', text: destination ? `Moved ${plural(items.length)}.` : `Moved ${plural(items.length)} to the Library.` });
          headingRef.current?.focus();
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
          headingRef.current?.focus();
        },
        onError: (error) => setNotice({ tone: 'error', text: error.message }),
      });
    }
  };

  const loadError = query.error
    ? (query.error instanceof Error ? query.error.message : 'The exam library is unavailable.')
    : libraryError;

  return (
    <SatContainer measure="full" className="@container/library">
      <SatPageHeader
        title="Exams"
        description="Author Digital SAT practice exams and prepare rooms. Changes are saved automatically."
        actions={<SatButton variant="primary" onClick={openCreate} icon={<Plus size={16} aria-hidden="true" />}>Create exam</SatButton>}
      />
      <div className="mt-3">
        <SatBreadcrumbs items={crumbs} />
      </div>

      <div className="mt-6 overflow-x-auto">
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

      <LibraryDragProvider onDrop={handleDrop} canDrop={canDrop}>
        <div className="mt-4 flex flex-col gap-4 @min-[1080px]/library:flex-row @min-[1080px]/library:items-start">
          <div className="shrink-0 @min-[1080px]/library:w-60">
            <button
              type="button"
              className="flex min-h-11 w-full items-center justify-between rounded-[10px] border border-[var(--sat-staff-border-hairline,rgba(0,0,0,0.06))] bg-[var(--sat-staff-surface,#fff)] px-3 text-[14px] font-semibold @min-[1080px]/library:hidden"
              aria-expanded={foldersOpen}
              aria-controls="sat-folder-tree"
              onClick={() => setFoldersOpen((v) => !v)}
            >
              Browse folders
              <ChevronsUpDown size={14} aria-hidden="true" />
            </button>
            <div id="sat-folder-tree" className={clsx(foldersOpen ? 'mt-2 block' : 'mt-2 hidden', '@min-[1080px]/library:mt-0 @min-[1080px]/library:block')}>
              <FolderTree
                folders={locationKnown ? folders : []}
                activeId={effectiveFolderId}
                onOpen={openFolder}
                onNewFolder={() => {
                  if (!locationKnown) {
                    setNotice({ tone: 'error', text: 'The library is still loading. Try again.' });
                    return;
                  }
                  setFolderCreateError(null);
                  setFolderCreateParent(effectiveFolderId === 'all' || effectiveFolderId === null ? null : effectiveFolderId);
                }}
                expandedIds={expandedPaths}
              />
            </div>
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <h2
                ref={headingRef}
                tabIndex={-1}
                className="text-[length:var(--sat-staff-type-section-size,20px)] font-semibold leading-[var(--sat-staff-type-section-line,28px)] tracking-[-0.015em] text-[var(--sat-staff-text-primary,#1d1d1f)] outline-none"
              >
                {heading}
              </h2>
              <p className="text-[14px] font-medium leading-5 text-[var(--sat-staff-text-secondary,#515154)]">{EXAM_TYPE_LABEL[examType]} exams</p>
            </div>
            <div className="mt-3 overflow-x-auto">
              <SatSegmentedControl<SatLibraryTab>
                label="Exam status"
                value={tab}
                options={LIBRARY_GROUPS.map((g) => ({ value: g.value, label: g.label, count: counts[g.value] }))}
                onChange={(next) => setParams({ tab: next === 'active' ? '' : next })}
              />
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
            {unknownFolder ? (
              <SatInlineError
                title="Folder unavailable"
                description="This folder was deleted or you no longer have access to it."
                onRetry={() => openFolder(null)}
                retryLabel="Return to Library"
              />
            ) : null}
            {childFolders.length > 0 && !activeIsAll && locationKnown ? (
              <ul aria-label="Subfolders" className="mt-3 grid list-none grid-cols-1 gap-2 p-0 sm:grid-cols-2">
                {childFolders.map((folder) => (
                  <li key={folder.id}>
                    <LibraryDroppable id={`folder:${folder.id}`} label={`Drop into ${folder.name}`}>
                      <div className="flex min-h-11 items-center gap-1 rounded-[12px] border border-[var(--sat-staff-border-hairline,rgba(0,0,0,0.06))] bg-[var(--sat-staff-surface,#fff)] px-2">
                        <FolderDragHandle folderId={folder.id} name={folder.name} />
                        <a
                          href={folderHref(folder.id)}
                          onClick={(event) => {
                            if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                            event.preventDefault();
                            openFolder(folder.id);
                          }}
                          className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-[8px] px-1 text-left text-[14px] font-semibold leading-5 text-[var(--sat-staff-text-primary,#1d1d1f)]"
                        >
                          <Folder size={16} aria-hidden="true" className="shrink-0 text-[var(--sat-staff-text-tertiary,#6e6e73)]" />
                          <span className="min-w-0 flex-1 truncate">{folder.name}</span>
                        </a>
                        <span className={SAT_ROW_ACTION_CLASS}>
                          <SatMenu
                            modal={false}
                            label={`Actions for ${folder.name}`}
                            compact
                            icon={MoreHorizontal}
                            items={[
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
                                  setDeleteTarget(folder.id);
                                },
                              },
                            ]}
                          />
                        </span>
                      </div>
                    </LibraryDroppable>
                  </li>
                ))}
              </ul>
            ) : null}
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
          </div>
        </div>
        <div className="@container/list min-w-0">
          {loadError ? (
              <SatInlineError title={libraryError ? 'Library could not load' : 'Exams could not load'} description={loadError} onRetry={() => { void query.refetch(); void library.refetch(); }} />
            ) : query.isLoading || libraryLoading ? (
              <SatListSkeleton rows={5} label="Loading exams" />
            ) : unknownFolder ? null : exams.length || childFolders.length ? (
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
                      <SatButton variant="secondary" disabled={!locationKnown} onClick={() => { setExamMoveError(null); setSingleMoveExam(null); setExamMoveOpen(true); }}>
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
                    </div>
                  ) : null}
                </div>
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
                    const hasPublishedVersion = Boolean(exam.currentPublishedVersionId);
                    const primaryPath = hasPublishedVersion
                      ? `/sat/exams/${exam.id}/access`
                      : `/sat/exams/${exam.id}`;
                    const openPrimary = () => {
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
                              if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                              event.preventDefault();
                              openPrimary();
                            }}
                          />
                        }
                      >
                        <span className={'grid w-full items-center py-3 ' + ROW_GRID}>
                          <span className={ROW_CELL.select + ' flex items-center gap-1'}>
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
                          <span className={ROW_CELL.art}>
                            <ExamDragHandle examId={exam.id} title={exam.title}>
                              <span className="flex h-8 w-8 items-center justify-center rounded-[10px] border border-[var(--sat-staff-border-hairline,rgba(0,0,0,0.06))] bg-[var(--sat-staff-fill-faint,rgba(0,0,0,0.035))] text-[var(--sat-staff-text-tertiary,#6e6e73)]">
                                {hasPublishedVersion ? <DoorOpen size={16} aria-hidden="true" /> : <FileText size={16} aria-hidden="true" />}
                              </span>
                            </ExamDragHandle>
                          </span>
                          <span className={ROW_CELL.title}>
                            <span className="block break-words text-[14px] font-semibold leading-5 tracking-[-0.01em] text-[var(--sat-staff-text-primary,#1d1d1f)]">{exam.title}</span>
                            <span className="block truncate text-[14px] leading-5 tabular-nums text-[var(--sat-staff-text-secondary,#515154)]">{examMeta(exam)}<span className="@min-[820px]/list:hidden"> · Updated {formatDate(exam.updatedAt)}</span></span>
                          </span>
                          <span className={ROW_CELL.status}><SatStatusPill tone={tone}>{status}</SatStatusPill></span>
                          <span className={clsx('hidden text-right text-[14px] leading-5 tabular-nums text-[var(--sat-staff-text-secondary,#515154)] @min-[820px]/list:block', ROW_CELL.updated)}>{formatDate(exam.updatedAt)}</span>
                          <span className={'flex items-center justify-end gap-1 ' + ROW_CELL.chevron}>
                            <span className={SAT_ROW_ACTION_CLASS}>
                              <SatMenu
                                modal={false}
                                label={`Actions for ${exam.title}`}
                                compact
                                icon={MoreHorizontal}
                                items={[
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
                                      }]
                                    : []),
                                ]}
                              />
                            </span>
                            {hasPublishedVersion ? (
                              <a
                                href={`/sat/exams/${exam.id}`}
                                aria-label={`Edit ${exam.title}`}
                                className={`sat-btn sat-btn--secondary sat-press hidden min-h-11 px-3 @min-[820px]/list:inline-flex ${SAT_ROW_ACTION_CLASS}`}
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
                            <ArrowRight size={16} className={clsx('sat-row-chevron hidden shrink-0 text-slate-400 group-hover:text-slate-500 @min-[820px]/list:block', hasPublishedVersion && 'hidden @min-[820px]/list:block')} aria-hidden="true" />
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
                title={childFolders.length ? 'No exams here yet' : 'No exams yet'}
                hint={childFolders.length
                  ? 'Create an exam in this folder, or open a subfolder.'
                  : 'Create an exam. The standard Digital SAT structure — Reading & Writing and Math, with adaptive modules — is ready immediately.'}
                action={<SatButton variant="primary" onClick={openCreate} icon={<Plus size={16} aria-hidden="true" />}>Create exam</SatButton>}
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
          movingId={moveFolderRow.id}
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
        onClose={() => { if (!deleteFolder.isPending) setDeleteTarget(null); }}
        onConfirm={() => void runDeleteFolder()}
        pending={deleteFolder.isPending}
      />
      <ExamMoveDialog
        open={examMoveOpen || singleMoveExam !== null}
        folders={moveDestinations}
        count={moveTargetExams.length}
        compatible={moveCompatible && moveTargetExams.length > 0}
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
