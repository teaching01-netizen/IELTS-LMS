import type { ReactNode } from 'react';
import { ArrowRight } from 'lucide-react';
import type { SatAccessGroupSummary, SatAttemptRow } from '../../../features/results/api/satResultsQueries';
import type { SatExamGroup, SatOutcomeCounts } from '../../../features/results/domain/satResultsGroups';
import { SatListRow, SatStatusPill, satOutcomeTone, type SatStatusTone } from '../ui/SatPage';
import { formatTestTime, testDayKey } from './satTestTime';

/** "1 attempt", "3 attempts": counts never read as "1 attempts". */
function countLabel(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

export function formatDate(value: string | null | undefined): string {
  const parts = formatTestTime(value);
  return parts ? parts.day : '—';
}

// Column templates are shared by header and rows so values align across records.
// Below sm each record stacks; every cell stays self-describing.
const EXAM_COLUMNS = 'sm:grid-cols-[168px_minmax(0,1.5fr)_88px_76px_minmax(0,1.3fr)_16px]';
const ACCESS_COLUMNS = 'sm:grid-cols-[168px_minmax(0,1.5fr)_64px_76px_minmax(0,1.3fr)_16px]';

const CELL_PRIMARY = 'block text-[14px] font-semibold leading-[1.45] tracking-[-0.012em] text-slate-900';
const CELL_SECONDARY = 'block text-[14px] leading-[1.45] tabular-nums text-slate-500';

function ColumnHeader({ columns, labels }: { columns: string; labels: string[] }) {
  return (
    <div aria-hidden="true" className={`mt-4 hidden gap-4 px-4 text-[14px] font-semibold text-slate-500 sm:grid ${columns}`}>
      {labels.map((label, index) => <span key={label + index} className={['Attempts', 'Score'].includes(label) ? 'text-right' : undefined}>{label}</span>)}
    </div>
  );
}

export function ExamColumnHeader() {
  return <ColumnHeader columns={EXAM_COLUMNS} labels={['Latest test', 'Exam', 'Rooms', 'Attempts', 'Outcomes', '']} />;
}

export function AccessColumnHeader() {
  return <ColumnHeader columns={ACCESS_COLUMNS} labels={['Latest test', 'Room', 'Version', 'Attempts', 'Outcomes', '']} />;
}

/** Date over time; never substitutes another timestamp when the start is unknown. */
function TestStartCell({ value, note }: { value: string | null | undefined; note?: string | null }) {
  const parts = formatTestTime(value);
  if (!parts) return <span className="min-w-0"><span className={CELL_SECONDARY}>Test time unavailable</span></span>;
  return (
    <span className="min-w-0">
      <span className={`${CELL_PRIMARY} tabular-nums`}>{parts.day}</span>
      <span className={CELL_SECONDARY}>{parts.time}{note ? ` · ${note}` : ''}</span>
    </span>
  );
}

function Chevron() {
  return <ArrowRight size={15} className="sat-row-chevron hidden shrink-0 text-slate-400 group-hover:text-slate-500 sm:block" aria-hidden="true" />;
}

function RowGrid({ columns, children }: { columns: string; children: ReactNode }) {
  return <span className={`grid w-full items-center gap-x-4 gap-y-1 py-3 ${columns}`}>{children}</span>;
}

export function outcomeCountsLine(counts: SatOutcomeCounts): string {
  const parts = [`${counts.completed} completed`];
  if (counts.running) parts.push(`${counts.running} running`);
  if (counts.ended) parts.push(`${counts.ended} ended`);
  if (counts.other) parts.push(`${counts.other} other`);
  return parts.join(' · ');
}

export function accessOutcomeCounts(group: SatAccessGroupSummary): SatOutcomeCounts {
  return {
    completed: group.completedCount ?? group.scoredCount + group.pendingCount,
    running: group.runningCount ?? 0,
    ended: group.endedCount ?? 0,
    other: group.otherCount ?? 0,
  };
}

export function hasMultipleTestDates(group: SatAccessGroupSummary): boolean {
  const first = testDayKey(group.earliestTestStartedAt);
  const last = testDayKey(group.latestTestStartedAt);
  return first != null && last != null && first !== last;
}

function attemptOutcome(attempt: SatAttemptRow): { label: string; tone: SatStatusTone } {
  switch (attempt.outcomeStatus) {
    case 'invalidated_proctor': return { label: 'Ended by proctor', tone: satOutcomeTone('invalidated_proctor') };
    case 'invalidated_timeout': return { label: 'Time expired', tone: satOutcomeTone('invalidated_timeout') };
    case 'scored': return { label: 'Completed', tone: satOutcomeTone('scored') };
    case 'pending': return { label: 'Completed', tone: satOutcomeTone('pending') };
    default: break;
  }
  switch (attempt.attemptStatus) {
    case 'running':
    case 'paused': return { label: 'In progress', tone: satOutcomeTone('unscored') };
    case 'submitted': return { label: 'Completed', tone: satOutcomeTone('pending') };
    case 'terminated': return { label: 'Ended by proctor', tone: satOutcomeTone('invalidated_proctor') };
    case 'locked': return { label: 'Ended', tone: satOutcomeTone('invalidated_timeout') };
    default: return { label: 'Status unavailable', tone: 'neutral' };
  }
}

/**
 * A number only when a score exists; never a zero stand-in. Otherwise the
 * reason there is none: still being taken, submitted and awaiting scoring, or
 * ended without a score.
 */
function totalScoreLabel(attempt: SatAttemptRow): string {
  if (attempt.totalScore != null) return String(attempt.totalScore);
  if (attempt.outcomeStatus.startsWith('invalidated_')) return 'Not scored';
  if (attempt.attemptStatus === 'running' || attempt.attemptStatus === 'paused') return 'Not submitted';
  if (attempt.outcomeStatus === 'pending' || attempt.attemptStatus === 'submitted') return 'Score pending';
  return 'Not scored';
}

export function versionLineFor(versions: number[]): string | null {
  if (versions.length === 0) return null;
  const first = versions[0];
  const last = versions[versions.length - 1];
  if (first === undefined || last === undefined) return null;
  if (versions.length === 1) return 'v' + first;
  return 'v' + first + '–v' + last;
}

export function aggregateLineFor(group: SatExamGroup): string {
  const groups = group.accessGroups?.length ?? 0;
  return `${countLabel(group.total, 'attempt')} · ${countLabel(groups, 'room')}`;
}

/**
 * Presentational exam-group row for the Results list view. No data fetching,
 * no router hooks, no domain grouping — the route owns navigation via onOpen.
 */
export function SatExamGroupRow({
  group,
  groupIndex,
  current = false,
  onOpen,
}: {
  group: SatExamGroup;
  groupIndex: number;
  /** The exam last opened from this list (marked when the reviewer returns). */
  current?: boolean;
  onOpen: (examId: string) => void;
}) {
  const versionLine = versionLineFor(group.versions);
  const counts = group.outcomeCounts ?? { completed: group.scored + group.pending, running: 0, ended: group.invalidated, other: 0 };
  return (
    <SatListRow index={Math.min(groupIndex, 5)} rowId={group.examId} current={current} onOpen={() => onOpen(group.examId)}>
      <RowGrid columns={EXAM_COLUMNS}>
        <TestStartCell value={group.latestTestStartedAt} />
        <span className="min-w-0">
          <span className={CELL_PRIMARY}>{group.examTitle}</span>
          {versionLine ? <span className={CELL_SECONDARY}>{versionLine}</span> : null}
        </span>
        <span className={`${CELL_SECONDARY} text-slate-700`}>{countLabel(group.accessGroups?.length ?? 0, 'room')}</span>
        <span className={`${CELL_SECONDARY} text-slate-700 sm:text-right`}>{countLabel(group.total, 'attempt')}</span>
        <span className={`${CELL_SECONDARY} text-slate-700`}>{group.total === 0 ? 'No attempts' : outcomeCountsLine(counts)}</span>
        <Chevron />
      </RowGrid>
    </SatListRow>
  );
}

export function SatAccessGroupRow({
  group,
  groupIndex,
  current = false,
  onOpen,
}: {
  group: SatAccessGroupSummary;
  groupIndex: number;
  /** The session last opened from this list. */
  current?: boolean;
  onOpen: (scheduleId: string) => void;
}) {
  const closed = group.accessLinkState && group.accessLinkState !== 'active' ? group.accessLinkState : null;
  return (
    <SatListRow index={Math.min(groupIndex, 5)} rowId={group.scheduleId} current={current} onOpen={() => onOpen(group.scheduleId)} ariaLabel={`${group.accessLinkName}, ${countLabel(group.attemptCount, 'attempt')}`}>
      <RowGrid columns={ACCESS_COLUMNS}>
        <TestStartCell value={group.latestTestStartedAt} note={hasMultipleTestDates(group) ? 'Multiple test dates' : null} />
        <span className="min-w-0">
          <span className={CELL_PRIMARY}>{group.accessLinkName}</span>
          <span className={CELL_SECONDARY}>{[group.cohortName, closed ? `Check-in ${closed}` : null].filter(Boolean).join(' · ') || 'No cohort'}</span>
        </span>
        <span className={`${CELL_SECONDARY} text-slate-700`}>v{group.versionNumber}</span>
        <span className={`${CELL_SECONDARY} text-slate-700 sm:text-right`}>{countLabel(group.attemptCount, 'attempt')}</span>
        <span className={`${CELL_SECONDARY} text-slate-700`}>{group.attemptCount === 0 ? 'No attempts' : outcomeCountsLine(accessOutcomeCounts(group))}</span>
        <Chevron />
      </RowGrid>
    </SatListRow>
  );
}

/**
 * The room's attempts as a comparison table: one row per attempt (a student
 * with two attempts gets two rows, told apart by their start time). Room and
 * version context sit above the table, not in every row. Each row's only
 * control is the review button, so no interactive element is nested.
 */
export function SatAttemptTable({
  attempts,
  currentAttemptId,
  onOpen,
}: {
  attempts: readonly SatAttemptRow[];
  /** The attempt open in the inspector. */
  currentAttemptId: string | null;
  onOpen: (attempt: SatAttemptRow) => void;
}) {
  return (
    <div className="sat-table-surface mt-3">
      <table className="sat-table min-w-[640px]">
        <caption className="sr-only">Student attempts</caption>
        <thead>
          <tr>
            <th scope="col">Student</th>
            <th scope="col">Test started</th>
            <th scope="col">Status</th>
            <th scope="col" className="sat-table__num">Score</th>
            <th scope="col"><span className="sr-only">Review</span></th>
          </tr>
        </thead>
        <tbody>
          {attempts.map((attempt) => {
            const outcome = attemptOutcome(attempt);
            const started = formatTestTime(attempt.testStartedAt);
            const scored = attempt.totalScore != null;
            const reviewLabel = attempt.outcomeStatus === 'scored' ? 'View answers' : 'View saved answers';
            return (
              <tr key={attempt.attemptId} data-sat-row-id={attempt.attemptId} aria-current={attempt.attemptId === currentAttemptId ? 'true' : undefined}>
                <th scope="row">
                  <span className="block font-semibold text-[var(--sat-staff-text-primary,#1d1d1f)]">{attempt.studentName}</span>
                  <span className="block text-[var(--sat-staff-text-secondary,#515154)]">{attempt.studentId}{attempt.cohortName ? ` · ${attempt.cohortName}` : ''}</span>
                </th>
                <td className="whitespace-nowrap">
                  {started ? (
                    <>
                      <span className="block">{started.day}</span>
                      <span className="block text-[var(--sat-staff-text-secondary,#515154)]">{started.time}</span>
                    </>
                  ) : <span className="text-[var(--sat-staff-text-secondary,#515154)]">Not started</span>}
                </td>
                <td><SatStatusPill tone={outcome.tone}>{outcome.label}</SatStatusPill></td>
                <td className={'sat-table__num whitespace-nowrap ' + (scored ? 'text-[16px] font-semibold' : 'text-[var(--sat-staff-text-secondary,#515154)]')}>{totalScoreLabel(attempt)}</td>
                <td className="text-right">
                  <button
                    type="button"
                    onClick={() => onOpen(attempt)}
                    aria-label={`${reviewLabel} for ${attempt.studentName}, ${outcome.label}`}
                    className="sat-btn sat-btn--quiet sat-press whitespace-nowrap px-3 text-[var(--sat-staff-accent,#0071e3)]"
                  >
                    {reviewLabel}
                    <ArrowRight size={16} aria-hidden="true" />
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
