import { useMemo } from 'react';
import { ArrowRight } from 'lucide-react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import type { ClassroomReport } from '../../../features/student-delivery/ui/transitions/SatScoreReport';
import {
  buildStudentScoreReportView,
  fallbackModuleLabel,
  type ScoreDisplay,
  type SubjectReportView,
} from '../../../features/student-delivery/ui/transitions/score-report/scoreReportViewModel';
import type { SatQuestionResult, SatSectionResult } from '../../../features/results/api/satResultsQueries';
import { useSatResultQuery } from '../../../features/results/api/satResultsQueries';
import { SatPageError, SatPageLoading, SatSectionCard, type SatStatusTone } from '../ui/SatPage';
import { SatQuestionResponseTable } from '../ui/SatQuestionResponseTable';
import { SatAttemptDetailHeader } from '../ui/SatAttemptDetailHeader';
import { SatAnsweredExamDownload } from '../ui/SatAnsweredExamDownload';
import { isExamResponsesPath } from './satReturnPath';

const EMPTY_QUESTIONS: SatQuestionResult[] = [];

function sectionTitle(key: string): string {
  const normalized = key.toLocaleLowerCase().replace(/[-_]/g, ' ');
  if (normalized.includes('reading') || normalized.includes('writing')) return 'Reading & Writing';
  if (normalized.includes('math')) return 'Math';
  return normalized.replace(/\b\w/g, (character) => character.toUpperCase());
}

