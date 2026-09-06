import { ArrowLeft } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { ErrorSurface } from '../../../components/ui/ErrorSurface';
import { LoadingSurface } from '../../../components/ui/LoadingSurface';
import type { SatSectionResult } from '../../../features/results/api/satResultsQueries';
import { useSatResultQuery } from '../../../features/results/api/satResultsQueries';

function sectionTitle(key: string): string {
  const normalized = key.toLocaleLowerCase().replace(/[-_]/g, ' ');
  if (normalized.includes('reading') || normalized.includes('writing')) return 'Reading & Writing';
  if (normalized.includes('math')) return 'Math';
  return normalized.replace(/\b\w/g, (character) => character.toUpperCase());
}

function rawTotals(sections: SatSectionResult[]) {
  return sections.reduce((total, section) => ({
    correct: total.correct + section.rawCorrect,
    questions: total.questions + section.operationalQuestionCount,
  }), { correct: 0, questions: 0 });
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return '—';
  return new Intl.DateTimeFormat(undefined, { month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(time));
}

function outcomeLabel(outcomeStatus: string): string {
  switch (outcomeStatus) {
    case 'invalidated_proctor': return 'Exam terminated by proctor';
    case 'invalidated_timeout': return 'Exam ended before scoring';
    case 'pending': return 'Scoring pending';
    default: return 'Practice score';
  }
}

export function SatResultDetailRoute() {
  const { resultId } = useParams<{ resultId: string }>();
  const navigate = useNavigate();
  const query = useSatResultQuery(resultId);
  if (query.isLoading) return <LoadingSurface label="Opening SAT result…" />;
  if (query.error || !query.data) return <ErrorSurface title="SAT result could not load" description={query.error instanceof Error ? query.error.message : 'The result is unavailable.'} actionLabel="Back to Results" onAction={() => navigate('/sat/results')} />;

  const { summary, sections } = query.data;
  const raw = rawTotals(sections);
  const isScored = summary.outcomeStatus === 'scored';
  const hasScaledTotal = isScored && summary.totalScore !== null;
  const isInvalidated = summary.outcomeStatus === 'invalidated_proctor' || summary.outcomeStatus === 'invalidated_timeout';

  return (
    <div className="mx-auto w-full max-w-[900px] px-4 pb-16 pt-6 sm:px-6 md:pt-9 lg:px-10">
      <button type="button" onClick={() => navigate('/sat/results')} className="-ml-2 flex min-h-10 items-center gap-1.5 rounded-[10px] px-2 text-[12px] font-semibold text-slate-500 hover:bg-black/[0.04] hover:text-slate-800"><ArrowLeft size={15} />Results</button>

      <div className="mt-5 border-b border-black/[0.065] pb-7">
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">{summary.examTitle} · Version {summary.versionNumber}</p>
        <div className="mt-2 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div><h1 className="text-[30px] font-semibold tracking-[-0.045em]">{summary.studentName}</h1><p className="mt-1 text-[11px] text-slate-400">{summary.studentId} · {summary.cohortName} · {formatDate(summary.submittedAt)}</p></div>
          <div className="sm:text-right">
            <p className="text-[52px] font-semibold leading-none tracking-[-0.055em] text-slate-950">{isInvalidated ? 'Not scored' : hasScaledTotal ? summary.totalScore : isScored ? `${raw.correct}/${raw.questions}` : 'Pending'}</p>
            <p className="mt-2 text-[9px] font-semibold uppercase tracking-[0.13em] text-slate-400">{isScored ? (hasScaledTotal ? 'Practice score' : 'Practice · raw score') : outcomeLabel(summary.outcomeStatus)}</p>
          </div>
        </div>
      </div>

      {isScored ? <section className="py-7" aria-labelledby="sat-performance-heading">
        <h2 id="sat-performance-heading" className="text-[17px] font-semibold tracking-[-0.025em]">Performance</h2>
        <div className="mt-4 divide-y divide-black/[0.055] border-y border-black/[0.055]">
          {sections.map((section) => (
            <div key={section.sectionKey} className="grid min-h-[82px] grid-cols-[minmax(0,1fr)_auto] items-center gap-5 py-3 sm:grid-cols-[minmax(0,1fr)_130px_130px]">
              <div><p className="text-[13px] font-semibold text-slate-900">{sectionTitle(section.sectionKey)}</p>{section.route ? <p className="mt-1 text-[9px] font-medium text-slate-400">Adaptive route · {section.route === 'higher' ? 'Higher' : 'Lower'}</p> : null}</div>
              <div className="text-right sm:text-left"><p className="text-[16px] font-semibold tabular-nums">{section.rawCorrect} / {section.operationalQuestionCount}</p><p className="mt-1 text-[8px] font-semibold uppercase tracking-[0.1em] text-slate-400">Raw</p></div>
              <div className="hidden text-right sm:block"><p className="text-[16px] font-semibold tabular-nums">{section.scaledScore ?? '—'}</p><p className="mt-1 text-[8px] font-semibold uppercase tracking-[0.1em] text-slate-400">Practice score</p></div>
            </div>
          ))}
        </div>
      </section> : <section className="mt-7 border-y border-black/[0.055] py-7" aria-labelledby="sat-outcome-heading">
        <h2 id="sat-outcome-heading" className="text-[17px] font-semibold tracking-[-0.025em]">Exam outcome</h2>
        <p role="status" className="mt-3 max-w-xl text-[13px] leading-6 text-slate-600">{outcomeLabel(summary.outcomeStatus)}. No score was produced for this attempt.</p>
      </section>}

      <p className="max-w-xl text-[10px] leading-5 text-slate-400">Scores shown here are generated by this practice assessment system. A value is only presented as a scaled practice score when the scoring policy produced one; otherwise the interface shows the raw correct count.</p>
    </div>
  );
}
