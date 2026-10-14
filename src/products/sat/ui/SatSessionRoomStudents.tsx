import { AlertTriangle, ChevronRight, MessageSquareWarning, Pause, Play, Timer } from 'lucide-react';
import type { StudentSession } from '../../../types';
import type { ExamSessionRuntime } from '../../../types/domain';
import { useAuthoritativeDeadlineClock, type ServerClockSnapshot } from '../../../shared/hooks/useAuthoritativeDeadlineClock';
import { formatRunSheetRemaining, satModuleSlotLabel } from './sessionRunSheet';
import { isSatAttemptLive, isSatBreakLive, isSatStageLive } from './satStage';

type StudentSessionWithModuleRole = StudentSession & {
  /** The server's own name for the SAT adaptive module slot. */
  runtimeCurrentModuleRole?: StudentSession['runtimeModuleRole'];
};

/** Current, actionable reasons only; historical warnings and violations are not open work. */
export function studentAttentionReason(
  _student: StudentSession,
  deviceChangePending: boolean,
  currentIssues: readonly string[] = [],
): string | null {
  const reasons: string[] = [];
  if (deviceChangePending) reasons.push('Device change pending');
  reasons.push(...currentIssues.map((issue) => issue.trim()).filter(Boolean));
  return reasons.length ? reasons.join(' · ') : null;
}

