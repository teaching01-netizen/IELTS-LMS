import { backendGet, hasBackendStatusCode, mapBackendSchedule } from "@services/backendBridge";
import type { ExamSchedule } from "../../../types/domain";

export async function getStudentEntrySchedule(scheduleId: string): Promise<ExamSchedule> {
  // Student entry is public until the registration POST mints the session.
  // The staff schedule route intentionally rejects student sessions, so the
  // entry preflight must use the public metadata projection.
  const payload = await backendGet<unknown>(
    `/v1/auth/student/schedules/${encodeURIComponent(scheduleId)}`,
    {
      retries: 0,
    }
  );
  return mapBackendSchedule(payload as Parameters<typeof mapBackendSchedule>[0]);
}

export function isStudentEntryScheduleBlockedError(error: unknown): boolean {
  return (
    hasBackendStatusCode(error, 404) ||
    hasBackendStatusCode(error, 410) ||
    hasBackendStatusCode(error, 403)
  );
}
