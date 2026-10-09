import { useMemo, type CSSProperties } from 'react';
import { ArrowRight } from 'lucide-react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { SatPageError, SatPageLoading, type SatStatusTone } from '../ui/SatPage';
import { QuestionRawTable } from '../../../components/results/QuestionRawTable';
import type { SatQuestionResult, SatSectionResult } from '../../../features/results/api/satResultsQueries';
import { useSatResultQuery } from '../../../features/results/api/satResultsQueries';
import { SatSectionCard } from '../ui/SatPage';
import { SatAttemptDetailHeader } from '../ui/SatAttemptDetailHeader';
import { isExamResponsesPath } from './satReturnPath';

function sectionTitle(key: string): string {
  const normalized = key.toLocaleLowerCase().replace(/[-_]/g, ' ');
  if (normalized.includes('reading') || normalized.includes('writing')) return 'Reading & Writing';
  if (normalized.includes('math')) return 'Math';
  return normalized.replace(/\b\w/g, (character) => character.toUpperCase());
}

function moduleRoleLabel(role: string): string {
  switch (role) {
    case 'base': return 'Base module';
    case 'lower_branch': return 'Lower branch';
    case 'higher_branch': return 'Higher branch';
    default: return role ? role.replace(/_/g, ' ') : 'Module';
  }
}

function formatRawValue(value: unknown): string {
  if (typeof value === 'string') return value === '' ? '(empty)' : value;
  if (value === null || value === undefined) return '—';
  if (typeof value === 'object') {
    try { return JSON.stringify(value); } catch { return '(unserializable)'; }
  }
  return String(value);
}

/** Status shown beside the student: what happened to the attempt, never a fabricated score. */
function outcomeStatusFor(outcomeStatus: string): { label: string; tone: SatStatusTone } {
  switch (outcomeStatus) {
    case 'invalidated_proctor': return { label: 'Ended by proctor', tone: 'invalidated' };
    case 'invalidated_timeout': return { label: 'Ended before scoring', tone: 'invalidated' };
    case 'pending': return { label: 'Completed · score pending', tone: 'pending' };
    default: return { label: 'Completed', tone: 'ready' };
  }
}