export function SatRoomStudentRow({
  student,
  runtime,
  roomClock,
  selected,
  attentionReason,
  onSelect,
}: {
  student: StudentSession;
  runtime: ExamSessionRuntime | null;
  roomClock?: ServerClockSnapshot | null | undefined;
  selected: boolean;
  /** From `studentAttentionReason`; shown beside the name so the proctor sees why. */
  attentionReason: string | null;
  onSelect: (trigger: HTMLButtonElement) => void;
}) {
  const fallbackSeconds = student.runtimeTimeRemainingSeconds ?? student.timeRemaining;
  const running = isSatStageLive(runtime, student);
  const remaining = useAuthoritativeDeadlineClock({
    deadlineAt: student.runtimeDeadlineAt ?? runtime?.currentSectionDeadlineAt ?? null,
    serverNow: student.runtimeServerNow ?? runtime?.serverNow ?? null,
    fallbackSeconds,
    running,
    roomClock,
    // The selected row is the one a proctor reads against the hero clock and the
    // inspector, so it must never ride the 15s band those two do not use.
    coarse: running && !selected && fallbackSeconds > 300,
  });
  const moduleKnown = student.runtimeModuleRemainingSeconds != null
    || student.runtimeModuleDeadlineAt != null;
  const moduleRemaining = useAuthoritativeDeadlineClock({
    deadlineAt: student.runtimeModuleDeadlineAt ?? null,
    serverNow: student.runtimeServerNow ?? runtime?.serverNow ?? null,
    fallbackSeconds: student.runtimeModuleRemainingSeconds ?? fallbackSeconds,
    running: running && student.runtimeModuleDeadlineAt != null,
    roomClock,
    coarse: running && !selected && fallbackSeconds > 300,
  });
  // The break is its own stage: while the candidate is on one they sit no
  // module, so the module clock above is empty and the row would read as a
  // clockless locked candidate. The break clock is what their own screen is
  // counting, and it can end before the room's section does.
  const onBreak = student.runtimeStage === 'break';
  const breakRemaining = useAuthoritativeDeadlineClock({
    deadlineAt: student.runtimeBreakDeadlineAt ?? student.runtimeBreakEntryStartsAt ?? null,
    serverNow: student.runtimeServerNow ?? runtime?.serverNow ?? null,
    fallbackSeconds: student.runtimeBreakRemainingSeconds ?? fallbackSeconds,
    running: isSatBreakLive(runtime, student),
    roomClock,
    coarse: running && !selected && fallbackSeconds > 300,
  });
  const studentState = student.satStartState === 'waiting_for_code' ? 'Waiting for start code'
    : student.satStartState === 'never_started' || student.status === 'terminated' ? 'Finished'
      : student.status === 'paused' ? 'Paused'
        : student.status === 'connecting' ? 'Disconnected'
          : student.runtimeWaiting ? 'Waiting for next section'
            : student.status === 'active' || student.status === 'warned' ? 'Working'
              : 'Waiting';
  const rowMeta = [
    onBreak ? 'On break' : null,
    sectionLabelFor(runtime, student.runtimeCurrentSection ?? student.currentSection),
    onBreak ? null : satModuleSlotLabel(moduleRoleFor(student)),
    studentState,
  ].filter(Boolean).join(' · ');

  // Before the room starts nothing is counting, so the row reads identity and
  // readiness only; afterwards the clock the student is on leads the right edge.
  const showClock = runtime?.status !== 'not_started';
  const time = student.satStartState === 'waiting_for_code' || student.satStartState === 'never_started'
    ? '—'
    : formatRunSheetRemaining(onBreak ? breakRemaining : moduleKnown ? moduleRemaining : remaining);

  return (
    <button
      type="button"
      id={`sat-room-student-${student.id}`}
      role="option"
      aria-selected={selected}
      aria-label={`Open ${student.name}${attentionReason ? `, needs attention: ${attentionReason}` : ''}`}
      aria-current={selected || undefined}
      tabIndex={-1}
      onClick={(event) => onSelect(event.currentTarget)}
      className="sat-room__row group relative grid min-h-16 w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 border-b border-[var(--sat-staff-border-hairline,rgba(0,0,0,0.06))] px-4 py-2.5 text-left transition-colors duration-150 before:absolute before:inset-y-2 before:left-0 before:w-[3px] before:rounded-r-full last:border-b-0 hover:bg-[var(--sat-staff-fill-faint,rgba(0,0,0,0.035))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--sat-staff-accent-ring,rgba(0,113,227,0.4))] aria-selected:bg-[var(--sat-staff-accent-tint,rgba(0,113,227,0.08))] aria-selected:before:bg-[var(--sat-staff-accent,#0071e3)] motion-reduce:transition-none"
    >
      <span className="min-w-0">
        <span className="flex min-w-0 items-baseline gap-2">
          <span aria-hidden="true" className={`h-1.5 w-1.5 shrink-0 -translate-y-0.5 rounded-full ${studentTone(student)}`} />
          <span className="min-w-0 break-words">
            <span className="sat-room__row-name text-[16px] font-semibold leading-6 tracking-[-0.01em] text-[var(--sat-staff-text-primary,#1d1d1f)]">{student.name}</span>
            <span className="ml-2 hidden text-[14px] tabular-nums text-[var(--sat-staff-text-tertiary,#6e6e73)] @md:inline">{student.studentId}</span>
            {attentionReason ? (
              <AlertTriangle size={14} className="ml-1.5 inline-block -translate-y-px align-baseline text-[var(--sat-staff-warning-dot,#d97706)]" aria-hidden="true" />
            ) : null}
          </span>
        </span>
        <span className="sat-room__row-meta block break-words pl-3.5 text-[14px] leading-5 text-[var(--sat-staff-text-tertiary,#6e6e73)]">{rowMeta}</span>
        {attentionReason ? (
          <span className="block break-words pl-3.5 text-[14px] font-medium leading-5 text-[var(--sat-staff-warning-text,#92400e)]">{attentionReason}</span>
        ) : null}
      </span>
      <span className="flex items-center gap-1.5">
        {showClock ? (
          <span className="text-right">
            <span className="sat-room__row-time block text-[14px] font-semibold leading-5 tabular-nums text-[var(--sat-staff-text-primary,#1d1d1f)]">{time}</span>
            {onBreak ? (
              <span className="sat-room__row-sub block text-[14px] leading-5 tabular-nums text-[var(--sat-staff-text-tertiary,#6e6e73)]">
                {student.runtimeBreakState === 'active' ? 'Break clock' : 'Break entry'}
              </span>
            ) : moduleKnown ? (
              <span className="sat-room__row-sub block text-[14px] leading-5 tabular-nums text-[var(--sat-staff-text-tertiary,#6e6e73)]">Section clock {formatRunSheetRemaining(remaining)}</span>
            ) : null}
          </span>
        ) : null}
        <ChevronRight size={16} aria-hidden="true" className="-mr-1 shrink-0 text-[var(--sat-staff-text-tertiary,#6e6e73)] opacity-50 transition-opacity duration-150 group-hover:opacity-100 group-aria-selected:opacity-100" />
      </span>
    </button>
  );
}

