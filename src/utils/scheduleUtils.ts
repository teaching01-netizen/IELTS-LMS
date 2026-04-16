import type { ExamSchedule, ExamSessionRuntime } from '../types/domain';

function toMs(value: string): number {
  return new Date(value).getTime();
}

export function isScheduleWindowOpen(
  schedule: Pick<ExamSchedule, 'startTime' | 'endTime'>,
  now: Date | string = new Date()
): boolean {
  const nowMs = typeof now === 'string' ? toMs(now) : now.getTime();
  return nowMs >= toMs(schedule.startTime) && nowMs < toMs(schedule.endTime);
}

export function isScheduleReadyToStart(
  schedule: Pick<ExamSchedule, 'status' | 'startTime' | 'endTime'>,
  runtime?: Pick<ExamSessionRuntime, 'status'> | null,
  now: Date | string = new Date()
): boolean {
  if (schedule.status !== 'scheduled') {
    return false;
  }

  if (runtime && runtime.status !== 'not_started') {
    return false;
  }

  return isScheduleWindowOpen(schedule, now);
}
