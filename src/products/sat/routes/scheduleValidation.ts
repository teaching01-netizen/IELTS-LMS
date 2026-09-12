export type SatScheduleTimeErrors = {
  start?: string;
  end?: string;
};

/**
 * D2 scheduling policy (L0-frozen): reject past starts and sessions shorter
 * than 15 minutes. The optional `now` parameter defaults to the current time
 * and exists so tests can inject a deterministic clock (no fake timers).
 *
 * v1 LIMITATION (recorded, do not enforce here): no overlap /
 * double-booking check. This validator is a pure function over
 * (start, end, now) with no access to existing sessions; concurrent
 * bookings for the same exam/cohort are possible and would surface only in
 * the session list. Revisit if proctors report conflicts.
 */
const MIN_SAT_SESSION_DURATION_MS = 15 * 60 * 1000;

export function validateSatScheduleTimes(start: string, end: string, now: Date = new Date()): SatScheduleTimeErrors {
  const errors: SatScheduleTimeErrors = {};
  const startTime = start ? new Date(start).getTime() : Number.NaN;
  const endTime = end ? new Date(end).getTime() : Number.NaN;

  if (!start) errors.start = 'Choose a start time.';
  else if (!Number.isFinite(startTime)) errors.start = 'Enter a valid start time.';

  if (!end) errors.end = 'Choose an end time.';
  else if (!Number.isFinite(endTime)) errors.end = 'Enter a valid end time.';

  if (Object.keys(errors).length === 0) {
    if (startTime < now.getTime()) {
      errors.start = 'Start time is in the past.';
    } else if (endTime <= startTime) {
      errors.end = 'End time must be after the start time.';
    } else if (endTime - startTime < MIN_SAT_SESSION_DURATION_MS) {
      errors.end = 'Sessions must be at least 15 minutes long.';
    }
  }

  return errors;
}
