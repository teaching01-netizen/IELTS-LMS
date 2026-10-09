import { RefreshCw } from 'lucide-react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useSatAttemptAnswersQuery } from '../../../features/results/api/satResultsQueries';
import { QuestionRawTable } from '../../../components/results/QuestionRawTable';
import { SatButton, SatPageError, SatPageLoading, SatSectionCard, type SatStatusTone } from '../ui/SatPage';
import { SatAttemptDetailHeader } from '../ui/SatAttemptDetailHeader';
import { isExamResponsesPath } from './satReturnPath';

function formatSavedAt(value: string | null): string {
  if (!value) return 'No server save yet';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Save time unavailable' : date.toLocaleString();
}

function statusFor(status: string): { label: string; tone: SatStatusTone } {
  switch (status) {
    case 'running': return { label: 'In progress', tone: 'live' };
    case 'paused': return { label: 'Paused', tone: 'paused' };
    case 'submitted':
    case 'pending': return { label: 'Completed', tone: 'ready' };
    case 'terminated':
    case 'invalidated_proctor': return { label: 'Ended by proctor · not scored', tone: 'invalidated' };
    case 'invalidated_timeout': return { label: 'Time expired · not scored', tone: 'invalidated' };
    default: return { label: status.replaceAll('_', ' ') || 'Status unavailable', tone: 'neutral' };
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
  const backTarget = typeof from === 'string' && (from.startsWith('/sat/results?') || isExamResponsesPath(from)) ? from : '/sat/results';
  return <SatAttemptAnswersContent attemptId={attemptId} onBack={() => navigate(backTarget)} />;
}

export interface SatAttemptAnswersContentProps {
  attemptId: string | undefined;
  /** Page mode: leave to the results list. Embedded mode: return to the result summary (omit when there is none). */
  onBack?: () => void;
  /** Renders inside a side sheet: no page chrome. */
  embedded?: boolean;
}

export function SatAttemptAnswersContent({ attemptId, onBack, embedded = false }: SatAttemptAnswersContentProps) {
  const query = useSatAttemptAnswersQuery(attemptId);

  if (query.isLoading) return <SatPageLoading label="Opening saved answers…" />;
  if (!query.data) {
    return <SatPageError title="Saved answers could not load" description="The server could not load this attempt. Retry to check its saved answers." retryLabel="Retry" onRetry={() => void query.refetch()} />;
  }
  const detail = query.data;
  const questionsBySection = new Map<string, typeof detail.questions>();
  for (const question of detail.questions) {
    const section = questionsBySection.get(question.sectionKey) ?? [];
    section.push(question);
    questionsBySection.set(question.sectionKey, section);
  }
  const saveEvidence = (
    <div className="rounded-[var(--sat-staff-radius-card,14px)] border border-[var(--sat-staff-border-hairline,rgba(0,0,0,0.06))] bg-white px-5 py-4">
      <p className="text-[14px] font-semibold leading-5 text-[var(--sat-staff-text-secondary,#515154)]">Saved on the server</p>
      <p className="mt-1 text-[24px] font-semibold leading-8 tabular-nums text-[var(--sat-staff-text-primary,#1d1d1f)]">{detail.savedAnswerCount} {detail.savedAnswerCount === 1 ? 'answer' : 'answers'}</p>
      <p className="mt-1 text-[14px] leading-5 text-[var(--sat-staff-text-secondary,#515154)]">Last save: {formatSavedAt(detail.lastSavedAt)}{detail.responseRevision !== null ? ` · Revision ${detail.responseRevision}` : ' · Legacy attempt'}</p>
      <p className="mt-2 text-[14px] leading-5 text-[var(--sat-staff-text-secondary,#515154)]">Only answers accepted by the server appear here. A score is not available for this attempt.</p>
      <p role="status" className="mt-2 text-[14px] leading-5 text-[var(--sat-staff-text-tertiary,#6e6e73)]">{query.isFetching ? 'Checking for newer answers…' : `Checks every 15 seconds while visible${query.dataUpdatedAt ? ` · Last checked ${new Date(query.dataUpdatedAt).toLocaleTimeString()}` : ''}`}</p>
      {query.error ? <p className="mt-2 text-[14px] font-medium leading-5 text-[var(--sat-staff-warning-text,#92400e)]" role="alert">Could not check for newer answers. Showing the last successful check; try again or wait for the next check.</p> : null}
      <SatButton variant="secondary" onClick={() => void query.refetch()} pending={query.isFetching} icon={<RefreshCw size={16} aria-hidden="true" />} className="mt-3">{query.isFetching ? 'Checking…' : 'Check now'}</SatButton>
    </div>
  );
  return (
    <div className={embedded ? 'w-full pb-8' : 'mx-auto w-full max-w-[920px] px-4 pb-16 pt-6 sm:px-6 md:pt-8'}>
      <SatAttemptDetailHeader
        embedded={embedded}
        backLabel={embedded ? (onBack ? 'Back to result' : undefined) : 'Back to Responses'}
        onBack={onBack}
        examTitle={detail.examTitle}
        versionNumber={detail.versionNumber}
        studentName={detail.studentName}
        studentId={detail.studentId}
        cohortName={detail.cohortName}
        status={statusFor(detail.status)}
        testStartedAt={detail.testStartedAt}
        submittedAt={detail.submittedAt}
        summary={saveEvidence}
      />
      <section aria-labelledby="saved-answers-heading" className="py-7">
        <h2 id="saved-answers-heading" className="text-[20px] font-semibold leading-7 tracking-[-0.015em]">Question-level responses ({detail.questions.length})</h2>
        {detail.questions.length === 0 ? <p className="mt-3 text-[14px] leading-5 text-[var(--sat-staff-text-secondary,#515154)]">No administered questions are available for this attempt.</p> : (
          <div className="mt-4 space-y-6">
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
                  <h3 className="mb-3 text-[16px] font-semibold leading-6 text-[var(--sat-staff-text-primary,#1d1d1f)]">{title}</h3>
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
