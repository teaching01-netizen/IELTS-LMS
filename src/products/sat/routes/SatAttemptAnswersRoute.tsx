import { ArrowLeft, RefreshCw } from 'lucide-react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useSatAttemptAnswersQuery } from '../../../features/results/api/satResultsQueries';
import { QuestionRawTable } from '../../../components/results/QuestionRawTable';
import { SatPageError, SatPageLoading, SatSectionCard } from '../ui/SatPage';

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

function sectionTitle(key: string): string {
  const normalized = key.toLocaleLowerCase().replace(/[-_]/g, ' ');
  if (normalized.includes('reading') || normalized.includes('writing')) return 'Reading & Writing';
  if (normalized.includes('math')) return 'Math';
  return normalized.replace(/\b\w/g, (character) => character.toUpperCase());
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
  const questionsBySection = new Map<string, typeof detail.questions>();
  for (const question of detail.questions) {
    const section = questionsBySection.get(question.sectionKey) ?? [];
    section.push(question);
    questionsBySection.set(question.sectionKey, section);
  }
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
      <section aria-labelledby="saved-answers-heading" className="border-t border-[var(--sat-staff-border-input,rgba(0,0,0,0.075))] py-7">
        <h2 id="saved-answers-heading" className="text-[17px] font-semibold tracking-[-0.025em]">Question-level responses ({detail.questions.length})</h2>
        {detail.questions.length === 0 ? <p className="mt-3 text-[13px] text-slate-500">No administered questions are available for this attempt.</p> : (
          <div className="mt-4 space-y-8">
            {Array.from(questionsBySection, ([sectionKey, questions]) => {
              const title = sectionTitle(sectionKey);
              const rows = questions.map((question, index) => ({
                key: `${question.sectionKey}:${question.moduleKey}:${question.questionId}`,
                index: index + 1,
                question: `${question.questionId} · ${question.moduleKey}`,
                section: title,
                studentAnswer: question.response === '' ? null : question.response,
                correctAnswer: null,
                isCorrect: null,
                badges: [
                  ...(question.response === null || question.response === undefined || question.response === '' ? ['Unanswered'] : []),
                  ...(question.markedForReview ? ['Marked for review'] : []),
                ],
              }));
              return (
                <SatSectionCard key={sectionKey}>
                  <h3 className="mb-3 text-[13px] font-semibold text-slate-800">{title}</h3>
                  <QuestionRawTable rows={rows} caption={`${title} question responses`} showVerdictFilters={false} />
                </SatSectionCard>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
