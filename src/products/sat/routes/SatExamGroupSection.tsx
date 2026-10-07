import type { ReactNode } from 'react';
import { ArrowRight } from 'lucide-react';
import type { SatAccessGroupSummary, SatAttemptRow } from '../../../features/results/api/satResultsQueries';
import type { SatExamGroup, SatOutcomeCounts } from '../../../features/results/domain/satResultsGroups';
import { SatListRow, SatStatusPill, satOutcomeTone, type SatStatusTone } from '../ui/SatPage';
import { formatTestTime, testDayKey } from './satTestTime';

export function formatDate(value: string | null | undefined): string {
  const parts = formatTestTime(value);
  return parts ? parts.day : '—';
}

// Column templates are shared by header and rows so values align across records.
// Below sm each record stacks; every cell stays self-describing.
const EXAM_COLUMNS = 'sm:grid-cols-[168px_minmax(0,1.5fr)_88px_76px_minmax(0,1.3fr)_16px]';
const ACCESS_COLUMNS = 'sm:grid-cols-[168px_minmax(0,1.5fr)_64px_76px_minmax(0,1.3fr)_16px]';
const ATTEMPT_COLUMNS = 'sm:grid-cols-[168px_minmax(0,1.5fr)_minmax(0,1fr)_88px_minmax(0,1fr)_16px]';

const CELL_PRIMARY = 'block text-[14px] font-semibold leading-[1.45] tracking-[-0.012em] text-slate-900';
const CELL_SECONDARY = 'block text-[12px] leading-[1.45] tabular-nums text-slate-500';

function ColumnHeader({ columns, labels }: { columns: string; labels: string[] }) {
  return (
    <div aria-hidden="true" className={`mt-4 hidden gap-4 px-4 text-[12px] font-semibold text-slate-500 sm:grid ${columns}`}>
      {labels.map((label, index) => <span key={label + index} className={label === 'Attempts' ? 'text-right' : undefined}>{label}</span>)}
    </div>
  );
}

export function ExamColumnHeader() {
  return <ColumnHeader columns={EXAM_COLUMNS} labels={['Latest test', 'Exam', 'Access groups', 'Attempts', 'Outcomes', '']} />;
}

export function AccessColumnHeader() {
  return <ColumnHeader columns={ACCESS_COLUMNS} labels={['Latest test', 'Student Access', 'Version', 'Attempts', 'Outcomes', '']} />;
}

export function AttemptColumnHeader() {
  return <ColumnHeader columns={ATTEMPT_COLUMNS} labels={['Test started', 'Student', 'Cohort', 'Submitted', 'Outcome', '']} />;
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

export function versionLineFor(versions: number[]): string | null {
  if (versions.length === 0) return null;
  const first = versions[0];
  const last = versions[versions.length - 1];
  if (first === undefined || last === undefined) return null;
  if (versions.length === 1) return 'v' + first;
  return 'v' + first + '–v' + last;
}

export function aggregateLineFor(group: SatExamGroup): string {
  return `${group.total} attempts · ${group.accessGroups?.length ?? 0} Student Access groups`;
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
  const counts = group.outcomeCounts ?? { completed: group.scored + group.pending, running: 0, ended: group.invalidated, other: 0 };
  return (
    <SatListRow index={Math.min(groupIndex, 5)} onOpen={() => onOpen(group.examId)}>
      <RowGrid columns={EXAM_COLUMNS}>
        <TestStartCell value={group.latestTestStartedAt} />
        <span className="min-w-0">
          <span className={CELL_PRIMARY}>{group.examTitle}</span>
          {versionLine ? <span className={CELL_SECONDARY}>{versionLine}</span> : null}
        </span>
        <span className={`${CELL_SECONDARY} text-slate-700`}>{group.accessGroups?.length ?? 0} groups</span>
        <span className={`${CELL_SECONDARY} text-slate-700 sm:text-right`}>{group.total} attempts</span>
        <span className={`${CELL_SECONDARY} text-slate-700`}>{group.total === 0 ? 'No attempts' : outcomeCountsLine(counts)}</span>
        <Chevron />
      </RowGrid>
    </SatListRow>
  );
}

export function SatAccessGroupRow({
  group,
  groupIndex,
  onOpen,
}: {
  group: SatAccessGroupSummary;
  groupIndex: number;
  onOpen: (scheduleId: string) => void;
}) {
  const closed = group.accessLinkState && group.accessLinkState !== 'active' ? group.accessLinkState : null;
  return (
    <SatListRow index={Math.min(groupIndex, 5)} onOpen={() => onOpen(group.scheduleId)} ariaLabel={`${group.accessLinkName}, ${group.attemptCount} attempts`}>
      <RowGrid columns={ACCESS_COLUMNS}>
        <TestStartCell value={group.latestTestStartedAt} note={hasMultipleTestDates(group) ? 'Multiple test dates' : null} />
        <span className="min-w-0">
          <span className={CELL_PRIMARY}>{group.accessLinkName}</span>
          <span className={CELL_SECONDARY}>{[group.cohortName, closed ? `Access ${closed}` : null].filter(Boolean).join(' · ') || 'No cohort'}</span>
        </span>
        <span className={`${CELL_SECONDARY} text-slate-700`}>v{group.versionNumber}</span>
        <span className={`${CELL_SECONDARY} text-slate-700 sm:text-right`}>{group.attemptCount} attempts</span>
        <span className={`${CELL_SECONDARY} text-slate-700`}>{group.attemptCount === 0 ? 'No attempts' : outcomeCountsLine(accessOutcomeCounts(group))}</span>
        <Chevron />
      </RowGrid>
    </SatListRow>
  );
}

/** One row per attempt; the route owns navigation via onOpen. */
export function SatExamAttemptRow({
  attempt,
  attemptIndex,
  onOpen,
}: {
  attempt: SatAttemptRow;
  attemptIndex: number;
  onOpen: (attempt: SatAttemptRow) => void;
}) {
  const outcome = attemptOutcome(attempt);
  const submitted = formatTestTime(attempt.submittedAt);
  const started = formatTestTime(attempt.testStartedAt);
  // Show the submission date too when it falls on a different day than the start.
  const submittedLabel = !submitted ? 'Not submitted' : started && started.day === submitted.day ? submitted.time : `${submitted.day} · ${submitted.time}`;
  return (
    <SatListRow index={Math.min(attemptIndex, 5)} onOpen={() => onOpen(attempt)}>
      <RowGrid columns={ATTEMPT_COLUMNS}>
        <TestStartCell value={attempt.testStartedAt} />
        <span className="min-w-0">
          <span className={`${CELL_PRIMARY} break-words`}>{attempt.studentName}</span>
          <span className={CELL_SECONDARY}>{attempt.studentId}</span>
        </span>
        <span className={`${CELL_SECONDARY} text-slate-700 break-words`}>{attempt.cohortName || '—'}</span>
        <span className={`${CELL_SECONDARY} text-slate-700`}>{submittedLabel}</span>
        <span className="flex min-w-0 flex-col items-start gap-0.5">
          <SatStatusPill tone={outcome.tone}>{outcome.label}</SatStatusPill>
          <span className={CELL_SECONDARY}>{attempt.outcomeStatus === 'scored' ? 'View answers' : 'View saved answers'}</span>
        </span>
        <Chevron />
      </RowGrid>
    </SatListRow>
  );
}
