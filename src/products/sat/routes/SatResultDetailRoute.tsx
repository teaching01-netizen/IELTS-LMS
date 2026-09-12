import { useMemo, type CSSProperties } from 'react';
import { ArrowLeft } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { SatPageError, SatPageLoading } from '../ui/SatPage';
import { QuestionRawTable } from '../../../components/results/QuestionRawTable';
import type { SatQuestionResult, SatSectionResult } from '../../../features/results/api/satResultsQueries';
import { useSatResultQuery } from '../../../features/results/api/satResultsQueries';
import { SatSectionCard, SatStatusPill } from '../ui/SatPage';

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
  if (query.isLoading) return <SatPageLoading label="Opening SAT result…" />;
  if (query.error || !query.data) return <SatPageError title="SAT result could not load" description={query.error instanceof Error ? query.error.message : 'The result is unavailable.'} retryLabel="Back to Results" onRetry={() => navigate('/sat/results')} />;

  const { summary } = query.data;
  const raw = rawTotals(sections);
  const isScored = summary.outcomeStatus === 'scored';
  const hasScaledTotal = isScored && summary.totalScore !== null;
  const isInvalidated = summary.outcomeStatus === 'invalidated_proctor' || summary.outcomeStatus === 'invalidated_timeout';

  return (
    <div className="mx-auto w-full max-w-[900px] px-4 pb-16 pt-6 sm:px-6 md:pt-9 lg:px-10">
      <button type="button" onClick={() => navigate('/sat/results')} aria-label="Back to SAT results" className="-ml-2 flex min-h-10 items-center gap-1.5 rounded-[var(--sat-staff-radius-control,10px)] px-2 text-[12px] font-semibold text-[var(--sat-staff-text-secondary,#515154)] hover:bg-[var(--sat-staff-fill-chip,rgba(0,0,0,0.04))] hover:text-[var(--sat-staff-text-primary,#1d1d1f)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-staff-accent-ring,rgba(0,113,227,0.4))]"><ArrowLeft size={15} />Results</button>

      <div className="mt-5 border-b border-[var(--sat-staff-border-header,rgba(0,0,0,0.065))] pb-7">
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">{summary.examTitle} · Version {summary.versionNumber}</p>
        <div className="mt-2 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div><h1 className="text-balance text-[30px] font-semibold tracking-[-0.045em]">{summary.studentName}</h1><p className="mt-1 text-[11px] text-slate-400">{summary.studentId} · {summary.cohortName} · {formatDate(summary.submittedAt)}</p></div>
          <div className="sm:text-right">
            <p className="text-[52px] font-semibold tabular-nums leading-none tracking-[-0.045em] text-slate-950">{isInvalidated ? 'Not scored' : hasScaledTotal ? summary.totalScore : isScored ? `${raw.correct}/${raw.questions}` : 'Pending'}</p>
            <p className="mt-2 text-[11px] font-semibold uppercase tracking-[0.13em] text-slate-400">{isScored ? (hasScaledTotal ? `Scaled practice score · Practice · ${summary.releaseStatus}` : `Raw correct ${raw.correct}/${raw.questions} — scaled score unavailable · Practice · ${summary.releaseStatus}`) : `${outcomeLabel(summary.outcomeStatus)} · Practice · ${summary.releaseStatus}`}</p>
            {query.isFetching && !query.isLoading ? <p className="mt-1 text-[11px] text-slate-400">Updating…</p> : null}
          </div>
        </div>
      </div>

      {isScored ? <section className="py-7" aria-labelledby="sat-performance-heading">
        <h2 id="sat-performance-heading" className="text-[17px] font-semibold tracking-[-0.025em]">Performance</h2>
        <div className="mt-4 space-y-2">
          {sections.map((section, sectionIndex) => {
            const modules = Array.isArray(section.modules) ? section.modules : [];
            return (
            <div key={section.sectionKey} style={{ '--sat-row-index': Math.min(sectionIndex, 5) } as CSSProperties} className="sat-row-enter rounded-2xl border border-[var(--sat-staff-border-hairline,rgba(0,0,0,0.06))] bg-[var(--sat-staff-surface,#fff)] p-4 shadow-[var(--sat-staff-shadow-card-soft,0_1px_2px_rgba(0,0,0,0.04))] sm:p-5">
              <div className="grid min-h-[82px] grid-cols-[minmax(0,1fr)_auto] items-center gap-5 sm:grid-cols-[minmax(0,1fr)_130px_130px]">
                <div><p className="text-[13px] font-semibold text-slate-900">{sectionTitle(section.sectionKey)}</p>{section.route ? <p className="mt-1 text-[11px] font-medium text-slate-400">Adaptive route · {section.route === 'higher' ? 'Higher' : 'Lower'}</p> : null}</div>
                <div className="text-right sm:text-left"><p className="text-[16px] font-semibold tabular-nums">{section.rawCorrect} / {section.operationalQuestionCount}</p><p className="mt-1 text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-400">Raw</p></div>
                <div className="hidden text-right sm:block"><p className="text-[16px] font-semibold tabular-nums">{section.scaledScore ?? '—'}</p><p className="mt-1 text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-400">Practice score</p></div>
              </div>
              {modules.length > 0 ? (
                <dl className="mt-2 space-y-1.5 rounded-xl bg-[var(--sat-staff-fill-faint,rgba(0,0,0,0.035))] p-3" aria-label={`${sectionTitle(section.sectionKey)} module raw scores`}>
                  {modules.map((module) => (
                    <div key={module.moduleKey} className="flex items-center justify-between gap-3 text-[12px]">
                      <div>
                        <dt className="font-semibold text-slate-700">{module.moduleKey}</dt>
                        <dd className="text-[10px] capitalize text-slate-400">{moduleRoleLabel(module.adaptiveRole)} · {module.state}</dd>
                      </div>
                      <dd className="font-semibold tabular-nums text-slate-900">{module.rawCorrect} / {module.operationalQuestionCount}</dd>
                    </div>
                  ))}
                </dl>
              ) : null}
            </div>
            );
          })}
        </div>
      </section> : <SatSectionCard labelledBy="sat-outcome-heading" className="mt-7">
        <div className="flex flex-wrap items-center gap-2">
          <h2 id="sat-outcome-heading" className="text-[17px] font-semibold tracking-[-0.025em]">Exam outcome</h2>
          <SatStatusPill tone={isInvalidated ? 'invalidated' : 'pending'}>{outcomeLabel(summary.outcomeStatus)}</SatStatusPill>
        </div>
        <p className="mt-3 max-w-xl text-[13px] leading-6 text-slate-600">{outcomeLabel(summary.outcomeStatus)}. No score was produced for this attempt.</p>
      </SatSectionCard>}

      {isScored ? (
        <section className="border-t border-[var(--sat-staff-border-input,rgba(0,0,0,0.075))] py-7" aria-labelledby="sat-questions-heading">
          <h2 id="sat-questions-heading" className="text-[17px] font-semibold tracking-[-0.025em]">Question-level responses ({questions.length})</h2>
          {questions.length > 0 ? (
              <div className="mt-4 space-y-8">
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
                      <h3 className="mb-3 text-[13px] font-semibold text-slate-800">{sectionTitle(section.sectionKey)}</h3>
                      <QuestionRawTable rows={rows} caption={`${sectionTitle(section.sectionKey)} question responses`} />
                    </SatSectionCard>
                  );
                })}
              </div>
            ) : (
              <p className="mt-3 text-[13px] text-slate-500">No question-level responses recorded for this result.</p>
            )}
        </section>
      ) : null}

      <p className="max-w-xl text-[10px] leading-5 text-slate-400">Scores shown here are generated by this practice assessment system. A value is only presented as a scaled practice score when the scoring policy produced one; otherwise the interface shows the raw correct count.</p>
    </div>
  );
}
