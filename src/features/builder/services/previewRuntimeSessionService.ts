import { getEnabledModules } from '@services/examAdapterService';
import {
  backendPost,
  buildCreateSchedulePayload,
  mapBackendSchedule,
} from '@services/backendBridge';
import { examDeliveryService } from '@services/examDeliveryService';
import { examRepository } from '@services/examRepository';
import {
  ensureClientSessionIdForAttempt,
  studentAttemptRepository,
} from '@services/studentAttemptRepository';
import { studentSessionTransport } from '@services/studentSessionTransport';
import type { ExamState, ModuleType } from '../../../types';
import type { ExamEntity, ExamSchedule } from '../../../types/domain';

const PREVIEW_COHORT_PREFIX = '__preview_runtime__';
const PREVIEW_ACTOR = 'preview-runtime';
const PREVIEW_CANDIDATE_NAME = 'Preview Candidate';
const PREVIEW_CANDIDATE_EMAIL = 'preview@example.local';
const PREVIEW_TTL_MS = 24 * 60 * 60 * 1000;

export interface PreviewRuntimeSession {
  module: ModuleType;
  scheduleId: string;
  studentId: string;
}

interface ResolvePreviewRuntimeSessionOptions {
  exam: ExamEntity;
  state: ExamState;
  authorUserId: string;
  requestedModule: ModuleType | null;
  now?: Date;
}

export function isPreviewRuntimeCohortName(cohortName: string): boolean {
  return cohortName.startsWith(`${PREVIEW_COHORT_PREFIX}:`);
}

function buildPreviewRuntimeCohortName(examId: string, authorUserId: string, module: ModuleType): string {
  const authorToken = sanitizeToken(authorUserId);
  return `${PREVIEW_COHORT_PREFIX}:${examId}:${authorToken}:${module}`;
}

function sanitizeToken(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '_');
}

function parsePreviewRuntimeSection(
  schedule: Pick<ExamSchedule, 'cohortName'>,
): ModuleType | null {
  const parts = schedule.cohortName.split(':');
  const raw = parts[parts.length - 1]?.trim().toLowerCase();
  if (raw === 'listening' || raw === 'reading' || raw === 'writing' || raw === 'speaking') {
    return raw;
  }
  return null;
}

function isOlderThanTtl(updatedAt: string, now: Date): boolean {
  const updatedAtMs = Date.parse(updatedAt);
  if (!Number.isFinite(updatedAtMs)) {
    return true;
  }
  return now.getTime() - updatedAtMs > PREVIEW_TTL_MS;
}

function hashToSixDigits(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  const normalized = Math.abs(hash >>> 0) % 1_000_000;
  return normalized.toString().padStart(6, '0');
}

function buildPreviewCandidateId(examId: string, authorUserId: string, module: ModuleType): string {
  return `W${hashToSixDigits(`${examId}:${authorUserId}:${module}`)}`;
}

function buildStudentKey(scheduleId: string, candidateId: string): string {
  return `student-${scheduleId}-${candidateId}`;
}

function createPrecheckPayload() {
  const completedAt = new Date().toISOString();
  return {
    completedAt,
    browserFamily: 'chrome' as const,
    browserVersion: 120,
    screenDetailsSupported: true,
    heartbeatReady: true,
    acknowledgedSafariLimitation: false,
    checks: [
      {
        id: 'browser' as const,
        label: 'Browser compatibility',
        message: 'Preview runtime precheck bypass.',
        required: true,
        status: 'pass' as const,
      },
      {
        id: 'javascript' as const,
        label: 'JavaScript runtime',
        message: 'Preview runtime precheck bypass.',
        required: true,
        status: 'pass' as const,
      },
      {
        id: 'storage' as const,
        label: 'Secure local storage',
        message: 'Preview runtime precheck bypass.',
        required: true,
        status: 'pass' as const,
      },
      {
        id: 'online' as const,
        label: 'Network connectivity',
        message: 'Preview runtime precheck bypass.',
        required: true,
        status: 'pass' as const,
      },
      {
        id: 'screen-details' as const,
        label: 'Secondary screen detection',
        message: 'Preview runtime precheck bypass.',
        required: false,
        status: 'pass' as const,
      },
    ],
  };
}

async function createPreviewSchedule(
  exam: ExamEntity,
  versionId: string,
  module: ModuleType,
  authorUserId: string,
  now: Date,
): Promise<ExamSchedule> {
  const startTime = new Date(now.getTime() - 5 * 60 * 1000).toISOString();
  const endTime = new Date(now.getTime() + 8 * 60 * 60 * 1000).toISOString();

  const payload = buildCreateSchedulePayload({
    examId: exam.id,
    publishedVersionId: versionId,
    cohortName: buildPreviewRuntimeCohortName(exam.id, authorUserId, module),
    proctorDisplayName: `${exam.title} (Preview)`,
    gradingDisplayName: `${exam.title} (Preview)`,
    institution: 'preview-runtime',
    startTime,
    endTime,
    autoStart: true,
    autoStop: false,
  });

  const created = await backendPost<any>('/v1/schedules', payload);
  return mapBackendSchedule(created);
}

