import { useMemo, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { ErrorSurface } from '../../../components/ui/ErrorSurface';
import { LoadingSurface } from '../../../components/ui/LoadingSurface';
import { useSatResultsQuery } from '../../../features/results/api/satResultsQueries';
import {
  SatContainer,
  SatEmptyState,
  SatList,
  SatListRow,
  SatPageHeader,
  SatSearchField,
  SatStatStrip,
} from '../ui/SatPage';

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
  const summary = useMemo(() => {
    const rows = query.data ?? [];
    const scored = rows.filter((result) => result.outcomeStatus === 'scored' && result.totalScore != null).length;
    return { total: rows.length, scored, awaiting: rows.length - scored };
  }, [query.data]);

  if (query.isLoading) return <LoadingSurface label="Opening SAT results…" />;
  if (query.error) return <ErrorSurface title="SAT results could not load" description={query.error instanceof Error ? query.error.message : 'Results are unavailable.'} actionLabel="Retry" onAction={() => void query.refetch()} />;

  return (
    <SatContainer>
      <SatPageHeader
        eyebrow="Digital SAT"
        title="Results"
        description="Practice scores and attempt outcomes."
        actions={
          <SatSearchField
            id="sat-results-search"
            label="Search SAT results"
            value={search}
            onChange={setSearch}
            placeholder="Search results"
            widthClassName="w-full sm:w-64 sm:flex-none"
          />
        }
      />
      <SatStatStrip
        label="Results summary"
        stats={[
          { id: 'total', label: 'Total', value: summary.total },
          { id: 'scored', label: 'Scored', value: summary.scored },
          { id: 'awaiting', label: 'Awaiting', value: summary.awaiting },
        ]}
      />
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
        <SatList>
          {results.map((result) => (
            <SatListRow key={result.id} onOpen={() => navigate('/sat/results/' + result.id)}>
              <span className="flex w-full items-center gap-4 py-3">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-semibold text-slate-900">{result.studentName}</span>
                  <span className="mt-1 block truncate text-[10px] text-slate-400">{result.studentId} · {result.cohortName}</span>
                  <span className="mt-1 block truncate text-[10px] text-slate-400">{result.examTitle} · Version {result.versionNumber} · {formatDate(result.submittedAt)}</span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="block text-[17px] font-semibold tabular-nums tracking-[-0.025em] text-slate-900">{result.outcomeStatus === 'scored' && result.totalScore != null ? result.totalScore : '—'}</span>
                  <span className="mt-0.5 block text-[8px] font-semibold uppercase tracking-[0.1em] text-slate-400">{outcomeLabel(result.outcomeStatus)}</span>
                </span>
                <ArrowRight size={15} className="hidden shrink-0 text-slate-300 transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-slate-500 sm:block" aria-hidden="true" />
              </span>
            </SatListRow>
          ))}
        </SatList>
      ) : (
        <SatEmptyState
          icon={<span aria-hidden="true" className="text-[17px] font-semibold text-slate-400">—</span>}
          title={search || scoreFilter !== 'all' ? 'No matching SAT results' : 'No SAT results yet'}
          hint={search || scoreFilter !== 'all' ? 'Try another search or score-availability filter.' : 'Completed SAT attempts will appear here when scoring is available.'}
        />
      )}
    </SatContainer>
  );
}
