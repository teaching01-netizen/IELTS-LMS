import { z } from 'zod';
import { validateData } from '@shared/lib/validateApiResponse';
import type { ProctorSessionDetailPayload, ProctorSessionSummaryPayload } from '../api/proctorQueries';

/**
 * Runtime contract for the proctor monitoring reads, traced to
 * `backend/go/internal/proctor/sessions.go` (ProctorSessionSummary,
 * ProctorSessionDetail). Only what the monitoring screens depend on is
 * checked: entity identity, revisions, deadlines, provider, and collection
 * shapes. Every object is loose, so additive server fields pass through.
 */

const instant = z.string().nullish();
const revision = z.number().nullish();

const scheduleSchema = z.looseObject({
  id: z.string().min(1),
  examId: z.string().min(1),
  providerKey: z.enum(['ielts', 'sat', 'act']).optional(),
  publishedVersionId: z.string(),
  cohortName: z.string(),
  startTime: z.string(),
  endTime: z.string(),
  status: z.string(),
  revision: z.number(),
});

const runtimeSchema = z.looseObject({
  id: z.string(),
  scheduleId: z.string().min(1),
  examId: z.string(),
  providerKey: z.enum(['ielts', 'sat', 'act']).optional(),
  status: z.string(),
  revision,
  activeSectionKey: z.string().nullish(),
  currentSectionKey: z.string().nullish(),
  currentSectionRemainingSeconds: z.number(),
  currentSectionDeadlineAt: instant,
  serverNow: z.string().optional(),
  sections: z.array(z.looseObject({ sectionKey: z.string(), status: z.string() })),
});

const studentSessionSchema = z.looseObject({
  attemptId: z.string().min(1),
  studentId: z.string(),
  studentName: z.string(),
  scheduleId: z.string(),
  status: z.string(),
  runtimeDeadlineAt: instant,
  runtimeServerNow: instant,
  runtimeModuleDeadlineAt: instant,
  attemptRevision: revision,
  runtimeModuleAttemptId: z.string().nullish(),
  runtimeModuleAttemptRevision: revision,
  ieltsOfflinePreparedSection: z.string().nullish(),
  ieltsOfflinePreparedAt: instant,
  draftEvidencePending: z.number().nullish(),
  violations: z.array(z.unknown()).nullish(),
});

const summarySchema = z.looseObject({
  schedule: scheduleSchema,
  runtime: runtimeSchema,
  studentCount: z.number().optional(),
  activeCount: z.number().optional(),
  joinReadyCount: z.number().nullish(),
  joinTotalCount: z.number().nullish(),
  degradedLiveMode: z.boolean(),
});

const detailSchema = z.looseObject({
  schedule: scheduleSchema,
  runtime: runtimeSchema,
  sessions: z.array(studentSessionSchema),
  alerts: z.array(z.looseObject({ id: z.string().min(1), studentId: z.string(), isAcknowledged: z.boolean() })),
  auditLogs: z.array(z.looseObject({ id: z.string().min(1), createdAt: z.string() })),
  notes: z.array(z.looseObject({ id: z.string().min(1), createdAt: z.string() })),
  presence: z.array(z.looseObject({ proctorId: z.string() })),
  violationRules: z.array(z.looseObject({ id: z.string().min(1), scheduleId: z.string(), isEnabled: z.boolean() })),
  degradedLiveMode: z.boolean(),
});

/** Thrown when a well-formed payload describes a different entity than requested. */
export class MonitoringIdentityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MonitoringIdentityError';
  }
}

export function parseProctorSessionSummaries(payload: unknown): ProctorSessionSummaryPayload[] {
  const summaries = validateData(z.array(summarySchema), payload, 'proctor session summaries');
  for (const summary of summaries) {
    if (summary.runtime.scheduleId !== summary.schedule.id) {
      throw new MonitoringIdentityError('A room summary paired a runtime with a different schedule.');
    }
  }
  return summaries as unknown as ProctorSessionSummaryPayload[];
}

export function parseProctorSessionDetail(scheduleId: string, payload: unknown): ProctorSessionDetailPayload {
  const detail = validateData(detailSchema, payload, 'proctor session detail');
  if (detail.schedule.id !== scheduleId || detail.runtime.scheduleId !== scheduleId) {
    throw new MonitoringIdentityError('The room detail response belongs to a different room.');
  }
  if (detail.sessions.some((session) => session.scheduleId !== scheduleId)) {
    throw new MonitoringIdentityError('The room roster included a student from a different room.');
  }
  return detail as unknown as ProctorSessionDetailPayload;
}
