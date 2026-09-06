import { useMemo, useState } from 'react';
import { ArrowRight, Search } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { ErrorSurface } from '../../../components/ui/ErrorSurface';
import { LoadingSurface } from '../../../components/ui/LoadingSurface';
import { useSatResultsQuery } from '../../../features/results/api/satResultsQueries';

function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return '—';
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(time));
}

function outcomeLabel(outcomeStatus: string): string {
  switch (outcomeStatus) {
    case 'invalidated_proctor': return 'Exam terminated by proctor';
    case 'invalidated_timeout': return 'Exam ended before scoring';
    case 'pending': return 'Scoring pending';
    default: return 'Practice';
  }
}

export function SatResultsRoute() {
  const navigate = useNavigate();
  const query = useSatResultsQuery();
  const [search, setSearch] = useState('');
  const [scoreFilter, setScoreFilter] = useState<'all' | 'available' | 'unavailable'>('all');
  const results = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    return (query.data ?? []).filter((result) => {
      const scoreAvailable = result.outcomeStatus === 'scored' && result.totalScore != null;
      if (scoreFilter === 'available' && !scoreAvailable) return false;
      if (scoreFilter === 'unavailable' && scoreAvailable) return false;
      if (!needle) return true;
      return [result.studentName, result.studentId, result.examTitle, result.cohortName]
        .some((value) => value.toLocaleLowerCase().includes(needle));
    });
  }, [query.data, scoreFilter, search]);

  if (query.isLoading) return <LoadingSurface label="Opening SAT results…" />;
  if (query.error) return <ErrorSurface title="SAT results could not load" description={query.error instanceof Error ? query.error.message : 'Results are unavailable.'} actionLabel="Retry" onAction={() => void query.refetch()} />;

  return (
    <div className="mx-auto w-full max-w-[1180px] px-4 pb-14 pt-7 sm:px-6 md:pt-10 lg:px-10">
      <div className="flex flex-col gap-5 border-b border-black/[0.065] pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">Digital SAT</p>
          <h1 className="mt-1 text-[30px] font-semibold tracking-[-0.045em]">Results</h1>
        </div>
        <label htmlFor="sat-results-search" className="relative w-full sm:w-64">
          <Search size={15} className="pointer-events-none absolute left-3 top-3 text-slate-400" aria-hidden="true" />
          <span className="sr-only">Search SAT results</span>
          <input id="sat-results-search" aria-label="Search SAT results" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search results" className="h-10 w-full rounded-[11px] border border-black/[0.075] bg-white pl-9 pr-3 text-sm outline-none focus:border-[#0071e3]/40 focus:ring-4 focus:ring-[#0071e3]/10" />
        </label>
      </div>
      <fieldset className="mt-4" aria-label="Score availability">
        <legend className="sr-only">Filter results by score availability</legend>
        <div role="radiogroup" aria-label="Score availability" className="flex flex-wrap gap-2">
          {[['all', 'All results'], ['available', 'Score available'], ['unavailable', 'Score unavailable']].map(([value, label]) => (
            <label key={value} className="flex min-h-9 cursor-pointer items-center gap-2 rounded-full border border-black/[0.075] bg-white px-3 text-[10px] font-semibold text-slate-600 has-[:checked]:border-[#0071e3]/35 has-[:checked]:bg-[#0071e3]/[0.07] has-[:checked]:text-[#0067c9]">
              <input type="radio" name="sat-score-filter" value={value} checked={scoreFilter === value} onChange={() => setScoreFilter(value as typeof scoreFilter)} className="sr-only" />
              {label}
            </label>
          ))}
        </div>
      </fieldset>

      {results.length ? (
        <div className="mt-3 divide-y divide-black/[0.055] border-b border-black/[0.055]">
          <div className="hidden min-h-9 grid-cols-[minmax(180px,1.1fr)_minmax(220px,1fr)_125px_95px_30px] items-center gap-4 px-1 text-[9px] font-semibold uppercase tracking-[0.12em] text-slate-400 sm:grid">
            <span>Student</span><span>Exam</span><span>Taken</span><span className="text-right">Score</span><span />
          </div>
          {results.map((result) => (
            <button key={result.id} type="button" onClick={() => navigate(`/sat/results/${result.id}`)} className="group grid min-h-[78px] w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-1 text-left transition-colors hover:bg-black/[0.018] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#0071e3] sm:grid-cols-[minmax(180px,1.1fr)_minmax(220px,1fr)_125px_95px_30px]">
              <div className="min-w-0 py-3"><p className="truncate text-[13px] font-semibold text-slate-900">{result.studentName}</p><p className="mt-1 truncate text-[10px] text-slate-400">{result.studentId} · {result.cohortName}</p></div>
              <div className="hidden min-w-0 sm:block"><p className="truncate text-[12px] font-medium text-slate-700">{result.examTitle}</p><p className="mt-1 text-[9px] text-slate-400">Version {result.versionNumber}</p></div>
              <div className="hidden text-[11px] tabular-nums text-slate-400 sm:block">{formatDate(result.submittedAt)}</div>
              <div className="text-right"><p className="text-[17px] font-semibold tabular-nums tracking-[-0.025em] text-slate-900">{result.outcomeStatus === 'scored' && result.totalScore != null ? result.totalScore : '—'}</p><p className="mt-0.5 text-[8px] font-semibold uppercase tracking-[0.1em] text-slate-400">{outcomeLabel(result.outcomeStatus)}</p></div>
              <ArrowRight size={15} className="hidden text-slate-300 transition-transform group-hover:translate-x-0.5 group-hover:text-slate-500 sm:block" aria-hidden="true" />
              <div className="col-span-2 -mt-2 pb-3 text-[10px] text-slate-400 sm:hidden">{result.examTitle} · {formatDate(result.submittedAt)}</div>
            </button>
          ))}
        </div>
      ) : (
        <div className="flex min-h-[360px] flex-col items-center justify-center text-center">
          <div className="flex h-11 w-11 items-center justify-center rounded-full bg-black/[0.045] text-[17px] font-semibold text-slate-400">—</div>
          <h2 className="mt-4 text-[16px] font-semibold tracking-[-0.02em]">{search || scoreFilter !== 'all' ? 'No matching SAT results' : 'No SAT results yet'}</h2>
          <p className="mt-1 max-w-sm text-[12px] leading-5 text-slate-400">{search || scoreFilter !== 'all' ? 'Try another search or score-availability filter.' : 'Completed SAT attempts will appear here when scoring is available.'}</p>
        </div>
      )}
    </div>
  );
}
