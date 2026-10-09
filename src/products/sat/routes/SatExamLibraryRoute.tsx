import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Plus } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { SatPageError } from '../ui/SatPage';
import { useAuthSession } from '../../../features/auth/authSession';
import { invalidateExamList, useExamListQuery } from '../../../features/exam-authoring/api/examQueries';
import { examAuthoringFacade } from '../../../features/exam-authoring/api/examAuthoringFacade';
import { requestAuthoringDraftOnEntry } from '../../../features/exam-authoring/api/authoringEntryIntent';
import type { ExamEntity } from '../../../types/domain';
import { satPublishScopeCopy } from '../../../features/exam-authoring/ui/release/releaseSelectors';
import { SatConfirmDialog, SatFormDialog, isSatCreationDirty } from '../ui/ConfirmDialog';
import { SatSegmentedControl } from '../ui/SegmentedControl';
import { useSatListParams, type SatLibraryTab } from '../ui/useSatListParams';
import { useSatListReturn } from '../ui/useSatListReturn';
import {
  SatContainer,
  SatEmptyState,
  SatList,
  SatListRow,
  SatListSkeleton,
  SatListToolbar,
  SatPageHeader,
  SatPrimaryButton,
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

const TAB_NOUN: Record<SatLibraryTab, string> = { active: 'active', drafts: 'draft', published: 'published', archived: 'archived' };

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
  if (tone === 'published') {
    const version = exam.currentPublishedVersionNumber;
    return version ? `Published · Version ${version}` : 'Published';
  }
  if (tone === 'changes') return 'Unpublished changes';
  if (tone === 'archived') return 'Archived';
  return 'Draft';
}

