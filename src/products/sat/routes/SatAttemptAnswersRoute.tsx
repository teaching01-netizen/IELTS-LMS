import { ArrowLeft, RefreshCw } from 'lucide-react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useSatAttemptAnswersQuery } from '../../../features/results/api/satResultsQueries';
import { SatPageError, SatPageLoading } from '../ui/SatPage';

function formatSavedAt(value: string | null): string {
  if (!value) return 'No server save yet';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Save time unavailable' : date.toLocaleString();
}

function statusLabel(status: string): string {
  switch (status) {
    case 'running': return 'In progress';
    case 'submitted': return 'Submitted · scoring pending';
    case 'pending': return 'Scoring pending';
    case 'terminated':
    case 'invalidated_proctor': return 'Ended by proctor · not scored';
    case 'invalidated_timeout': return 'Time expired · not scored';
    default: return status.replaceAll('_', ' ') || 'Status unavailable';
  }
}

function formatAnswer(value: unknown): string {
  if (value === null || value === undefined) return 'Unanswered';
  if (typeof value === 'string') return value === '' ? 'Unanswered' : value;
  return JSON.stringify(value);
}

export function SatAttemptAnswersRoute() {
  const { attemptId } = useParams<{ attemptId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: unknown } | null)?.from;
  const backTarget = typeof from === 'string' && from.startsWith('/sat/results?') ? from : '/sat/results';
  const query = useSatAttemptAnswersQuery(attemptId);

  if (query.isLoading) return <SatPageLoading label="Opening saved SAT answers…" />;
  if (query.error || !query.data) {
    return <SatPageError title="Saved answers could not load" description="The server could not load this attempt. Retry to check its saved answers." retryLabel="Retry" onRetry={() => void query.refetch()} />;
  }
  const detail = query.data;
  return (
    <div className="mx-auto w-full max-w-[900px] px-4 pb-16 pt-6 sm:px-6 md:pt-9 lg:px-10">
      <button type="button" onClick={() => navigate(backTarget)} aria-label="Back to SAT results" className="-ml-2 flex min-h-10 items-center gap-1.5 rounded-lg px-2 text-[12px] font-semibold text-slate-600 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"><ArrowLeft size={15} aria-hidden="true" />Results</button>
      <header className="mt-5 border-b border-slate-200 pb-6">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{detail.examTitle} · Version {detail.versionNumber}</p>
        <h1 className="mt-2 text-[30px] font-semibold tracking-tight text-slate-950">{detail.studentName}</h1>
        <p className="mt-1 text-[13px] text-slate-600">{detail.studentId} · {detail.cohortName} · {statusLabel(detail.status)}</p>
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4">
          <div>
            <p className="text-[13px] font-semibold text-slate-900">{detail.savedAnswerCount} server-saved answers</p>
            <p className="mt-1 text-[12px] text-slate-600">Last save: {formatSavedAt(detail.lastSavedAt)}{detail.responseRevision !== null ? ` · Revision ${detail.responseRevision}` : ' · Legacy attempt'}</p>
            <p className="mt-1 text-[11px] text-slate-500">Only answers accepted by the server appear here. A score is not available for this attempt.</p>
          </div>
          <button type="button" onClick={() => void query.refetch()} disabled={query.isFetching} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-300 px-3 text-[12px] font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 disabled:opacity-50"><RefreshCw size={14} aria-hidden="true" />{query.isFetching ? 'Refreshing…' : 'Refresh answers'}</button>
        </div>
      </header>
      <section aria-labelledby="saved-answers-heading" className="py-6">
        <h2 id="saved-answers-heading" className="text-[18px] font-semibold text-slate-900">Student responses</h2>
        {detail.questions.length === 0 ? <p className="mt-4 text-[13px] text-slate-600">No administered questions are available for this attempt.</p> : (
          <ol className="mt-4 space-y-3">
            {detail.questions.map((question, index) => (
              <li key={`${question.sectionKey}:${question.moduleKey}:${question.questionId}`} className="rounded-xl border border-slate-200 bg-white p-4">
                <p className="text-[11px] font-semibold text-slate-500">{question.sectionKey} · {question.moduleKey} · Question {index + 1}</p>
                <p className="mt-1 text-[13px] font-semibold text-slate-900">{question.questionId}</p>
                <p className="mt-3 whitespace-pre-wrap break-words text-[13px] text-slate-700">{formatAnswer(question.response)}</p>
                {question.markedForReview ? <p className="mt-2 text-[11px] font-medium text-amber-700">Marked for review</p> : null}
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
