import { ArrowRight } from 'lucide-react';
import type { SatResultSummary } from '../../../features/results/api/satResultsQueries';
import type { SatExamGroup } from '../../../features/results/domain/satResultsGroups';
import { SatListRow, SatStatusPill, satOutcomeTone } from '../ui/SatPage';

export function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return '—';
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(time));
}

export function outcomeLabel(outcomeStatus: string): string {
  switch (outcomeStatus) {
    case 'invalidated_proctor': return 'Exam terminated by proctor';
    case 'invalidated_timeout': return 'Exam ended before scoring';
    case 'pending': return 'Scoring pending';
    default: return 'Practice';
  }
}

export function versionLineFor(versions: number[]): string | null {
  if (versions.length === 0) return null;
  const first = versions[0];
  const last = versions[versions.length - 1];
  if (first === undefined || last === undefined) return null;
  if (versions.length === 1) return 'v' + first;
  return 'v' + first + '–v' + last;
}

export function cohortCountFor(group: SatExamGroup): number {
  const names = new Set<string>();
  for (const attempt of group.attempts) {
    names.add(attempt.cohortName ?? '');
  }
  return names.size;
}

export type ExamRollup = 'pending' | 'ready' | 'invalidated';

export function rollupFor(group: SatExamGroup): ExamRollup {
  if (group.pending > 0) return 'pending';
  if (group.scored > 0) return 'ready';
  return 'invalidated';
}

export function rollupToneFor(rollup: ExamRollup) {
  if (rollup === 'pending') return satOutcomeTone('pending');
  if (rollup === 'ready') return satOutcomeTone('scored');
  return satOutcomeTone('invalidated_proctor');
}

export function rollupLabelFor(rollup: ExamRollup): string {
  if (rollup === 'pending') return 'Scoring pending';
  if (rollup === 'ready') return outcomeLabel('scored');
  return 'Not scored';
}

export function aggregateLineFor(group: SatExamGroup): string {
  return group.total + ' attempts · ' + group.scored + ' scored · avg ' + (group.avgScore != null ? String(group.avgScore) : '—');
}

export function recencyLineFor(group: SatExamGroup): string {
  const cohortCount = cohortCountFor(group);
  return formatDate(group.latestSubmittedAt) + ' · ' + cohortCount + ' cohorts';
}

/**
 * Presentational exam-group row for the Results list view. No data fetching,
 * no router hooks, no domain grouping — the route owns navigation via onOpen.
 */
export function SatExamGroupRow({
  group,
  groupIndex,
  onOpen,
}: {
  group: SatExamGroup;
  groupIndex: number;
  onOpen: (examId: string) => void;
}) {
  const versionLine = versionLineFor(group.versions);
  const rollup = rollupFor(group);
  return (
    <SatListRow index={Math.min(groupIndex, 5)} onOpen={() => onOpen(group.examId)}>
      <span className="flex w-full items-center gap-4 py-3">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-semibold tracking-[-0.012em] text-slate-900">{group.examTitle}</span>
          <span className="mt-1 block truncate text-[10px] tabular-nums text-slate-400">{versionLine ? versionLine + ' · ' : ''}{aggregateLineFor(group)}</span>
          <span className="mt-1 block truncate text-[10px] tabular-nums text-slate-400">{recencyLineFor(group)}</span>
        </span>
        <span className="shrink-0"><SatStatusPill tone={rollupToneFor(rollup)}>{rollupLabelFor(rollup)}</SatStatusPill></span>
        <ArrowRight size={15} className="sat-row-chevron shrink-0 text-slate-400 group-hover:text-slate-500" aria-hidden="true" />
      </span>
    </SatListRow>
  );
}

/**
 * Presentational student attempt row for the inside view. Verbatim today's
 * attempt-row JSX — the route owns navigation via onOpen.
 */
export function SatExamAttemptRow({
  attempt,
  attemptIndex,
  onOpen,
}: {
  attempt: SatResultSummary;
  attemptIndex: number;
  onOpen: (attemptId: string) => void;
}) {
  return (
    <SatListRow index={Math.min(attemptIndex, 5)} onOpen={() => onOpen(attempt.id)}>
      <span className="flex w-full items-center gap-4 py-3">
        <span className="min-w-0 flex-1">
          {/* Density ladder: Results names at 13px + 17px score; Library titles sit at 14px. */}
          <span className="block truncate text-[13px] font-semibold tracking-[-0.012em] text-slate-900">{attempt.studentName}</span>
          <span className="mt-1 block truncate text-[10px] tabular-nums text-slate-400">{attempt.studentId} · {attempt.cohortName}</span>
          <span className="mt-1 block truncate text-[10px] tabular-nums text-slate-400">{attempt.examTitle} · Version {attempt.versionNumber} · {formatDate(attempt.submittedAt)}</span>
        </span>
        <span className="shrink-0 text-right">
          <span className="block text-[17px] font-semibold tabular-nums tracking-[-0.025em] text-slate-900">{attempt.outcomeStatus === 'scored' && attempt.totalScore != null ? attempt.totalScore : '—'}</span>
          <span className="mt-1.5 flex justify-end"><SatStatusPill tone={satOutcomeTone(attempt.outcomeStatus)}>{outcomeLabel(attempt.outcomeStatus)}</SatStatusPill></span>
        </span>
        <ArrowRight size={15} className="sat-row-chevron hidden shrink-0 text-slate-400 group-hover:text-slate-500 sm:block" aria-hidden="true" />
      </span>
    </SatListRow>
  );
}