function sectionOrder(key: string): number {
  const normalized = key.toLocaleLowerCase();
  if (normalized === 'reading-writing') return 0;
  if (normalized === 'math') return 1;
  return 2;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function classroomRawReport(payload: unknown): ClassroomReport | null {
  if (!isRecord(payload)) return null;
  const raw = payload['classroomRaw'];
  if (!isRecord(raw) || typeof raw['rawCorrect'] !== 'number' || typeof raw['total'] !== 'number' || !Array.isArray(raw['sections'])) return null;
  if (!raw['sections'].every((section) => isRecord(section) && (!Array.isArray(section['modules']) || section['modules'].every(isRecord)))) return null;
  return raw as unknown as ClassroomReport;
}

function formatScaled(low: number, high: number): string {
  return low === high ? String(low) : `${low}–${high}`;
}

function scoreValue(score: ScoreDisplay | null): string {
  if (!score) return 'Unavailable';
  if (score.kind === 'estimated') return formatScaled(score.low, score.high);
  if (score.kind === 'raw') return `${score.correct} / ${score.total}`;
  return 'Unavailable';
}

function scoreScale(score: ScoreDisplay | null, singleSubject: boolean): string {
  if (score?.kind === 'estimated') return `${score.scale.min}–${score.scale.max} point scale`;
  if (score?.kind === 'raw') return 'Raw correct answers';
  if (singleSubject) return '200–800 point scale';
  return '400–1600 point scale';
}

function conversionReason(report: ClassroomReport | null, converterVersion: string | null, notice: string | null): string | null {
  if (!report) return 'Raw classroom score details are not present in this result.';
  const version = converterVersion ?? 'the active converter';
  const knownSections = new Set(['reading-writing', 'math']);
  const unknownSection = report.sections.find((section) => !knownSections.has(section.sectionKey));
  if (unknownSection) return `The converter does not recognize section key “${unknownSection.sectionKey}”.`;

  for (const section of report.sections) {
    const modules = Array.isArray(section.modules) ? section.modules : [];
    const unknownModule = modules.find((module) => !/(?:^|-)m1$|(?:^|-)m2-(?:lower|higher)$/.test(module.moduleKey));
    if (unknownModule) return `The converter does not recognize module route “${unknownModule.moduleKey}”.`;
  }
  if (!converterVersion) return 'No score conversion table is active for this sitting.';

  for (const section of report.sections) {
    if (section.conversionStatus === 'converted') continue;
    const modules = Array.isArray(section.modules) ? section.modules : [];
    const base = modules.find((module) => module.moduleKey.endsWith('-m1'));
    const branch = modules.find((module) => module.moduleKey.endsWith('-m2-lower') || module.moduleKey.endsWith('-m2-higher'));
    if (base && branch) return `No conversion table for M1 ${base.total} + M2 ${branch.total} questions in ${version}.`;
    if (branch) {
      const route = branch.moduleKey.endsWith('-m2-higher') ? 'Higher M2' : 'Lower M2';
      return `No conversion table for ${route} with ${branch.total} questions in ${version}.`;
    }
    if (base) return `No conversion table for M1 ${base.total} questions in ${version}.`;
  }
  const hasFullRoute = report.sections.every((section) => {
    const modules = Array.isArray(section.modules) ? section.modules : [];
    return modules.some((module) => module.moduleKey.endsWith('-m1')) && modules.some((module) => module.moduleKey.endsWith('-m2-lower') || module.moduleKey.endsWith('-m2-higher'));
  });
  if (!hasFullRoute) return 'A combined estimate needs Module 1 and an administered Module 2 route for both subjects.';
  return notice ?? `No conversion table matches this sitting in ${version}.`;
}

function outcomeStatusFor(outcomeStatus: string): { label: string; tone: SatStatusTone } {
  switch (outcomeStatus) {
    case 'invalidated_proctor': return { label: 'Ended by proctor', tone: 'invalidated' };
    case 'invalidated_timeout': return { label: 'Ended before scoring', tone: 'invalidated' };
    case 'pending': return { label: 'Completed · score pending', tone: 'pending' };
    default: return { label: 'Completed', tone: 'ready' };
  }
}

function unanswered(value: unknown): boolean {
  return value === null || value === undefined || (typeof value === 'string' && value.trim() === '');
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
  const sections: SatSectionResult[] = query.data?.sections ?? [];
  const questions = Array.isArray(query.data?.questions) ? query.data.questions : EMPTY_QUESTIONS;
  const report = useMemo(() => classroomRawReport(query.data?.scorePayload), [query.data?.scorePayload]);
  const scoreView = useMemo(() => report ? buildStudentScoreReportView(report) : null, [report]);
  const questionsBySection = useMemo(() => {
    const map = new Map<string, SatQuestionResult[]>();
    for (const question of questions) {
      const list = map.get(question.sectionKey) ?? [];
      list.push(question);
      map.set(question.sectionKey, list);
    }
    return map;
  }, [questions]);
  const answerCounts = useMemo(() => questions.reduce((counts, question) => {
    if (question.isCorrect === true) counts.correct += 1;
    if (question.isCorrect === false) counts.incorrect += 1;
    if (!question.isPretest && unanswered(question.response)) counts.unanswered += 1;
    if (question.markedForReview) counts.marked += 1;
    if (question.isPretest) counts.pretest += 1;
    return counts;
  }, { correct: 0, incorrect: 0, unanswered: 0, marked: 0, pretest: 0 }), [questions]);

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
  const primaryScore = scoreView?.primaryScore ?? null;
  const scoreIsUnavailable = !scoreView || primaryScore?.kind === 'unavailable' || (isScored && primaryScore === null);
  const explanation = isScored && (scoreIsUnavailable || !scoreView?.methodology.converterVersion)
    ? conversionReason(report, scoreView?.methodology.converterVersion ?? null, scoreView?.notice ?? null)
    : scoreView?.notice;
  const scoreSummary = (
    <div className="rounded-[var(--sat-staff-radius-card,14px)] border border-[var(--sat-staff-border-hairline,rgba(0,0,0,0.06))] bg-white px-5 py-4">
      <p className="text-[13px] font-semibold leading-5 text-[var(--sat-staff-text-secondary,#515154)]">Score summary</p>
      <p className="mt-2 text-[13px] leading-5 text-[var(--sat-staff-text-secondary,#515154)]">{isInvalidated ? 'Attempt outcome' : scoreView?.primaryLabel ?? 'SAT practice score'}</p>
      <p className="text-[30px] font-semibold leading-9 tracking-[-0.03em] tabular-nums text-[var(--sat-staff-text-primary,#1d1d1f)]">
        {isInvalidated ? 'Not scored' : isScored ? scoreValue(primaryScore) : summary.outcomeStatus === 'pending' ? 'Score pending' : 'Unavailable'}
      </p>
      <p className="mt-0.5 text-[12px] leading-4 text-[var(--sat-staff-text-secondary,#515154)]">{scoreScale(primaryScore, scoreView?.layout === 'single-subject')}</p>
      {isScored && scoreView?.methodology.converterVersion ? <p className="mt-1 text-[12px] leading-4 text-[var(--sat-staff-text-secondary,#515154)]">Converter {scoreView.methodology.converterVersion} · estimate only · not an official SAT score</p> : null}
      {isScored && !scoreView?.methodology.converterVersion ? <p className="mt-1 text-[12px] leading-4 text-[var(--sat-staff-text-secondary,#515154)]">Raw results · not an official SAT score</p> : null}
      {isScored && explanation ? <p className="mt-2 text-[12px] leading-4 text-[var(--sat-staff-text-secondary,#515154)]">{explanation} <Link className="font-semibold text-[var(--sat-staff-accent,#2563eb)] underline underline-offset-2" to="/sat/score-conversion">Score Conversion</Link></p> : null}
      {!isScored ? <p className="mt-1 text-[12px] leading-4 text-[var(--sat-staff-text-secondary,#515154)]">{isInvalidated ? 'The attempt ended without a score.' : 'Saved answers are available for review.'}</p> : null}
      <SatAnsweredExamDownload attemptId={summary.attemptId} />
      {query.isFetching && !query.isLoading ? <p role="status" className="mt-1 text-[12px] leading-4 text-[var(--sat-staff-text-tertiary,#6e6e73)]">Updating…</p> : null}
    </div>
  );

  const sectionByKey = new Map(sections.map((section) => [section.sectionKey, section]));

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
        summary={scoreSummary}
      />

      {isScored ? <>
        <section aria-label="Answer summary" className="grid grid-cols-2 gap-2 border-b border-[var(--sat-staff-border-hairline,rgba(0,0,0,0.06))] py-5 sm:grid-cols-5">
          {[
            ['Correct', answerCounts.correct],
            ['Incorrect', answerCounts.incorrect],
            ['Unanswered', answerCounts.unanswered],
            ['Marked', answerCounts.marked],
            ['Pretest', answerCounts.pretest],
          ].map(([label, count]) => (
            <div key={label} className="rounded-[var(--sat-staff-radius-control,10px)] bg-[var(--sat-staff-fill-faint,rgba(0,0,0,0.035))] px-3 py-2.5">
              <p className="text-[12px] leading-4 text-[var(--sat-staff-text-secondary,#515154)]">{label}</p>
              <p className="mt-0.5 text-[18px] font-semibold leading-6 tabular-nums text-[var(--sat-staff-text-primary,#1d1d1f)]">{count}</p>
            </div>
          ))}
        </section>

        <section className="py-7" aria-labelledby="sat-performance-heading">
          <h2 id="sat-performance-heading" className="text-[20px] font-semibold leading-7 tracking-[-0.015em]">Performance</h2>
          {scoreView?.subjects.length ? <div className="mt-4 grid gap-3 lg:grid-cols-2">
            {scoreView.subjects.map((subject) => {
              const detail = sectionByKey.get(subject.key);
              const moduleDetails = new Map((detail?.modules ?? []).map((module) => [module.moduleKey, module]));
              const accuracy = subject.rawTotal > 0 ? Math.round((subject.rawCorrect / subject.rawTotal) * 100) : 0;
              return <SubjectPerformanceCard key={subject.key} subject={subject} detail={detail} moduleDetails={moduleDetails} accuracy={accuracy} />;
            })}
          </div> : sections.length ? <div className="mt-4 grid gap-3 lg:grid-cols-2">
            {sections.map((section) => <SatSectionCard key={section.sectionKey}>
              <h3 className="text-[16px] font-semibold">{sectionTitle(section.sectionKey)}</h3>
              <p className="mt-2 tabular-nums">Raw correct · {section.rawCorrect} / {section.operationalQuestionCount}</p>
              {section.modules.length ? <dl className="mt-3 space-y-2 rounded-[var(--sat-staff-radius-control,10px)] bg-[var(--sat-staff-fill-faint,rgba(0,0,0,0.035))] p-3" aria-label={`${sectionTitle(section.sectionKey)} module raw scores`}>
                {section.modules.map((module) => <div key={module.moduleKey} className="flex items-center justify-between gap-3 text-[13px] leading-5">
                  <dt className="font-medium" title={module.moduleKey}>{fallbackModuleLabel(module.moduleKey)} · {module.adaptiveRole === 'base' ? 'Base' : module.adaptiveRole === 'higher_branch' ? 'Higher' : module.adaptiveRole === 'lower_branch' ? 'Lower' : 'Module'}</dt>
                  <dd className="text-right text-[var(--sat-staff-text-secondary,#515154)]">{module.state} · <span className="tabular-nums">{module.rawCorrect} / {module.operationalQuestionCount}</span></dd>
                </div>)}
              </dl> : null}
              <p className="mt-3 text-[14px] text-[var(--sat-staff-text-secondary,#515154)]">Score details are unavailable in the classroom result payload.</p>
            </SatSectionCard>)}
          </div> : <p className="mt-3 text-[14px] leading-5 text-[var(--sat-staff-text-secondary,#515154)]">No section performance details are available.</p>}
        </section>
      </> : <SatSectionCard labelledBy="sat-outcome-heading" className="mt-7">
        <h2 id="sat-outcome-heading" className="text-[20px] font-semibold leading-7 tracking-[-0.015em]">{isInvalidated ? 'Attempt ended' : 'Saved answers'}</h2>
        <p className="mt-2 max-w-xl text-[14px] leading-5 text-[var(--sat-staff-text-secondary,#515154)]">
          {isInvalidated ? `${status.label}. No score is produced for this attempt.` : 'This attempt has no score yet. Review the answers the server accepted for it.'}
        </p>
        {!isInvalidated ? (embedded
          ? <button type="button" onClick={() => onOpenAnswers?.(summary.attemptId)} className="sat-btn sat-btn--secondary sat-press mt-4">View saved answers<ArrowRight size={16} aria-hidden="true" /></button>
          : <Link to={`/sat/results/attempts/${encodeURIComponent(summary.attemptId)}`} state={{ from: backTarget }} className="sat-btn sat-btn--secondary sat-press mt-4">View saved answers<ArrowRight size={16} aria-hidden="true" /></Link>) : null}
      </SatSectionCard>}

      {isScored ? (
        <section className="border-t border-[var(--sat-staff-border-hairline,rgba(0,0,0,0.06))] py-7" aria-labelledby="sat-questions-heading">
          <h2 id="sat-questions-heading" className="text-[20px] font-semibold leading-7 tracking-[-0.015em]">Question-level responses ({questions.length})</h2>
          {questions.length > 0 ? <div className="mt-4 space-y-6">
            {Array.from(questionsBySection)
              .sort(([a], [b]) => sectionOrder(a) - sectionOrder(b) || a.localeCompare(b))
              .map(([sectionKey, rows]) => (
                <SatSectionCard key={sectionKey}>
                  <h3 className="mb-3 text-[16px] font-semibold leading-6 text-[var(--sat-staff-text-primary,#1d1d1f)]">{sectionTitle(sectionKey)}</h3>
                  <SatQuestionResponseTable rows={rows} caption={`${sectionTitle(sectionKey)} question responses`} />
                </SatSectionCard>
              ))}
          </div> : <p className="mt-3 text-[14px] leading-5 text-[var(--sat-staff-text-secondary,#515154)]">No question-level responses recorded for this result.</p>}
        </section>
      ) : null}
    </div>
  );
}

