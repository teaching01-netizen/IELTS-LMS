import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, BookOpen, Plus, SearchX } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { SAT_ROW_STACK, SatButton, SatField, SatInlineError, SatListColumns } from '../ui/SatPage';
import { useAuthSession } from '../../../features/auth/authSession';
import { invalidateExamList, useExamListQuery } from '../../../features/exam-authoring/api/examQueries';
import { examAuthoringFacade } from '../../../features/exam-authoring/api/examAuthoringFacade';
import { requestAuthoringDraftOnEntry } from '../../../features/exam-authoring/api/authoringEntryIntent';
import type { ExamEntity } from '../../../types/domain';
import { satPublishScopeCopy } from '../../../features/exam-authoring/ui/release/releaseSelectors';
import { SatConfirmDialog, SatFormDialog, isSatCreationDirty } from '../ui/ConfirmDialog';
import { useSatExamConfigDefaults } from '../../../features/exam-authoring/api/satExamConfigApi';
import { satExamConfigDiffers, validateSatExamConfig, type SatConfigFieldErrors, type SatExamConfig } from '../../../features/exam-authoring/contracts/satExamConfig';
import { SatExamConfigFields } from '../../../features/exam-authoring/ui/create-exam/SatExamConfigFields';
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
 * One grid for the column labels and every row, so Exam / Status / Updated
 * align. The trailing column is wide enough for a published exam's explicit
 * Edit control AND the chevron, and it is reserved on every row (and in the
 * header) so a row with a control never shifts its neighbours' columns.
 */
