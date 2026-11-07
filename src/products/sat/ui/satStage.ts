import type { StudentSession } from '../../../types';
import type { ExamSessionRuntime } from '../../../types/domain';
import { satModuleSlotLabel } from './sessionRunSheet';

/**
 * The SAT room's stage facts: what stage the room and each candidate are on, and
 * whether the clock on that stage is running.
 *
 * ONE owner for the live-stage rule, because a surface that re-derives it can
 * disagree with the others about whether a countdown runs at all — the same
 * class of drift as two clocks reading different seconds. The route, each roster
 * row and the inspector panel all call these; none of them compares statuses
 * itself.
 */

/**
 * The projection a staff-control review shows while it sits open: the stage the
 * candidate is actually on per the room's latest read, and the seconds their own
 * stage clock holds against their deadline. Display only — the reviewed request
 * keeps the click-time stage, so the server's stage guard still catches a
 * candidate who moved on mid-review.
 */
export interface SatStudentLiveStage {
  /** Human stage label with presence suffix, e.g. `Reading & Writing · Module 1 · Paused`. */
  stage: string;
  /** The deadline the stage clock counts against; null when the read carried none. */
  deadlineAt: string | null;
  /** Whether that deadline is counting right now. */
  running: boolean;
  /** The stage clock's seconds per the latest read; the display clock's fallback. */
  fallbackSeconds: number;
}

/** Same composition as the inspector's `Current section` panel. */
function satSectionLabel(runtime: ExamSessionRuntime | null | undefined, key: string | null | undefined): string | null {
  const raw = typeof key === 'string' ? key.trim() : '';
  if (!raw) return null;
  return runtime?.sections.find((section) => section.sectionKey === raw)?.label?.trim() || raw;
}

/** The adaptive module slot this candidate is sitting, from whichever key the payload used. */
function satModuleRole(student: StudentSession): StudentSession['runtimeModuleRole'] {
  const extended = student as { runtimeModuleRole?: StudentSession['runtimeModuleRole']; runtimeCurrentModuleRole?: StudentSession['runtimeModuleRole'] };
  return extended.runtimeModuleRole ?? extended.runtimeCurrentModuleRole ?? null;
}

/**
 * One candidate's live stage in the shape the staff-control dialog ticks. The
 * clock follows the candidate's projection exactly as the inspector's panel
 * does: the module's own clock while one is known, the break clock on a break,
 * the section clock otherwise.
 */
export function satStudentLiveStage(
  runtime: ExamSessionRuntime | null | undefined,
  student?: StudentSession | null,
): SatStudentLiveStage | null {
  if (!student) return null;
  const presence = student.status === 'connecting' ? ' · Disconnected'
    : student.status === 'paused' ? ' · Paused' : '';
  const onBreak = student.runtimeStage === 'break';
  if (onBreak) {
    return {
      stage: `Break${presence}`,
      deadlineAt: student.runtimeBreakDeadlineAt ?? student.runtimeBreakEntryStartsAt ?? null,
      running: isSatBreakLive(runtime, student),
      fallbackSeconds: student.runtimeBreakRemainingSeconds
        ?? student.runtimeTimeRemainingSeconds
        ?? student.timeRemaining
        ?? 0,
    };
  }
  const moduleKnown = student.runtimeModuleRemainingSeconds != null
    || student.runtimeModuleDeadlineAt != null;
  const stage = [
    satSectionLabel(runtime, student.runtimeCurrentSection ?? student.currentSection),
    satModuleSlotLabel(satModuleRole(student)),
  ].filter(Boolean).join(' · ') + presence;
  if (moduleKnown) {
    return {
      stage,
      deadlineAt: student.runtimeModuleDeadlineAt ?? null,
      running: isSatAttemptLive(runtime, student) && student.runtimeModuleDeadlineAt != null,
      fallbackSeconds: student.runtimeModuleRemainingSeconds
        ?? student.runtimeTimeRemainingSeconds
        ?? student.timeRemaining
        ?? 0,
    };
  }
  return {
    stage,
    deadlineAt: student.runtimeDeadlineAt ?? runtime?.currentSectionDeadlineAt ?? null,
    running: isSatStageLive(runtime, student),
    fallbackSeconds: student.runtimeTimeRemainingSeconds ?? student.timeRemaining ?? 0,
  };
}

/**
 * The attempt status to trust: the candidate's own projection when the read
 * carried one, else the room's read of the same fact.
 */
function satAttemptStatus(
  runtime: ExamSessionRuntime | null | undefined,
  student?: StudentSession | null,
): string | null {
  return student?.runtimeStatus ?? runtime?.status ?? null;
}

/**
 * The stage status to trust: the candidate's stage when their read carried it,
 * else the room's stage for the key the candidate is sitting on. An omitted
 * field must not silently stop a live countdown.
 */
function satStageStatus(
  runtime: ExamSessionRuntime | null | undefined,
  student?: StudentSession | null,
): string | null {
  if (student?.runtimeSectionStatus) return student.runtimeSectionStatus;
  const key = student?.runtimeCurrentSection ?? runtime?.currentSectionKey ?? null;
  return runtime?.sections.find((section) => section.sectionKey === key)?.status ?? null;
}

/**
 * The attempt is live and not ended. The module clock counts on this alone: its
 * window belongs to the candidate's attempt, not to the section stage's status.
 */
export function isSatAttemptLive(
  runtime: ExamSessionRuntime | null | undefined,
  student?: StudentSession | null,
): boolean {
  if (satAttemptStatus(runtime, student) !== 'live') return false;
  return student?.status !== 'terminated';
}

/**
 * Is the stage that owns this clock live? Pass a candidate for their own clock
 * (their projection first, the room's read behind it); omit it for the room's
 * own clock.
 */
export function isSatStageLive(
  runtime: ExamSessionRuntime | null | undefined,
  student?: StudentSession | null,
): boolean {
  return isSatAttemptLive(runtime, student) && satStageStatus(runtime, student) === 'live';
}

/**
 * Is the candidate's break clock running? A break is a stage the attempt itself
 * owns (its own row, deadline and pause), so it does not ride the section
 * clock's status: the stage status reads `break` while it runs. A paused break
 * publishes no deadline — only the frozen remainder — so nothing ticks.
 */
export function isSatBreakLive(
  runtime: ExamSessionRuntime | null | undefined,
  student?: StudentSession | null,
): boolean {
  if (!isSatAttemptLive(runtime, student)) return false;
  if (student?.runtimeStage !== 'break') return false;
  return student.runtimeBreakDeadlineAt != null || student.runtimeBreakEntryStartsAt != null;
}
