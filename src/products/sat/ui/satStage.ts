import type { StudentSession } from '../../../types';
import type { ExamSessionRuntime } from '../../../types/domain';

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