export function StudentDetail({
  student,
  runtime,
  roomClock,
  variant,
  pendingActions,
  blocked,
  onAddTime,
  onWarn,
  onPause,
  onResume,
  onTerminate,
}: {
  student: StudentSession;
  runtime: ExamSessionRuntime | null;
  roomClock?: ServerClockSnapshot | null | undefined;
  variant: 'operational' | 'review';
  pendingActions: ReadonlySet<string>;
  blocked: boolean;
  onAddTime: (minutes: number) => void;
  onWarn: () => void;
  onPause: () => void;
  onResume: () => void;
  onTerminate: () => void;
}) {
  const anyStudentPending = [
    'student-extend-5',
    'student-extend-10',
    'student-warn',
    'student-pause',
    'student-resume',
    'student-terminate',
  ].some((key) => pendingActions.has(key));
  const sectionRunning = isSatStageLive(runtime, student);
  // Both of the panel's clocks take the same source chain: the student's own
  // projection first, the room's read behind it. The section clock used to have
  // no fallback at all, so a read that omitted either field quietly froze it on
  // the last poll's seconds while every other clock on the page kept counting.
  const remaining = useAuthoritativeDeadlineClock({
    deadlineAt: student.runtimeDeadlineAt ?? runtime?.currentSectionDeadlineAt ?? null,
    serverNow: student.runtimeServerNow ?? runtime?.serverNow ?? null,
    fallbackSeconds: student.runtimeTimeRemainingSeconds ?? student.timeRemaining,
    running: sectionRunning,
    roomClock,
  });
  const moduleKnown = student.runtimeModuleRemainingSeconds != null
    || student.runtimeModuleDeadlineAt != null;
  const moduleRunning = isSatAttemptLive(runtime, student);
  const moduleRemaining = useAuthoritativeDeadlineClock({
    deadlineAt: student.runtimeModuleDeadlineAt ?? null,
    serverNow: student.runtimeServerNow ?? runtime?.serverNow ?? null,
    fallbackSeconds: student.runtimeModuleRemainingSeconds
      ?? student.runtimeTimeRemainingSeconds
      ?? student.timeRemaining,
    running: moduleRunning && student.runtimeModuleDeadlineAt != null,
    roomClock,
  });
  const onBreak = student.runtimeStage === 'break';
  const breakRemaining = useAuthoritativeDeadlineClock({
    deadlineAt: student.runtimeBreakDeadlineAt ?? student.runtimeBreakEntryStartsAt ?? null,
    serverNow: student.runtimeServerNow ?? runtime?.serverNow ?? null,
    fallbackSeconds: student.runtimeBreakRemainingSeconds
      ?? student.runtimeTimeRemainingSeconds
      ?? student.timeRemaining,
    running: isSatBreakLive(runtime, student),
    roomClock,
  });
  const sectionLabel = sectionLabelFor(runtime, student.runtimeCurrentSection);
  const moduleSlot = satModuleSlotLabel(moduleRoleFor(student));
  const actionDisabled = anyStudentPending || blocked;
  const hasAttention = student.warnings > 0 || student.violations.length > 0;
  const attentionCount = student.warnings + student.violations.length;
  const attentionFirst = variant === 'review' && hasAttention;

  return (
    <section
      className="sat-room__student-detail"
      aria-labelledby="sat-room-student-heading"
      data-sat-room-student-detail
      data-sat-room-student-variant={variant}
    >
      <div className="min-w-0">
        <p className="text-[14px] font-medium text-[var(--sat-staff-text-tertiary,#6e6e73)]">Student</p>
        <h2
          id="sat-room-student-heading"
          data-sat-room-student-heading
          tabIndex={-1}
          className="mt-0.5 break-words text-[20px] font-semibold leading-7 tracking-[-0.015em] text-[var(--sat-staff-text-primary,#1d1d1f)] focus-visible:outline-none"
        >
          {student.name}
        </h2>
        <p className="mt-0.5 break-all text-[14px] leading-5 text-[var(--sat-staff-text-secondary,#515154)]">
          {student.studentId}{student.email ? ` · ${student.email}` : ''}
        </p>
      </div>

      {attentionFirst ? <StudentAttention student={student} count={attentionCount} /> : null}

      <section className={DETAIL_SECTION} aria-label={variant === 'review' ? 'Exam state' : 'Current student state'}>
        <h3 className={DETAIL_HEADING}>{variant === 'review' ? 'Exam state' : 'Current'}</h3>
        <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-4">
          <DetailFact label="Current section" value={sectionLabel ?? '—'} />
          <DetailFact label="Current module" value={onBreak ? 'Break' : moduleSlot ?? student.currentSection ?? '—'} />
          <DetailFact
            label={onBreak ? 'Break clock' : 'Module clock'}
            clock
            value={onBreak
              ? formatRunSheetRemaining(breakRemaining)
              : moduleKnown
                ? formatRunSheetRemaining(moduleRemaining)
                : '—'}
          />
          <DetailFact label="Section clock" clock value={formatRunSheetRemaining(remaining)} />
          <DetailFact label="Attempt" value={student.status} capitalize />
        </dl>
      </section>

      {/* Actions here affect only this student; room-wide controls live in the
          room header. Each label says what it does, and each consequential
          action confirms with the student's name first. Ending the attempt is
          set apart so it is never the button a proctor hits by habit. */}
      <section className={DETAIL_SECTION} aria-labelledby="sat-room-student-actions-heading">
        <h3 id="sat-room-student-actions-heading" className={DETAIL_HEADING}>Actions for this student</h3>
        <div className="mt-3 grid grid-cols-[repeat(auto-fit,minmax(9.5rem,1fr))] gap-2">
          <button type="button" onClick={student.status === 'paused' ? onResume : onPause} disabled={actionDisabled} className="sat-btn sat-btn--secondary sat-press">
            {student.status === 'paused' ? <Play size={16} aria-hidden="true" /> : <Pause size={16} aria-hidden="true" />}
            {student.status === 'paused' ? 'Resume attempt' : 'Pause attempt'}
          </button>
          <button type="button" onClick={() => onAddTime(5)} disabled={actionDisabled} className="sat-btn sat-btn--secondary sat-press"><Timer size={16} aria-hidden="true" />Add 5 minutes…</button>
          <button type="button" onClick={onWarn} disabled={actionDisabled} className="sat-btn sat-btn--secondary sat-press"><MessageSquareWarning size={16} aria-hidden="true" />Send warning…</button>
        </div>
        <div className="mt-3 border-t border-[var(--sat-staff-border-hairline,rgba(0,0,0,0.06))] pt-3">
          <button type="button" onClick={onTerminate} disabled={actionDisabled} className="sat-btn sat-btn--danger-secondary sat-press">End attempt…</button>
        </div>
      </section>

      {!attentionFirst ? <StudentAttention student={student} count={attentionCount} /> : null}
    </section>
  );
}