const ROW_GRID = 'grid-cols-[minmax(0,1fr)_16px] gap-x-4 md:grid-cols-[minmax(0,1fr)_224px_120px_140px]';

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
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { session } = useAuthSession();
  const query = useExamListQuery(true, 'sat', false);
  const { params, setParams } = useSatListParams();
  const search = params.q ?? '';
  const tab: SatLibraryTab = params.tab ?? 'active';
  const sort: LibrarySort = params.sort === 'title' ? 'title' : 'updated';
  const [creating, setCreating] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [confirmDiscardExam, setConfirmDiscardExam] = useState(false);
  const [title, setTitle] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);
  const [customize, setCustomize] = useState(false);
  const [config, setConfig] = useState<SatExamConfig | null>(null);
  const [configErrors, setConfigErrors] = useState<SatConfigFieldErrors>({});
  const defaultsQuery = useSatExamConfigDefaults(createOpen);
  const inputRef = useRef<HTMLInputElement | null>(null);
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

  // Focus the name field once the dialog (Radix portal) has mounted.
  // The frame is cancelled on fast close/unmount — no setState, no leak.
  useEffect(() => {
    if (!createOpen) return;
    const frame = window.requestAnimationFrame(() => inputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [createOpen]);

  const openCreate = () => {
    setTitle('');
    setCreateError(null);
    setCustomize(false);
    setConfig(null);
    setConfigErrors({});
    setCreateOpen(true);
  };
  // Customizing seeds the form from the server defaults once; toggling back and
  // forth keeps what was typed.
  useEffect(() => {
    if (customize && !config && defaultsQuery.data) setConfig(defaultsQuery.data.config);
  }, [customize, config, defaultsQuery.data]);
  const examDirty = isSatCreationDirty({ title }) || customize;
  const requestExamClose = () => {
    if (creating) return;
    if (examDirty) setConfirmDiscardExam(true);
    else setCreateOpen(false);
  };

  const createExam = async (event: FormEvent) => {
    event.preventDefault();
    const nextTitle = title.trim();
    if (!nextTitle || creating) return;
    // Only a customized, changed configuration is sent: otherwise the server's
    // blueprint defaults apply, exactly as before.
    let configuration: SatExamConfig | undefined;
    if (customize && config && defaultsQuery.data) {
      const errors = validateSatExamConfig(config, defaultsQuery.data.limits);
      setConfigErrors(errors);
      if (Object.keys(errors).length > 0) return;
      if (satExamConfigDiffers(config, defaultsQuery.data.config)) configuration = config;
    }
    setCreating(true);
    setCreateError(null);
    try {
      const actor = session?.user.displayName?.trim() || session?.user.email || 'Staff';
      const result = await examAuthoringFacade.lifecycle.createProviderExam(
        { providerKey: 'sat', providerExamType: 'SAT', title: nextTitle, ...(configuration ? { configuration } : {}) },
        actor,
      );
      if (!result.success || !result.exam) throw new Error(result.error ?? 'The exam could not be created.');
      await invalidateExamList(queryClient);
      setCreateOpen(false);
      navigate('/sat/exams/' + result.exam.id);
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : 'The exam could not be created.');
    } finally {
      setCreating(false);
    }
  };

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
            className="sm:max-w-[480px]"
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
        <SatResultCount total={counts[tab]} visible={exams.length} itemLabel={exams.length === 1 ? 'exam' : 'exams'} />
        <SatList>
          <SatListColumns gridClassName={ROW_GRID} columns={[{ label: 'Exam' }, { label: 'Status' }, { label: 'Updated', align: 'end' }, { label: '' }]} />
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
                  <span className="min-w-0">
                    <span className="block truncate text-[14px] font-semibold leading-5 tracking-[-0.01em] text-[var(--sat-staff-text-primary,#1d1d1f)]">{exam.title}</span>
                    <span className="block truncate text-[14px] leading-5 tabular-nums text-[var(--sat-staff-text-secondary,#515154)]">{exam.totalQuestions ?? 0} questions{exam.currentPublishedVersionId ? ` · ${satPublishScopeCopy(exam.currentPublishedScope ?? 'full')}` : ''}<span className="md:hidden"> · Updated {formatDate(exam.updatedAt)}</span></span>
                  </span>
                  <span className={SAT_ROW_STACK.status}><SatStatusPill tone={tone}>{status}</SatStatusPill></span>
                  <span className="hidden text-right text-[14px] leading-5 tabular-nums text-[var(--sat-staff-text-secondary,#515154)] md:block">{formatDate(exam.updatedAt)}</span>
                  <span className={'flex items-center justify-end gap-2 ' + SAT_ROW_STACK.chevron}>
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

      <SatFormDialog open={createOpen} eyebrow="Digital SAT" title="Create exam" onClose={requestExamClose}>
        <form onSubmit={createExam} noValidate>
          <div className="max-h-[70vh] space-y-4 overflow-y-auto px-6 py-5">
            <SatField id="sat-title" label="Exam name" error={createError} help="Reading & Writing, Math, adaptive modules, and the SAT tool policy are created with the exam.">
              {(control) => (
                <input ref={inputRef} {...control} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Practice Test 06" maxLength={255} autoComplete="off" className="sat-input" />
              )}
            </SatField>
            <div>
              <p className="text-[14px] font-semibold text-[var(--sat-staff-text-primary,#1d1d1f)]">Standard Digital SAT settings</p>
              <p className="mt-0.5 text-[14px] leading-5 text-[var(--sat-staff-text-secondary,#515154)]">You can change exam settings later in Settings. Rooms already created keep their exam content and timing.</p>
              <button
                type="button"
                aria-expanded={customize}
                aria-controls="sat-exam-config"
                disabled={creating || !defaultsQuery.data}
                onClick={() => setCustomize((open) => !open)}
                className="sat-btn sat-btn--quiet sat-press mt-2 px-0"
              >
                {customize ? 'Use standard settings' : 'Customize settings'}
              </button>
              {defaultsQuery.error ? <p role="alert" className="text-[14px] text-[var(--sat-staff-danger,#b42318)]">Settings could not load. The standard settings will be used.</p> : null}
            </div>
            {customize && config && defaultsQuery.data ? (
              <div id="sat-exam-config">
                <SatExamConfigFields idPrefix="sat-create" value={config} limits={defaultsQuery.data.limits} errors={configErrors} disabled={creating} onChange={setConfig} />
              </div>
            ) : null}
          </div>
          <div className="flex justify-end gap-2 border-t border-[var(--sat-staff-border-hairline,rgba(0,0,0,0.06))] px-6 py-4">
            <SatButton variant="quiet" onClick={requestExamClose}>Cancel</SatButton>
            <SatButton variant="primary" type="submit" disabled={!title.trim()} pending={creating}>{creating ? 'Creating…' : 'Create'}</SatButton>
          </div>
        </form>
      </SatFormDialog>
      {confirmDiscardExam ? <SatConfirmDialog open title="Discard this exam?" description="The name you entered will be lost." confirmLabel="Discard" destructive onCancel={() => setConfirmDiscardExam(false)} onConfirm={() => { if (creating) return; setConfirmDiscardExam(false); setCreateOpen(false); }} /> : null}
    </SatContainer>
  );
}
