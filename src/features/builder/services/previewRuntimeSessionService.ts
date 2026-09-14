/**
 * Preview honesty contract.
 *
 * resolvePreviewRuntimeSession intentionally performs REAL backend writes
 * (schedule + attempt + precheck + runtime transitions) scoped to the isolated
 * ephemeral namespace '__preview_runtime__:<examId>:<author>:<module>' with
 * 24h TTL + outdated-version cleanup, so preview never touches real cohorts;
 * downstream answer-sync is separately disabled in the UI layer.
 */
import {
  backendPost,
  buildCreateSchedulePayload,
  mapBackendSchedule,
} from '../../exam-authoring/api/examAuthoringBackendGateway';
import { examDeliveryService, examRepository, getEnabledModules } from '../../exam-authoring/api/examAuthoringGateway';
import { ensureClientSessionIdForAttempt, studentAttemptRepository } from '../../student/api/studentAttemptGateway';
import { studentSessionTransport } from '../../student/api/studentSessionGateway';
import { buildAttemptAuthorizationHeader } from '../infrastructure/attemptCredential';
import type { ExamState, ModuleType } from '../../../types';
import type { ExamEntity, ExamSchedule } from '../../../types/domain';

export const PREVIEW_COHORT_PREFIX = '__preview_runtime__';
const PREVIEW_ACTOR = 'preview-runtime';
const PREVIEW_CANDIDATE_NAME = 'Preview Candidate';
const PREVIEW_CANDIDATE_EMAIL = 'preview@example.local';
const PREVIEW_TTL_MS = 24 * 60 * 60 * 1000;

export interface PreviewRuntimeSession {
  module: ModuleType;
  scheduleId: string;
  studentId: string;
  /**
   * Set when the requested section is not part of the live backend plan
   * (e.g. a legacy ACT row whose plan was derived under the wrong
   * provider): the resolver falls back to the runtime's actual live section
   * instead of hard-failing, and the route surfaces this as a notice.
   */
  planFallbackNotice?: string | undefined;
}

interface ResolvePreviewRuntimeSessionOptions {
  exam: ExamEntity;
  state: ExamState;
  authorUserId: string;
  requestedModule: ModuleType | null;
  now?: Date;
}

const inFlightPreviewSessions = new Map<string, Promise<PreviewRuntimeSession>>();

export function isPreviewRuntimeCohortName(cohortName: string): boolean {
  return cohortName.startsWith(`${PREVIEW_COHORT_PREFIX}:`);
}

export function buildPreviewRuntimeCohortName(examId: string, authorUserId: string, module: ModuleType): string {
  const authorToken = sanitizeToken(authorUserId);
  return `${PREVIEW_COHORT_PREFIX}:${examId}:${authorToken}:${module}`;
}

function sanitizeToken(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '_');
}

