import { FormEvent, useMemo, useRef, useState } from 'react';
import { ArrowRight, Plus, Search } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { ErrorSurface } from '../../../components/ui/ErrorSurface';
import { LoadingSurface } from '../../../components/ui/LoadingSurface';
import { useAuthSession } from '../../../features/auth/authSession';
import { invalidateExamList, useExamListQuery } from '../../../features/exam-authoring/api/examQueries';
import { examAuthoringFacade } from '../../../features/exam-authoring/application/examAuthoringFacade';
import type { ExamEntity } from '../../../types/domain';
import { SatFormDialog } from '../ui/ConfirmDialog';

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

function statusClass(label: string): string {
  if (label === 'Published') return 'text-emerald-700';
  if (label === 'Changes') return 'text-amber-700';
  return 'text-slate-500';
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
      navigate(`/sat/exams/${result.exam.id}`);
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : 'The SAT could not be created.');
    } finally {
      setCreating(false);
    }
  };

  if (query.isLoading) return <LoadingSurface label="Opening SAT Exam Library…" />;
  if (query.error) return <ErrorSurface title="Exam Library could not load" description={query.error instanceof Error ? query.error.message : 'The exam library is unavailable.'} actionLabel="Retry" onAction={() => void query.refetch()} />;

  return (
    <div className="mx-auto w-full max-w-[1180px] px-4 pb-14 pt-7 sm:px-6 md:pt-10 lg:px-10">
      <div className="flex flex-col gap-5 border-b border-black/[0.065] pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">Digital SAT</p>
          <h1 className="mt-1 text-[30px] font-semibold tracking-[-0.045em] text-slate-950">Exam Library</h1>
        </div>
        <div className="flex w-full items-center gap-2 sm:w-auto">
          <label htmlFor="sat-exam-search" className="relative min-w-0 flex-1 sm:w-64 sm:flex-none">
            <Search size={15} className="pointer-events-none absolute left-3 top-3 text-slate-400" aria-hidden="true" />
            <span className="sr-only">Search SAT exams</span>
            <input id="sat-exam-search" aria-label="Search SAT exams" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search exams" className="h-10 w-full rounded-[11px] border border-black/[0.075] bg-white pl-9 pr-3 text-sm outline-none transition focus:border-[#0071e3]/40 focus:ring-4 focus:ring-[#0071e3]/10" />
          </label>
          <button type="button" onClick={openCreate} className="flex h-10 shrink-0 items-center gap-1.5 rounded-[11px] bg-[#0071e3] px-3.5 text-[12px] font-semibold text-white transition-colors hover:bg-[#0077ed] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#0071e3]/20"><Plus size={15} aria-hidden="true" />New SAT</button>
        </div>
      </div>

      {exams.length ? (
        <div className="mt-3 divide-y divide-black/[0.055] border-b border-black/[0.055]">
          {exams.map((exam) => {
            const status = statusLabel(exam);
            return (
              <button key={exam.id} type="button" onClick={() => navigate(`/sat/exams/${exam.id}`)} className="group grid min-h-[76px] w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-1 text-left transition-colors hover:bg-black/[0.018] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#0071e3] sm:grid-cols-[minmax(0,1fr)_130px_120px_32px]">
                <div className="min-w-0 py-3">
                  <p className="truncate text-[14px] font-semibold tracking-[-0.012em] text-slate-900">{exam.title}</p>
                  <p className="mt-1 text-[10px] text-slate-400">{exam.totalQuestions ?? 0} questions</p>
                </div>
                <div className={`hidden text-[11px] font-semibold sm:block ${statusClass(status)}`}>{status}</div>
                <div className="hidden text-[11px] tabular-nums text-slate-400 sm:block">{formatDate(exam.updatedAt)}</div>
                <div className="flex items-center justify-end"><ArrowRight size={15} className="text-slate-300 transition-transform group-hover:translate-x-0.5 group-hover:text-slate-500" aria-hidden="true" /></div>
                <div className="col-span-2 -mt-3 pb-3 text-[10px] sm:hidden"><span className={statusClass(status)}>{status}</span><span className="mx-2 text-slate-300">·</span><span className="text-slate-400">{formatDate(exam.updatedAt)}</span></div>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="flex min-h-[360px] flex-col items-center justify-center text-center">
          <div className="flex h-11 w-11 items-center justify-center rounded-full bg-black/[0.045] text-slate-400"><Plus size={18} /></div>
          <h2 className="mt-4 text-[16px] font-semibold tracking-[-0.02em]">{search ? 'No matching SAT exams' : 'No SAT exams yet'}</h2>
          <p className="mt-1 max-w-sm text-[12px] leading-5 text-slate-400">{search ? 'Try a different name.' : 'Create one exam. The standard Digital SAT structure is ready immediately.'}</p>
          {!search ? <button type="button" onClick={openCreate} className="mt-4 min-h-10 rounded-[11px] bg-[#0071e3] px-4 text-[12px] font-semibold text-white">New SAT</button> : null}
        </div>
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
    </div>
  );
}
