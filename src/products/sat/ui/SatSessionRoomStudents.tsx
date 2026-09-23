import { AlertTriangle, MoreHorizontal } from 'lucide-react';
import type { StudentSession } from '../../../types';
import type { ExamSessionRuntime } from '../../../types/domain';
import { useAuthoritativeDeadlineClock } from '../../../shared/hooks/useAuthoritativeDeadlineClock';
import { SatEyebrow } from './SatPage';
import { SatMenu } from './Menu';
import { formatRunSheetRemaining, satModuleSlotLabel } from './sessionRunSheet';

export function SatRoomStudentRow({
  student,
  runtime,
  selected,
  onSelect,
}: {
  student: StudentSession;
  runtime: ExamSessionRuntime | null;
  selected: boolean;
  onSelect: (trigger: HTMLButtonElement) => void;
}) {
  const fallbackSeconds = student.runtimeTimeRemainingSeconds ?? student.timeRemaining;
  const running = student.runtimeStatus === 'live'
    && student.runtimeSectionStatus === 'live'
    && student.status !== 'terminated';
  const remaining = useAuthoritativeDeadlineClock({
    deadlineAt: student.runtimeDeadlineAt ?? runtime?.currentSectionDeadlineAt ?? null,
    serverNow: student.runtimeServerNow ?? runtime?.serverNow ?? null,
    fallbackSeconds,
    running,
    coarse: running && fallbackSeconds > 300,
  });
  const moduleKnown = student.runtimeModuleRemainingSeconds != null
    || student.runtimeModuleDeadlineAt != null;
  const moduleRemaining = useAuthoritativeDeadlineClock({
    deadlineAt: student.runtimeModuleDeadlineAt ?? null,
    serverNow: student.runtimeServerNow ?? runtime?.serverNow ?? null,
    fallbackSeconds: student.runtimeModuleRemainingSeconds ?? fallbackSeconds,
    running: running && student.runtimeModuleDeadlineAt != null,
    coarse: running && fallbackSeconds > 300,
  });
  const rowMeta = [
    sectionLabelFor(runtime, student.runtimeCurrentSection ?? student.currentSection),
    satModuleSlotLabel(student.runtimeModuleRole),
    student.status,
  ].filter(Boolean).join(' · ');
  const needsAttention = student.warnings > 0 || student.violations.length > 0;

  return (
    <button
      type="button"
      id={`sat-room-student-${student.id}`}
      role="option"
      aria-selected={selected}
      aria-label={`Open ${student.name}${needsAttention ? ', needs attention' : ''}`}
      aria-current={selected || undefined}
      tabIndex={-1}
      onClick={(event) => onSelect(event.currentTarget)}
      className="sat-room__row focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-staff-accent-ring,rgba(0,113,227,0.4))]"
    >
      <span className="min-w-0">
        <span className="flex items-center gap-2">
          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${studentTone(student)}`} />
          <span className="sat-room__row-name">{student.name}</span>
          {needsAttention ? (
            <AlertTriangle size={12} className="shrink-0 text-[var(--sat-staff-warning-dot,#d97706)]" aria-hidden="true" />
          ) : null}
        </span>
        <span className="sat-room__row-meta pl-3.5">{rowMeta}</span>
      </span>
      <span className="text-right">
        <span className="sat-room__row-time">
          {formatRunSheetRemaining(moduleKnown ? moduleRemaining : remaining)}
        </span>
        {moduleKnown ? (
          <span className="sat-room__row-sub">Section clock {formatRunSheetRemaining(remaining)}</span>
        ) : null}
      </span>
    </button>
  );
}

export function StudentDetail({
  student,
  runtime,
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
  const remaining = useAuthoritativeDeadlineClock({
    deadlineAt: student.runtimeDeadlineAt ?? null,
    serverNow: student.runtimeServerNow ?? null,
    fallbackSeconds: student.runtimeTimeRemainingSeconds ?? student.timeRemaining,
    running: student.runtimeStatus === 'live'
      && student.runtimeSectionStatus === 'live'
      && student.status !== 'terminated',
  });
  const moduleKnown = student.runtimeModuleRemainingSeconds != null
    || student.runtimeModuleDeadlineAt != null;
  const moduleRunning = student.runtimeStatus === 'live' && student.status !== 'terminated';
  const moduleRemaining = useAuthoritativeDeadlineClock({
    deadlineAt: student.runtimeModuleDeadlineAt ?? null,
    serverNow: student.runtimeServerNow ?? runtime?.serverNow ?? null,
    fallbackSeconds: student.runtimeModuleRemainingSeconds
      ?? student.runtimeTimeRemainingSeconds
      ?? student.timeRemaining,
    running: moduleRunning && student.runtimeModuleDeadlineAt != null,
  });
  const sectionLabel = sectionLabelFor(runtime, student.runtimeCurrentSection);
  const moduleSlot = satModuleSlotLabel(student.runtimeModuleRole);
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
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <SatEyebrow>Student</SatEyebrow>
          <h2
            id="sat-room-student-heading"
            data-sat-room-student-heading
            tabIndex={-1}
            className="mt-1.5 truncate text-[19px] font-semibold tracking-[-0.02em]"
          >
            {student.name}
          </h2>
          <p className="mt-1 text-[12px] font-medium text-[var(--sat-staff-text-tertiary,#6e6e73)]">
            {student.studentId}{student.email ? ` · ${student.email}` : ''}
          </p>
        </div>
        <SatMenu
          label="Student actions"
          compact
          align="end"
          width={176}
          icon={MoreHorizontal}
          items={[
            { id: 'extend-5', label: 'Add 5 minutes…', disabled: actionDisabled, onSelect: () => onAddTime(5) },
            { id: 'warn', label: 'Send warning…', disabled: actionDisabled, onSelect: onWarn },
            {
              id: 'toggle',
              label: student.status === 'paused' ? 'Resume attempt' : 'Pause attempt',
              disabled: actionDisabled,
              onSelect: student.status === 'paused' ? onResume : onPause,
            },
            { id: 'terminate', label: 'End attempt…', destructive: true, disabled: actionDisabled, separatorBefore: true, onSelect: onTerminate },
          ]}
        />
      </div>

      {attentionFirst ? <StudentAttention student={student} count={attentionCount} /> : null}

      <section className="sat-room__student-state" aria-label={variant === 'review' ? 'Exam state' : 'Current student state'}>
        <h3 className="sat-room__eyebrow">{variant === 'review' ? 'Exam state' : 'Current'}</h3>
        <dl className="sat-room__student-state-grid">
          <div>
            <dt className="sat-room__eyebrow">Current section</dt>
            <dd>{sectionLabel ?? '—'}</dd>
          </div>
          <div>
            <dt className="sat-room__eyebrow">Current module</dt>
            <dd>{moduleSlot ?? student.currentSection ?? '—'}</dd>
          </div>
          <div>
            <dt className="sat-room__eyebrow">Module clock</dt>
            <dd className="is-clock">{moduleKnown ? formatRunSheetRemaining(moduleRemaining) : '—'}</dd>
          </div>
          <div>
            <dt className="sat-room__eyebrow">Section clock</dt>
            <dd className="is-clock">{formatRunSheetRemaining(remaining)}</dd>
          </div>
          <div>
            <dt className="sat-room__eyebrow">Attempt</dt>
            <dd className="capitalize">{student.status}</dd>
          </div>
        </dl>
      </section>

      {!attentionFirst ? <StudentAttention student={student} count={attentionCount} /> : null}
    </section>
  );
}

function StudentAttention({ student, count }: { student: StudentSession; count: number }) {
  return (
    <section className="sat-room__student-attention" aria-label={`Attention ${count}`}>
      <h3 className="sat-room__eyebrow">Attention{count > 0 ? ` · ${count}` : ''}</h3>
      {student.warnings === 0 && student.violations.length === 0 ? (
        <div className="sat-room__student-attention-healthy">
          <span aria-hidden="true" />
          No current warnings or integrity events.
        </div>
      ) : (
        <div className="mt-3 space-y-2">
          {student.warnings > 0 ? (
            <div className="sat-room__student-attention-event">
              {student.warnings} proctor warning{student.warnings === 1 ? '' : 's'}
            </div>
          ) : null}
          {student.violations.map((violation) => (
            <div key={violation.id} className="sat-room__student-attention-event">
              <p className="font-semibold capitalize">{violation.type.replace(/_/g, ' ')}</p>
              <p className="mt-0.5 font-medium leading-5">{violation.description}</p>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function sectionLabelFor(runtime: ExamSessionRuntime | null, key: string | null | undefined): string | null {
  const raw = typeof key === 'string' ? key.trim() : '';
  if (!raw) return null;
  return runtime?.sections.find((section) => section.sectionKey === raw)?.label?.trim() || raw;
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