export function parsePreviewRuntimeSection(
  schedule: Pick<ExamSchedule, 'cohortName'>,
): ModuleType | null {
  const parts = schedule.cohortName.split(':');
  const raw = parts[parts.length - 1]?.trim().toLowerCase();
  if (raw === 'listening' || raw === 'reading' || raw === 'writing' || raw === 'speaking' || raw === 'science') {
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

function isPreviewSessionSupersededError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const candidate = error as {
    code?: unknown;
    backendCode?: unknown;
  };
  return (
    candidate.code === 'ACTIVE_SESSION_SUPERSEDED' ||
    candidate.backendCode === 'ACTIVE_SESSION_SUPERSEDED'
  );
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

export class PreviewRuntimeTerminalError extends Error {
  readonly scheduleId: string;
  constructor(scheduleId: string) {
    super('Preview runtime completed before reaching the selected section.');
    this.name = 'PreviewRuntimeTerminalError';
    this.scheduleId = scheduleId;
  }
}

export function isPreviewRuntimeTerminalError(error: unknown): error is PreviewRuntimeTerminalError {
  return error instanceof PreviewRuntimeTerminalError;
}

function isRuntimeAlreadyExistsError(error: unknown): boolean {
  if (error instanceof Error) {
    return isRuntimeAlreadyExistsError(error.message);
  }
  if (typeof error !== 'string') {
    return false;
  }
  return error.toLowerCase().includes('runtime already exists');
}

function isTerminalRuntimeStatus(status: string | null | undefined): boolean {
  return status === 'completed' || status === 'cancelled';
}

/**
 * Start is idempotent only for live/paused runtimes: any other existing row
 * (completed/cancelled) is a stable backend 409. Reuse the already-usable
 * runtime when it exists, and surface terminal rows explicitly so the caller
 * can abandon the poisoned schedule instead of retrying start forever.
 */
async function startPreviewRuntime(scheduleId: string): Promise<void> {
  const snapshot = await examDeliveryService.getRuntimeSnapshot(scheduleId);
  if (snapshot && !isTerminalRuntimeStatus(snapshot.status) && snapshot.status !== 'not_started') {
    return;
  }

  const started = await examDeliveryService.startRuntime(scheduleId, PREVIEW_ACTOR);
  if (started.success) {
    return;
  }

  if (isRuntimeAlreadyExistsError(started.error)) {
    const raced = await examDeliveryService.getRuntimeSnapshot(scheduleId);
    if (raced && !isTerminalRuntimeStatus(raced.status)) {
      // A concurrent start won the race; the existing runtime is usable.
      return;
    }
    throw new PreviewRuntimeTerminalError(scheduleId);
  }

  throw new Error(started.error ?? 'Failed to start preview runtime.');
}

export class PreviewSectionNotPlannedError extends Error {
  readonly scheduleId: string;
  readonly requestedModule: ModuleType;
  readonly liveSectionKey: ModuleType | null;
  constructor(scheduleId: string, requestedModule: ModuleType, liveSectionKey: ModuleType | null) {
    super(
      `Preview section "${requestedModule}" is not part of the live runtime plan.`,
    );
    this.name = 'PreviewSectionNotPlannedError';
    this.scheduleId = scheduleId;
    this.requestedModule = requestedModule;
    this.liveSectionKey = liveSectionKey;
  }
}

export function isPreviewSectionNotPlannedError(error: unknown): error is PreviewSectionNotPlannedError {
  return error instanceof PreviewSectionNotPlannedError;
}

async function ensureRuntimeAtSection(scheduleId: string, targetModule: ModuleType): Promise<void> {
  await startPreviewRuntime(scheduleId);

  const maxTransitions = 6;
  let transitions = 0;
  let planChecked = false;
  while (transitions < maxTransitions) {
    const runtime = await examDeliveryService.getRuntimeSnapshot(scheduleId);
    if (!runtime) {
      throw new Error('Preview runtime snapshot unavailable.');
    }

    if (isTerminalRuntimeStatus(runtime.status)) {
      throw new PreviewRuntimeTerminalError(scheduleId);
    }

    // Fail fast before ending any section: walking past a plan that never
    // contains the target completes the runtime and poisons this schedule
    // slot for every later preview visit. The caller converts this into a
    // fallback onto the runtime's actual live section.
    if (!planChecked) {
      planChecked = true;
      if (!runtime.sections.some((section) => section.sectionKey === targetModule)) {
        throw new PreviewSectionNotPlannedError(
          scheduleId,
          targetModule,
          runtime.currentSectionKey,
        );
      }
    }

    if (runtime.currentSectionKey === targetModule && runtime.status === 'live') {
      return;
    }

    const endSectionResult = await examDeliveryService.endCurrentSectionNow(
      scheduleId,
      PREVIEW_ACTOR,
      runtime.currentSectionKey,
      runtime.revision ?? undefined,
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

  try {
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
      {
        headers: buildAttemptAuthorizationHeader(attempt),
        retries: 0,
      },
    );
  } catch (error) {
    // Preview answer persistence is disabled, so a preview tab that reuses an
    // attempt owned by another preview tab can continue with a local precheck.
    // Real student sessions still surface this fence through their normal write
    // path.
    if (!isPreviewSessionSupersededError(error)) {
      throw error;
    }
  }

  return { studentId };
}

async function resolvePreviewRuntimeSessionUncached(
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
  const terminalPreviewSchedules: ExamSchedule[] = [];
  const orderedPreviewSchedules = [...previewSchedules].sort(
    (left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt),
  );
  for (const schedule of orderedPreviewSchedules) {
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

    // A terminal runtime (completed/cancelled) can never be restarted: the
    // backend Start() only reuses live/paused rows, and completed schedules
    // cannot be deleted either. Quarantine the slot now so a poisoned schedule
    // can no longer shadow a healthy duplicate or force a 409 on reuse.
    if (schedule.status === 'completed' || schedule.status === 'cancelled') {
      terminalPreviewSchedules.push(schedule);
      continue;
    }

    try {
      const runtime = await examDeliveryService.getRuntimeSnapshot(schedule.id);
      if (runtime && isTerminalRuntimeStatus(runtime.status)) {
        terminalPreviewSchedules.push(schedule);
        continue;
      }
    } catch {
      // A missing/unreadable runtime means the schedule was never started;
      // keep it as a startable candidate.
    }

    const incumbent = sectionSchedules.get(section);
    if (!incumbent) {
      sectionSchedules.set(section, schedule);
    }
  }
  for (const terminal of terminalPreviewSchedules) {
    try {
      await examRepository.deleteSchedule(terminal.id);
    } catch {
      // Completed schedules reject DELETE; replacement below still unblocks
      // preview, and the terminal row stays quarantined out of the map.
    }
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

  let schedule: ExamSchedule | undefined = sectionSchedules.get(resolvedModule);
  if (!schedule) {
    schedule = await createPreviewSchedule(
      options.exam,
      draftVersionId,
      resolvedModule,
      options.authorUserId,
      now,
    );
  }

  const finishWithAttempt = async (
    activeSchedule: ExamSchedule,
    activeModule: ModuleType,
    notice: string | undefined,
  ): Promise<PreviewRuntimeSession> => {
    const { studentId } = await ensurePreviewAttemptWithPrecheck(
      activeSchedule,
      options.exam,
      activeModule,
      options.authorUserId,
    );

    return {
      module: activeModule,
      scheduleId: activeSchedule.id,
      studentId,
      ...(notice ? { planFallbackNotice: notice } : {}),
    };
  };

  try {
    await ensureRuntimeAtSection(schedule.id, resolvedModule);
  } catch (error) {
    if (isPreviewSectionNotPlannedError(error)) {
      // The live backend plan does not contain the requested section (e.g.
      // a legacy ACT row planned under the wrong provider, or a stale
      // pinned version). Never end sections toward an unreachable target:
      // fall back to the runtime's actual live section so preview stays
      // usable, and let the route surface the mismatch as a notice.
      const fallback = error.liveSectionKey;
      if (!fallback || !enabledModules.includes(fallback)) {
        throw error;
      }
      resolvedModule = fallback;
      return finishWithAttempt(
        schedule,
        resolvedModule,
        `Preview section "${error.requestedModule}" is not part of the live runtime plan — showing "${fallback}" instead.`,
      );
    }
    if (!isPreviewRuntimeTerminalError(error)) {
      throw error;
    }
    // The reused schedule's runtime was already terminal (a previous walk
    // completed it, or the row was terminal before start). Mint a replacement
    // instead of surfacing the backend 409: the poisoned row can never be
    // restarted and completed schedules cannot be deleted.
    try {
      await examRepository.deleteSchedule(schedule.id);
    } catch {
      // Best effort: completed schedules reject DELETE; the replacement
      // below still unblocks preview.
    }
    schedule = await createPreviewSchedule(
      options.exam,
      draftVersionId,
      resolvedModule,
      options.authorUserId,
      now,
    );
    await ensureRuntimeAtSection(schedule.id, resolvedModule);
  }

  return finishWithAttempt(schedule, resolvedModule, undefined);
}

export function resolvePreviewRuntimeSession(
  options: ResolvePreviewRuntimeSessionOptions,
): Promise<PreviewRuntimeSession> {
  // React StrictMode and route revalidation can invoke the effect twice while
  // the first preview is still being provisioned. Coalesce that identical
  // backend workflow so two isolated schedules are never created concurrently.
  const draftVersionId = options.exam.currentDraftVersionId ?? options.exam.currentPublishedVersionId ?? '';
  const key = `${options.exam.id}:${options.authorUserId}:${draftVersionId}:${options.requestedModule ?? 'auto'}`;
  const existing = inFlightPreviewSessions.get(key);
  if (existing) {
    return existing;
  }

  const pending = resolvePreviewRuntimeSessionUncached(options);
  inFlightPreviewSessions.set(key, pending);
  const clearPending = () => {
    if (inFlightPreviewSessions.get(key) === pending) {
      inFlightPreviewSessions.delete(key);
    }
  };
  void pending.then(clearPending, clearPending);
  return pending;
}