async function ensureRuntimeAtSection(scheduleId: string, targetModule: ModuleType): Promise<void> {
  const started = await examDeliveryService.startRuntime(scheduleId, PREVIEW_ACTOR);
  if (!started.success) {
    throw new Error(started.error ?? 'Failed to start preview runtime.');
  }

  const maxTransitions = 6;
  let transitions = 0;
  while (transitions < maxTransitions) {
    const runtime = await examDeliveryService.getRuntimeSnapshot(scheduleId);
    if (!runtime) {
      throw new Error('Preview runtime snapshot unavailable.');
    }

    if (runtime.currentSectionKey === targetModule && runtime.status === 'live') {
      return;
    }

    if (runtime.status === 'completed' || runtime.status === 'cancelled') {
      throw new Error('Preview runtime completed before reaching the selected section.');
    }

    const endSectionResult = await examDeliveryService.endCurrentSectionNow(
      scheduleId,
      PREVIEW_ACTOR,
      runtime.currentSectionKey,
    );
    if (!endSectionResult.success) {
      throw new Error(endSectionResult.error ?? 'Failed to switch preview section.');
    }

    transitions += 1;
  }

  throw new Error('Unable to position preview runtime on the selected section.');
}

async function ensurePreviewAttemptWithPrecheck(
  schedule: ExamSchedule,
  exam: ExamEntity,
  module: ModuleType,
  authorUserId: string,
): Promise<{ studentId: string }> {
  const studentId = buildPreviewCandidateId(exam.id, authorUserId, module);
  const studentKey = buildStudentKey(schedule.id, studentId);

  const attempt = await studentAttemptRepository.createAttempt({
    scheduleId: schedule.id,
    studentKey,
    examId: exam.id,
    examTitle: exam.title,
    candidateId: studentId,
    candidateName: PREVIEW_CANDIDATE_NAME,
    candidateEmail: PREVIEW_CANDIDATE_EMAIL,
    currentModule: module,
    phase: 'exam',
  });

  await backendPost<any>(
    studentSessionTransport.paths.precheck(schedule.id),
    {
      studentKey,
      candidateId: studentId,
      candidateName: PREVIEW_CANDIDATE_NAME,
      candidateEmail: PREVIEW_CANDIDATE_EMAIL,
      clientSessionId: ensureClientSessionIdForAttempt(attempt),
      preCheck: createPrecheckPayload(),
      deviceFingerprintHash: attempt.integrity.deviceFingerprintHash ?? undefined,
    },
    { retries: 0 },
  );

  return { studentId };
}

export async function resolvePreviewRuntimeSession(
  options: ResolvePreviewRuntimeSessionOptions,
): Promise<PreviewRuntimeSession> {
  const now = options.now ?? new Date();
  const enabledModules = getEnabledModules(options.state.config);
  if (enabledModules.length === 0) {
    throw new Error('Preview unavailable: no enabled exam sections.');
  }

  const draftVersionId =
    options.exam.currentDraftVersionId ?? options.exam.currentPublishedVersionId;
  if (!draftVersionId) {
    throw new Error('Preview unavailable: exam has no draft version.');
  }

  const schedules = await examRepository.getSchedulesByExam(options.exam.id);
  const previewSchedules = schedules.filter((schedule) =>
    isPreviewRuntimeCohortName(schedule.cohortName),
  );

  const sectionSchedules = new Map<ModuleType, ExamSchedule>();
  for (const schedule of previewSchedules) {
    const section = parsePreviewRuntimeSection(schedule);
    if (!section) {
      continue;
    }

    const expectedCohortName = buildPreviewRuntimeCohortName(
      options.exam.id,
      options.authorUserId,
      section,
    );
    if (schedule.cohortName !== expectedCohortName) {
      continue;
    }

    const isOutdated = schedule.publishedVersionId !== draftVersionId;
    const isExpired = isOlderThanTtl(schedule.updatedAt, now);
    if (isOutdated || isExpired) {
      try {
        await examRepository.deleteSchedule(schedule.id);
      } catch {
        // Best effort cleanup only.
      }
      continue;
    }

    sectionSchedules.set(section, schedule);
  }

  let resolvedModule: ModuleType;
  if (options.requestedModule && enabledModules.includes(options.requestedModule)) {
    resolvedModule = options.requestedModule;
  } else {
    const mostRecentSection = [...sectionSchedules.entries()]
      .sort((left, right) =>
        Date.parse(right[1].updatedAt) - Date.parse(left[1].updatedAt),
      )
      .find(([section]) => enabledModules.includes(section))?.[0];

    resolvedModule = mostRecentSection ?? enabledModules[0] ?? 'reading';
  }

  let schedule = sectionSchedules.get(resolvedModule);
  if (!schedule) {
    schedule = await createPreviewSchedule(
      options.exam,
      draftVersionId,
      resolvedModule,
      options.authorUserId,
      now,
    );
  }

  await ensureRuntimeAtSection(schedule.id, resolvedModule);
  const { studentId } = await ensurePreviewAttemptWithPrecheck(
    schedule,
    options.exam,
    resolvedModule,
    options.authorUserId,
  );

  return {
    module: resolvedModule,
    scheduleId: schedule.id,
    studentId,
  };
}
