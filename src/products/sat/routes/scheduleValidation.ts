export type SatScheduleTimeErrors = {
  start?: string;
  end?: string;
};

export function validateSatScheduleTimes(start: string, end: string): SatScheduleTimeErrors {
  const errors: SatScheduleTimeErrors = {};
  const startTime = start ? new Date(start).getTime() : Number.NaN;
  const endTime = end ? new Date(end).getTime() : Number.NaN;

  if (!start) errors.start = 'Choose a start time.';
  else if (!Number.isFinite(startTime)) errors.start = 'Enter a valid start time.';

  if (!end) errors.end = 'Choose an end time.';
  else if (!Number.isFinite(endTime)) errors.end = 'Enter a valid end time.';

  if (Object.keys(errors).length === 0 && endTime <= startTime) {
    errors.end = 'End time must be after the start time.';
  }

  return errors;
}
