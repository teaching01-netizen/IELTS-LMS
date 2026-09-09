import { FormEvent, useMemo, useRef, useState } from 'react';
import { ArrowRight, Plus } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { ErrorSurface } from '../../../components/ui/ErrorSurface';
import { LoadingSurface } from '../../../components/ui/LoadingSurface';
import { useAuthSession } from '../../../features/auth/authSession';
import { invalidateExamList, useExamListQuery } from '../../../features/exam-authoring/api/examQueries';
import { examAuthoringFacade } from '../../../features/exam-authoring/application/examAuthoringFacade';
import type { ExamEntity } from '../../../types/domain';
import { SatFormDialog } from '../ui/ConfirmDialog';
import {
  SatContainer,
  SatEmptyState,
  SatList,
  SatListRow,
  SatPageHeader,
  SatPrimaryButton,
  SatSearchField,
  SatStatusPill,
  type SatStatusTone,
} from '../ui/SatPage';

function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return '—';
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(time));
}

function statusLabel(exam: ExamEntity): string {
  if (exam.status === 'published') return 'Published';
  if (exam.status === 'archived') return 'Archived';
  if (exam.currentPublishedVersionId) return 'Changes';
  return 'Draft';
}

function statusTone(label: string): SatStatusTone {
  if (label === 'Published') return 'published';
  if (label === 'Changes') return 'changes';
  if (label === 'Archived') return 'archived';
  return 'draft';
}

export function SatExamLibraryRoute() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { session } = useAuthSession();
  const query = useExamListQuery(true, 'sat');
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const exams = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    const timeOf = (value: string | null | undefined): number => {
      if (!value) return Number.NEGATIVE_INFINITY;
      const time = new Date(value).getTime();
      return Number.isNaN(time) ? Number.NEGATIVE_INFINITY : time;
    };
    return (query.data?.entities ?? [])
      .filter((exam) => exam.providerKey === 'sat' && exam.status !== 'archived')
      .filter((exam) => !needle || exam.title.toLocaleLowerCase().includes(needle))
      .sort((left, right) => timeOf(right.updatedAt) - timeOf(left.updatedAt));
  }, [query.data?.entities, search]);

  const openCreate = () => {
    setTitle('');
    setCreateError(null);
    setCreateOpen(true);
    window.requestAnimationFrame(() => inputRef.current?.focus());
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

  if (query.isLoading) return <LoadingSurface label="Opening SAT Exam Library…" />;
  if (query.error) return <ErrorSurface title="Exam Library could not load" description={query.error instanceof Error ? query.error.message : 'The exam library is unavailable.'} actionLabel="Retry" onAction={() => void query.refetch()} />;

  return (
    <SatContainer>
      <SatPageHeader
        eyebrow="Digital SAT"
        title="Exam Library"
        description="Practice tests with adaptive Reading & Writing and Math modules."
        actions={
          <>
            <SatSearchField
              id="sat-exam-search"
              label="Search SAT exams"
              value={search}
              onChange={setSearch}
              placeholder="Search exams"
              widthClassName="sm:w-64 sm:flex-none"
            />
            <SatPrimaryButton onClick={openCreate} icon={<Plus size={15} aria-hidden="true" />}>New SAT</SatPrimaryButton>
          </>
        }
      />

      {exams.length ? (
        <SatList>
          {exams.map((exam) => {
            const status = statusLabel(exam);
            return (
              <SatListRow key={exam.id} onOpen={() => navigate('/sat/exams/' + exam.id)}>
                <span className="flex w-full items-center gap-3 py-3">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-semibold tracking-[-0.012em] text-slate-900">{exam.title}</span>
                    <span className="mt-1 block truncate text-[10px] text-slate-400">{exam.totalQuestions ?? 0} questions · {formatDate(exam.updatedAt)}</span>
                  </span>
                  <SatStatusPill tone={statusTone(status)}>{status}</SatStatusPill>
                  <ArrowRight size={15} className="shrink-0 text-slate-300 transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-slate-500" aria-hidden="true" />
                </span>
              </SatListRow>
            );
          })}
        </SatList>
      ) : (
        <SatEmptyState
          icon={<Plus size={18} aria-hidden="true" />}
          title={search ? 'No matching SAT exams' : 'No SAT exams yet'}
          hint={search ? 'Try a different name.' : 'Create one exam. The standard Digital SAT structure is ready immediately.'}
          action={!search ? <SatPrimaryButton onClick={openCreate}>New SAT</SatPrimaryButton> : undefined}
        />
      )}

      <SatFormDialog open={createOpen} eyebrow="Digital SAT" title="New SAT" onClose={() => setCreateOpen(false)}>
        <form onSubmit={createExam}>
          <div className="px-5 py-4">
            <label htmlFor="sat-title" className="block text-[11px] font-semibold text-slate-600">Name
              <input ref={inputRef} id="sat-title" aria-label="SAT exam name" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Practice Test 06" maxLength={255} className="mt-1.5 h-12 w-full rounded-[12px] border border-black/[0.09] px-3 text-[14px] outline-none focus:border-[#0071e3]/40 focus:ring-4 focus:ring-[#0071e3]/10" />
            </label>
            {createError ? <p role="alert" className="mt-2 text-[11px] font-medium text-red-600">{createError}</p> : null}
            <p className="mt-3 text-[10px] leading-4 text-slate-400">Reading & Writing, Math, adaptive modules, and SAT tool policy are created as part of the exam.</p>
          </div>
          <div className="flex justify-end gap-2 border-t border-black/[0.055] px-5 py-3">
            <button type="button" onClick={() => setCreateOpen(false)} className="min-h-10 rounded-[10px] px-3 text-[12px] font-semibold text-slate-500 hover:bg-black/[0.04]">Cancel</button>
            <button type="submit" disabled={!title.trim() || creating} className="min-h-10 rounded-[10px] bg-[#0071e3] px-4 text-[12px] font-semibold text-white disabled:bg-slate-200 disabled:text-slate-400">{creating ? 'Creating…' : 'Create'}</button>
          </div>
        </form>
      </SatFormDialog>
    </SatContainer>
  );
}