export function SatResultDetailRoute() {
  const { resultId } = useParams<{ resultId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const backTarget = (() => {
    const from = (location.state as { from?: unknown } | null)?.from;
    return typeof from === 'string' && (from.startsWith('/sat/results') || isExamResponsesPath(from)) ? from : '/sat/results';
  })();
  return <SatResultDetailContent resultId={resultId} backTarget={backTarget} onBack={() => navigate(backTarget)} />;
}

export interface SatResultDetailContentProps {
  resultId: string | undefined;
  /** Where "View saved answers" returns to (page mode only). */
  backTarget?: string;
  onBack: () => void;
  /** Renders inside a side sheet: no page chrome, no navigation away. */
  embedded?: boolean;
  onOpenAnswers?: (attemptId: string) => void;
}

export function SatResultDetailContent({ resultId, backTarget = '/sat/results', onBack, embedded = false, onOpenAnswers }: SatResultDetailContentProps) {
  const query = useSatResultQuery(resultId);
  // Hooks must run unconditionally before any early return: the query
  // transitions loading -> data across renders, and hooks after a return
  // would change the hook count and crash ("Rendered more hooks").
  const sections: SatSectionResult[] = query.data?.sections ?? [];
  const questions: SatQuestionResult[] = Array.isArray(query.data?.questions) ? query.data.questions : [];
  const questionsBySection = useMemo(() => {
    const map = new Map<string, SatQuestionResult[]>();
    for (const question of questions) {
      const list = map.get(question.sectionKey) ?? [];
      list.push(question);
      map.set(question.sectionKey, list);
    }
    return map;
  }, [questions]);
  if (query.isLoading) return <SatPageLoading label="Opening response…" />;
  if (query.error) {
    return (
      <SatPageError
        title="Response details could not load"
        description="Could not load this attempt's details. Retry to try again."
        retryLabel="Retry"
        onRetry={() => void query.refetch()}
      />
    );
  }
  if (!query.data) {
    return <SatPageError title="Response could not load" description="This attempt's result is unavailable." retryLabel="Back to Responses" onRetry={onBack} />;
  }

  const { summary } = query.data;
  const isScored = summary.outcomeStatus === 'scored';
  const isInvalidated = summary.outcomeStatus === 'invalidated_proctor' || summary.outcomeStatus === 'invalidated_timeout';
  const status = outcomeStatusFor(summary.outcomeStatus);
  // The detail reports the outcome and raw section results; the scaled score
  // is deliberately not shown here (this completion flow does not produce one
  // a reviewer should rely on).
  const outcomeSummary = (
    <div className="rounded-[var(--sat-staff-radius-card,14px)] border border-[var(--sat-staff-border-hairline,rgba(0,0,0,0.06))] bg-white px-5 py-4 sm:text-right">
      <p className="text-[14px] font-semibold leading-5 text-[var(--sat-staff-text-secondary,#515154)]">Outcome</p>
      <p className="mt-1 text-[18px] font-semibold leading-6 text-[var(--sat-staff-text-primary,#1d1d1f)]">{isInvalidated ? 'Not scored' : isScored ? 'Raw results available' : summary.outcomeStatus === 'pending' ? 'Score pending' : 'No score generated'}</p>
      <p className="mt-1 text-[14px] leading-5 text-[var(--sat-staff-text-secondary,#515154)]">
        {isInvalidated ? 'The attempt ended without a score.' : isScored ? 'Section raw scores and question responses are below.' : 'Saved answers are available for review.'}
      </p>
      {query.isFetching && !query.isLoading ? <p role="status" className="mt-1 text-[14px] leading-5 text-[var(--sat-staff-text-tertiary,#6e6e73)]">Updating…</p> : null}
    </div>
  );

  return (
    <div className={embedded ? 'w-full pb-8' : 'mx-auto w-full max-w-[920px] px-4 pb-16 pt-6 sm:px-6 md:pt-8'}>
      <SatAttemptDetailHeader
        embedded={embedded}
        backLabel={embedded ? undefined : 'Back to Responses'}
        onBack={onBack}
        examTitle={summary.examTitle}
        versionNumber={summary.versionNumber}
        studentName={summary.studentName}
        studentId={summary.studentId}
        cohortName={summary.cohortName}
        status={status}
        testStartedAt={query.data.testStartedAt}
        submittedAt={summary.submittedAt}
        summary={outcomeSummary}
      />

      {isScored ? <section className="py-7" aria-labelledby="sat-performance-heading">
        <h2 id="sat-performance-heading" className="text-[20px] font-semibold leading-7 tracking-[-0.015em]">Performance</h2>
        <div className="mt-4 space-y-2">
          {sections.map((section, sectionIndex) => {
            const modules = Array.isArray(section.modules) ? section.modules : [];
            return (
            <div key={section.sectionKey} style={{ '--sat-row-index': Math.min(sectionIndex, 5) } as CSSProperties} className="sat-row-enter rounded-[var(--sat-staff-radius-card,14px)] border border-[var(--sat-staff-border-hairline,rgba(0,0,0,0.06))] bg-white p-5">
              <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-5">
                <div><p className="text-[16px] font-semibold leading-6 text-[var(--sat-staff-text-primary,#1d1d1f)]">{sectionTitle(section.sectionKey)}</p>{section.route ? <p className="mt-0.5 text-[14px] leading-5 text-[var(--sat-staff-text-secondary,#515154)]">Adaptive route · {section.route === 'higher' ? 'Higher' : 'Lower'}</p> : null}</div>
                <div className="text-right"><p className="text-[20px] font-semibold leading-7 tabular-nums">{section.rawCorrect} / {section.operationalQuestionCount}</p><p className="text-[14px] leading-5 text-[var(--sat-staff-text-secondary,#515154)]">Raw correct</p></div>
              </div>
              {modules.length > 0 ? (
                <dl className="mt-3 space-y-1.5 rounded-[var(--sat-staff-radius-control,10px)] bg-[var(--sat-staff-fill-faint,rgba(0,0,0,0.035))] p-3" aria-label={`${sectionTitle(section.sectionKey)} module raw scores`}>
                  {modules.map((module) => (
                    <div key={module.moduleKey} className="flex items-center justify-between gap-3 text-[14px] leading-5">
                      <div>
                        <dt className="font-semibold text-[var(--sat-staff-text-primary,#1d1d1f)]">{module.moduleKey}</dt>
                        <dd className="text-[var(--sat-staff-text-secondary,#515154)]">{moduleRoleLabel(module.adaptiveRole)} · {module.state}</dd>
                      </div>
                      <dd className="font-semibold tabular-nums text-[var(--sat-staff-text-primary,#1d1d1f)]">{module.rawCorrect} / {module.operationalQuestionCount}</dd>
                    </div>
                  ))}
                </dl>
              ) : null}
            </div>
            );
          })}
        </div>
      </section> : <SatSectionCard labelledBy="sat-outcome-heading" className="mt-7">
        <h2 id="sat-outcome-heading" className="text-[20px] font-semibold leading-7 tracking-[-0.015em]">{isInvalidated ? 'Attempt ended' : 'Saved answers'}</h2>
        <p className="mt-2 max-w-xl text-[14px] leading-5 text-[var(--sat-staff-text-secondary,#515154)]">
          {isInvalidated
            ? `${status.label}. No score is produced for this attempt.`
            : 'This attempt has no scaled score. Review the answers the server accepted for it.'}
        </p>
        {!isInvalidated ? (embedded
          ? <button type="button" onClick={() => onOpenAnswers?.(summary.attemptId)} className="sat-btn sat-btn--secondary sat-press mt-4">View saved answers<ArrowRight size={16} aria-hidden="true" /></button>
          : <Link to={`/sat/results/attempts/${encodeURIComponent(summary.attemptId)}`} state={{ from: backTarget }} className="sat-btn sat-btn--secondary sat-press mt-4">View saved answers<ArrowRight size={16} aria-hidden="true" /></Link>) : null}
      </SatSectionCard>}

      {isScored ? (
        <section className="border-t border-[var(--sat-staff-border-hairline,rgba(0,0,0,0.06))] py-7" aria-labelledby="sat-questions-heading">
          <h2 id="sat-questions-heading" className="text-[20px] font-semibold leading-7 tracking-[-0.015em]">Question-level responses ({questions.length})</h2>
          {questions.length > 0 ? (
              <div className="mt-4 space-y-6">
                {sections.map((section) => {
                  const rows = (questionsBySection.get(section.sectionKey) ?? []).map((question, index) => ({
                    key: `${question.sectionKey}:${question.moduleKey}:${question.questionId}`,
                    index: index + 1,
                    question: `${question.questionId} · ${question.moduleKey}`,
                    section: sectionTitle(section.sectionKey),
                    studentAnswer: formatRawValue(question.response),
                    correctAnswer: formatRawValue(question.correctAnswer),
                    isCorrect: question.isCorrect,
                    badges: [
                      ...(question.isPretest ? ['Pretest · excluded'] : []),
                      ...(question.markedForReview ? ['Marked for review'] : []),
                      ...(!question.isPretest && (question.response === null || question.response === undefined || question.response === '') ? ['Unanswered'] : []),
                    ],
                  }));
                  if (rows.length === 0) return null;
                  return (
                    <SatSectionCard key={section.sectionKey}>
                      <h3 className="mb-3 text-[16px] font-semibold leading-6 text-[var(--sat-staff-text-primary,#1d1d1f)]">{sectionTitle(section.sectionKey)}</h3>
                      <QuestionRawTable rows={rows} caption={`${sectionTitle(section.sectionKey)} question responses`} />
                    </SatSectionCard>
                  );
                })}
              </div>
            ) : (
              <p className="mt-3 text-[14px] leading-5 text-[var(--sat-staff-text-secondary,#515154)]">No question-level responses recorded for this result.</p>
            )}
        </section>
      ) : null}
    </div>
  );
}