export function SatExamLibraryRoute() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { session } = useAuthSession();
  const query = useExamListQuery(true, 'sat');
  const { params, setParams } = useSatListParams();
  const search = params.q ?? '';
  const tab: SatLibraryTab = params.tab ?? 'active';
  const sort: LibrarySort = params.sort === 'title' ? 'title' : 'updated';
  const [creating, setCreating] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [confirmDiscardExam, setConfirmDiscardExam] = useState(false);
  const [title, setTitle] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);
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
    setCreateOpen(true);
  };
  const examDirty = isSatCreationDirty({ title });
  const requestExamClose = () => {
    if (creating) return;
    if (examDirty) setConfirmDiscardExam(true);
    else setCreateOpen(false);
  };

  const createExam = async (event: FormEvent) => {
    event.preventDefault();
    const nextTitle = title.trim();
    if (!nextTitle || creating) return;
    setCreating(true);
    setCreateError(null);
    try {
      const actor = session?.user.displayName?.trim() || session?.user.email || 'Staff';
      const result = await examAuthoringFacade.lifecycle.createProviderExam(
        { providerKey: 'sat', providerExamType: 'SAT', title: nextTitle },
        actor,
      );
      if (!result.success || !result.exam) throw new Error(result.error ?? 'The SAT could not be created.');
      await invalidateExamList(queryClient);
      setCreateOpen(false);
      navigate('/sat/exams/' + result.exam.id);
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : 'The SAT could not be created.');
    } finally {
      setCreating(false);
    }
  };

  if (query.error) return <SatPageError title="Tests could not load" description={query.error instanceof Error ? query.error.message : 'The exam library is unavailable.'} retryLabel="Retry" onRetry={() => void query.refetch()} />;

  return (
    <SatContainer>
      <SatPageHeader
        eyebrow="Digital SAT"
        title="Tests"
        description="Practice tests with adaptive Reading & Writing and Math modules."
        actions={<SatPrimaryButton onClick={openCreate} icon={<Plus size={15} aria-hidden="true" />}>Create test</SatPrimaryButton>}
      />

      <SatListToolbar
        label="Exam list controls"
        tabs={
          <SatSegmentedControl<SatLibraryTab>
            label="Exam status"
            value={tab}
            options={[
              { value: 'active', label: 'All active', count: counts.active },
              { value: 'drafts', label: 'Drafts', count: counts.drafts },
              { value: 'published', label: 'Published', count: counts.published },
              { value: 'archived', label: 'Archived', count: counts.archived },
            ]}
            onChange={(next) => setParams({ tab: next === 'active' ? '' : next })}
            className="sm:max-w-[480px]"
          />
        }
      >
        <SatSearchField
          id="sat-exam-search"
          label="Search SAT exams"
          value={search}
          onChange={setSearch}
          placeholder="Search exam title"
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

      {query.isLoading ? (
        <SatListSkeleton rows={5} label="Loading SAT exams" />
      ) : exams.length ? (
        <>
        <SatResultCount total={counts[tab]} visible={exams.length} itemLabel={exams.length === 1 ? 'exam' : 'exams'} />
        <SatList>
          {exams.map((exam, rowIndex) => {
            const status = statusLabel(exam);
            const tone = statusTone(exam);
            return (
              <SatListRow
                key={exam.id}
                index={Math.min(rowIndex, 5)}
                rowId={exam.id}
                current={exam.id === lastOpenedId}
                // Opening a row IS the author saying "work on this exam". A
                // published exam has no editable draft (publishing seals it),
                // so that gesture is what lets the workspace continue from the
                // published version instead of stopping at "No editable draft".
                // The shell READ stays a read: nothing here fires on a reload.
                onOpen={() => {
                  requestAuthoringDraftOnEntry(exam.id);
                  openRecord(exam.id, '/sat/exams/' + exam.id);
                }}
              >
                <span className="flex w-full items-center gap-3 py-2.5">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-semibold tracking-[-0.012em] text-slate-900">{exam.title}</span>
                    <span className="mt-0.5 block truncate text-[14px] tabular-nums text-slate-500">{exam.totalQuestions ?? 0} questions{exam.currentPublishedVersionId ? ` · ${satPublishScopeCopy(exam.currentPublishedScope ?? 'full')}` : ''}<span className="md:hidden"> · {formatDate(exam.updatedAt)}</span></span>
                  </span>
                  <SatStatusPill tone={tone}>{status}</SatStatusPill>
                  <span className="hidden w-32 shrink-0 text-right text-[14px] tabular-nums text-slate-500 md:block">{formatDate(exam.updatedAt)}</span>
                  <ArrowRight size={15} className="sat-row-chevron shrink-0 text-slate-400 group-hover:text-slate-500" aria-hidden="true" />
                </span>
              </SatListRow>
            );
          })}
        </SatList>
        </>
      ) : search.trim() ? (
        <SatEmptyState
          icon={<Plus size={18} aria-hidden="true" />}
          title="No matching SAT exams"
          hint={`No ${TAB_NOUN[tab]} exams match “${search.trim()}”.`}
          action={<SatPrimaryButton onClick={() => setSearch('')}>Clear Search</SatPrimaryButton>}
        />
      ) : tab === 'archived' ? (
        <SatEmptyState
          icon={<Plus size={18} aria-hidden="true" />}
          title="No archived SAT exams"
          hint="Archived exams appear here and stay available for reference."
          action={<SatPrimaryButton onClick={() => setParams({ tab: '' })}>Show active exams</SatPrimaryButton>}
        />
      ) : tab !== 'active' ? (
        <SatEmptyState
          icon={<Plus size={18} aria-hidden="true" />}
          title={`No ${TAB_NOUN[tab]} SAT exams`}
          hint="Exams move between these groups as they are edited and published."
          action={<SatPrimaryButton onClick={() => setParams({ tab: '' })}>Show all active</SatPrimaryButton>}
        />
      ) : counts.archived > 0 ? (
        <SatEmptyState
          icon={<Plus size={18} aria-hidden="true" />}
          title="No active SAT exams"
          hint={`${counts.archived} archived ${counts.archived === 1 ? 'exam is' : 'exams are'} in the Archived tab. Create a new exam or open an archived one.`}
          action={<SatPrimaryButton onClick={() => setParams({ tab: 'archived' })}>Show archived</SatPrimaryButton>}
        />
      ) : (
        <SatEmptyState
          icon={<Plus size={18} aria-hidden="true" />}
          title="No SAT exams yet"
          hint="Create one exam. The standard Digital SAT structure is ready immediately."
          action={<SatPrimaryButton onClick={openCreate}>Create test</SatPrimaryButton>}
        />
      )}

      <SatFormDialog open={createOpen} eyebrow="Digital SAT" title="Create test" onClose={requestExamClose}>
        <form onSubmit={createExam}>
          <div className="px-5 py-4">
            <label htmlFor="sat-title" className="block text-[14px] font-semibold text-slate-600">Name
              <input ref={inputRef} id="sat-title" aria-label="SAT exam name" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Practice Test 06" maxLength={255} className="mt-1.5 h-12 w-full rounded-[12px] border border-[var(--sat-staff-border-strong,rgba(0,0,0,0.09))] px-3 text-[16px] outline-none focus:border-[var(--sat-staff-accent-ring,rgba(0,113,227,0.4))] focus:ring-4 focus:ring-[var(--sat-staff-accent-ring-soft,rgba(0,113,227,0.1))]" />
            </label>
            {createError ? <p role="alert" className="mt-2 text-[14px] font-medium text-red-600">{createError}</p> : null}
            <p className="mt-3 text-[14px] leading-4 text-slate-400">Reading & Writing, Math, adaptive modules, and SAT tool policy are created as part of the exam.</p>
          </div>
          <div className="flex justify-end gap-2 border-t border-[var(--sat-staff-border-hairline,rgba(0,0,0,0.06))] px-5 py-3">
            <button type="button" onClick={requestExamClose} className="min-h-11 rounded-[10px] px-3 text-[14px] font-semibold text-slate-500 hover:bg-black/[0.04]">Cancel</button>
            <button type="submit" disabled={!title.trim() || creating} className="min-h-11 rounded-[10px] bg-[var(--sat-staff-accent,#0071e3)] px-4 text-[14px] font-semibold text-white transition-colors hover:bg-[var(--sat-staff-accent-hover,#0077ed)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-staff-accent-ring,rgba(0,113,227,0.4))] active:bg-[var(--sat-staff-accent-active,#0067c9)] disabled:bg-slate-200 disabled:text-slate-400">{creating ? 'Creating…' : 'Create'}</button>
          </div>
        </form>
      </SatFormDialog>
      {confirmDiscardExam ? <SatConfirmDialog open title="Discard this SAT?" description="The name you entered will be lost." confirmLabel="Discard" destructive onCancel={() => setConfirmDiscardExam(false)} onConfirm={() => { if (creating) return; setConfirmDiscardExam(false); setCreateOpen(false); }} /> : null}
    </SatContainer>
  );
}