function SubjectPerformanceCard({
  subject,
  detail,
  moduleDetails,
  accuracy,
}: {
  subject: SubjectReportView;
  detail: SatSectionResult | undefined;
  moduleDetails: Map<string, SatSectionResult['modules'][number]>;
  accuracy: number;
}) {
  const score = subject.score.kind === 'estimated' ? formatScaled(subject.score.low, subject.score.high) : subject.score.kind === 'raw' ? `${subject.score.correct} / ${subject.score.total}` : 'Unavailable';
  const scoreLabel = subject.score.kind === 'estimated' ? 'Estimated section score' : subject.score.kind === 'raw' ? 'Raw section score' : 'Estimated score unavailable';
  const route = detail?.route ?? (subject.modules.some((module) => module.key.endsWith('-m2-higher')) ? 'higher' : subject.modules.some((module) => module.key.endsWith('-m2-lower')) ? 'lower' : null);
  return (
    <SatSectionCard className="p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-[16px] font-semibold leading-6 text-[var(--sat-staff-text-primary,#1d1d1f)]">{subject.label}</h3>
          {route ? <p className="mt-0.5 text-[13px] leading-5 text-[var(--sat-staff-text-secondary,#515154)]">Adaptive route · {route === 'higher' ? 'Higher' : 'Lower'}</p> : null}
        </div>
        <div className="text-right">
          <p className="text-[18px] font-semibold leading-6 tabular-nums text-[var(--sat-staff-text-primary,#1d1d1f)]">{score}</p>
          <p className="text-[12px] leading-4 text-[var(--sat-staff-text-secondary,#515154)]">{scoreLabel}</p>
        </div>
      </div>
      <div className="mt-4">
        <div className="flex items-center justify-between gap-3 text-[13px] leading-5">
          <span className="text-[var(--sat-staff-text-secondary,#515154)]">Raw correct</span>
          <span className="font-semibold tabular-nums text-[var(--sat-staff-text-primary,#1d1d1f)]">{subject.rawCorrect} / {subject.rawTotal} · {accuracy}%</span>
        </div>
        <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-[var(--sat-staff-fill-faint,rgba(0,0,0,0.06))]" role="img" aria-label={`${subject.label} accuracy ${accuracy}%`}>
          <div className="h-full rounded-full bg-[var(--sat-staff-accent,#2563eb)]" style={{ width: `${accuracy}%` }} />
        </div>
      </div>
      {subject.modules.length ? <dl className="mt-4 space-y-2 rounded-[var(--sat-staff-radius-control,10px)] bg-[var(--sat-staff-fill-faint,rgba(0,0,0,0.035))] p-3">
        {subject.modules.map((module) => {
          const detailModule = moduleDetails.get(module.key);
          const role = detailModule?.adaptiveRole === 'base' ? 'Base' : detailModule?.adaptiveRole === 'higher_branch' ? 'Higher' : detailModule?.adaptiveRole === 'lower_branch' ? 'Lower' : module.key.endsWith('-m2-higher') ? 'Higher' : module.key.endsWith('-m2-lower') ? 'Lower' : 'Base';
          return <div key={module.key} className="flex items-center justify-between gap-3 text-[13px] leading-5">
            <dt className="font-medium text-[var(--sat-staff-text-primary,#1d1d1f)]">{fallbackModuleLabel(module.key)} · {role}</dt>
            <dd className="tabular-nums text-[var(--sat-staff-text-secondary,#515154)]">{module.rawCorrect} / {module.rawTotal}</dd>
          </div>;
        })}
      </dl> : null}
      {subject.domains.length ? <div className="mt-4">
        <h4 className="text-[13px] font-semibold leading-5 text-[var(--sat-staff-text-primary,#1d1d1f)]">Domain accuracy</h4>
        <dl className="mt-1.5 space-y-1">
          {subject.domains.map((domain) => <div key={domain.name} className="flex items-center justify-between gap-3 text-[13px] leading-5">
            <dt className="text-[var(--sat-staff-text-secondary,#515154)]">{domain.name}</dt>
            <dd className="font-medium tabular-nums text-[var(--sat-staff-text-primary,#1d1d1f)]">{domain.accuracy === null ? 'No scored questions' : `${domain.correct} / ${domain.total} · ${domain.accuracy}%`}</dd>
          </div>)}
        </dl>
      </div> : <p className="mt-4 text-[13px] leading-5 text-[var(--sat-staff-text-secondary,#515154)]">Domain detail unavailable.</p>}
    </SatSectionCard>
  );
}