const DETAIL_SECTION = 'mt-5 border-t border-[var(--sat-staff-border-hairline,rgba(0,0,0,0.06))] pt-4';
const DETAIL_HEADING = 'text-[14px] font-semibold text-[var(--sat-staff-text-primary,#1d1d1f)]';

function DetailFact({ label, value, clock = false, capitalize = false }: { label: string; value: string; clock?: boolean; capitalize?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-[14px] leading-5 text-[var(--sat-staff-text-tertiary,#6e6e73)]">{label}</dt>
      <dd className={`mt-0.5 [overflow-wrap:anywhere] font-semibold text-[var(--sat-staff-text-primary,#1d1d1f)] ${clock ? 'text-[20px] leading-7 tracking-[-0.02em] tabular-nums' : 'text-[15px] leading-6'}${capitalize ? ' capitalize' : ''}`}>{value}</dd>
    </div>
  );
}

function StudentAttention({ student, count }: { student: StudentSession; count: number }) {
  return (
    <section className={DETAIL_SECTION} aria-label={`Attention ${count}`}>
      <h3 className={DETAIL_HEADING}>Attention{count > 0 ? ` · ${count}` : ''}</h3>
      {student.warnings === 0 && student.violations.length === 0 ? (
        <p className="mt-2 flex items-center gap-2 text-[14px] leading-5 text-[var(--sat-staff-text-secondary,#515154)]">
          <span aria-hidden="true" className="sat-room__healthy-dot h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--sat-staff-success-dot,#059669)]" />
          No current warnings or integrity events.
        </p>
      ) : (
        <ul className="mt-3 space-y-2">
          {student.warnings > 0 ? (
            <li className="sat-room__attention-event rounded-[var(--sat-staff-radius-control,10px)] bg-[var(--sat-staff-warning-tint,rgba(217,119,6,0.1))] px-3 py-2.5 text-[14px] leading-5 text-[var(--sat-staff-warning-text,#92400e)]">
              {student.warnings} proctor warning{student.warnings === 1 ? '' : 's'}
            </li>
          ) : null}
          {student.violations.map((violation) => (
            <li key={violation.id} className="sat-room__attention-event rounded-[var(--sat-staff-radius-control,10px)] bg-[var(--sat-staff-warning-tint,rgba(217,119,6,0.1))] px-3 py-2.5 text-[14px] leading-5 text-[var(--sat-staff-warning-text,#92400e)]">
              <p className="font-semibold capitalize">{violation.type.replace(/_/g, ' ')}</p>
              <p className="mt-0.5">{violation.description}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function sectionLabelFor(runtime: ExamSessionRuntime | null, key: string | null | undefined): string | null {
  const raw = typeof key === 'string' ? key.trim() : '';
  if (!raw) return null;
  return runtime?.sections.find((section) => section.sectionKey === raw)?.label?.trim() || raw;
}

/**
 * The adaptive module slot this candidate is sitting, from whichever key the
 * payload used: the server's `runtimeCurrentModuleRole` or the client-side
 * `runtimeModuleRole`.
 */
function moduleRoleFor(student: StudentSession): StudentSession['runtimeModuleRole'] {
  const extended = student as StudentSessionWithModuleRole;
  return extended.runtimeModuleRole ?? extended.runtimeCurrentModuleRole ?? null;
}

function studentTone(student: StudentSession): string {
  if (student.status === 'terminated') return 'bg-[var(--sat-staff-neutral-dot,#6e6e73)]';
  if (student.status === 'paused' || student.status === 'warned' || student.violations.length > 0) {
    return 'bg-[var(--sat-staff-warning-dot,#d97706)]';
  }
  if (student.status === 'connecting' || student.status === 'idle') {
    return 'bg-[var(--sat-staff-neutral-dot,#6e6e73)]';
  }
  return 'bg-[var(--sat-staff-success-dot,#059669)]';
}
