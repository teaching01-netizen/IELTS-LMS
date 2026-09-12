import { useMemo, useState } from 'react';
import { ArrowRight, BarChart3 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { SatPageError } from '../ui/SatPage';
import { useSatResultsQuery } from '../../../features/results/api/satResultsQueries';
import {
  SatContainer,
  SatEmptyState,
  SatList,
  SatListRow,
  SatListSkeleton,
  SatPageHeader,
  SatResultCount,
  SatSearchField,
  SatStatStrip,
  SatStatusPill,
  satOutcomeTone,
} from '../ui/SatPage';
import { SatSegmentedControl } from '../ui/SegmentedControl';

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

  if (query.error) return <SatPageError title="SAT results could not load" description={query.error instanceof Error ? query.error.message : 'Results are unavailable.'} retryLabel="Retry" onRetry={() => void query.refetch()} />;

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
            placeholder="Search name, ID, exam, cohort"
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
      <SatSegmentedControl<typeof scoreFilter>
        label="Score availability"
        value={scoreFilter}
        options={[
          { value: 'all', label: 'All' },
          { value: 'available', label: 'Score available' },
          { value: 'unavailable', label: 'Score unavailable' },
        ]}
        onChange={setScoreFilter}
        className="mt-5 max-w-[420px]"
      />

      {query.isLoading ? (
        <SatListSkeleton rows={5} label="Loading SAT results" />
      ) : results.length ? (
        <>
        <div className="flex items-center gap-2">
          <SatResultCount total={(query.data ?? []).length} visible={results.length} itemLabel={results.length === 1 ? 'result' : 'results'} />
          {query.isFetching && !query.isLoading ? <span className="text-[11px] text-slate-400">Updating…</span> : null}
        </div>
        <SatList>
          {results.map((result, rowIndex) => (
            <SatListRow key={result.id} index={Math.min(rowIndex, 5)} onOpen={() => navigate('/sat/results/' + result.id)}>
              <span className="flex w-full items-center gap-4 py-3">
                <span className="min-w-0 flex-1">
                  {/* Density ladder: Results names at 13px + 17px score; Library titles sit at 14px. */}
                  <span className="block truncate text-[13px] font-semibold tracking-[-0.012em] text-slate-900">{result.studentName}</span>
                  <span className="mt-1 block truncate text-[10px] tabular-nums text-slate-400">{result.studentId} · {result.cohortName}</span>
                  <span className="mt-1 block truncate text-[10px] tabular-nums text-slate-400">{result.examTitle} · Version {result.versionNumber} · {formatDate(result.submittedAt)}</span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="block text-[17px] font-semibold tabular-nums tracking-[-0.025em] text-slate-900">{result.outcomeStatus === 'scored' && result.totalScore != null ? result.totalScore : '—'}</span>
                  <span className="mt-1.5 flex justify-end"><SatStatusPill tone={satOutcomeTone(result.outcomeStatus)}>{outcomeLabel(result.outcomeStatus)}</SatStatusPill></span>
                </span>
                <ArrowRight size={15} className="sat-row-chevron hidden shrink-0 text-slate-400 group-hover:text-slate-500 sm:block" aria-hidden="true" />
              </span>
            </SatListRow>
          ))}
        </SatList>
        </>
      ) : (
        <>
          <SatResultCount total={(query.data ?? []).length} visible={0} itemLabel="results" />
          <SatEmptyState
            icon={<BarChart3 size={18} aria-hidden="true" />}
            title={search || scoreFilter !== 'all' ? 'No matching SAT results' : 'No SAT results yet'}
            hint={search || scoreFilter !== 'all' ? 'Try another search or score-availability filter.' : 'Completed SAT attempts will appear here when scoring is available.'}
          />
        </>
      )}
    </SatContainer>
  );
}
