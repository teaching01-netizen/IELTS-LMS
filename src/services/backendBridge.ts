import {
  del,
  get,
  patch,
  post,
  put,
  type ApiRequestConfig,
} from '../app/api/apiClient';
import type {
  CohortControlEvent,
  ExamEntity,
  ExamEvent,
  ExamSchedule,
  ExamSessionRuntime,
  ExamVersion,
  ExamVersionSummary,
  SectionRuntimeState,
} from '../types/domain';
import type { ModuleType } from '../types';

type BackendEnvelope<T> = {
  success: boolean;
  data?: T | undefined;
  error?: {
    message?: string | undefined;
  } | undefined;
};

type BackendExamEntity = {
  id: string;
  slug: string;
  title: string;
  examType: ExamEntity['type'];
  status: ExamEntity['status'];
  visibility: ExamEntity['visibility'];
  ownerId: string;
  createdAt: string;
  updatedAt: string;
  publishedAt?: string | null | undefined;
  archivedAt?: string | null | undefined;
  currentDraftVersionId?: string | null | undefined;
  currentPublishedVersionId?: string | null | undefined;
  totalQuestions?: number | null | undefined;
  totalReadingQuestions?: number | null | undefined;
  totalListeningQuestions?: number | null | undefined;
  schemaVersion?: number | undefined;
  revision: number;
};

type BackendExamVersion = {
  id: string;
  examId: string;
  versionNumber: number;
  parentVersionId?: string | null | undefined;
  contentSnapshot: ExamVersion['contentSnapshot'];
  configSnapshot: ExamVersion['configSnapshot'];
  validationSnapshot?: ExamVersion['validationSnapshot'] | null | undefined;
  createdBy: string;
  createdAt: string;
  publishNotes?: string | null | undefined;
  isDraft: boolean;
  isPublished: boolean;
  revision?: number | undefined;
};

type BackendExamVersionSummary = {
  id: string;
  examId: string;
  versionNumber: number;
  parentVersionId?: string | null | undefined;
  validationSnapshot?: ExamVersion['validationSnapshot'] | null | undefined;
  createdBy: string;
  createdAt: string;
  publishNotes?: string | null | undefined;
  isDraft: boolean;
  isPublished: boolean;
};

type BackendExamEvent = {
  id: string;
  examId: string;
  versionId?: string | null | undefined;
  actorId: string;
  action: ExamEvent['action'];
  fromState?: ExamEvent['fromState'] | null | undefined;
  toState?: ExamEvent['toState'] | null | undefined;
  payload?: Record<string, unknown> | null | undefined;
  createdAt: string;
};

type BackendExamSchedule = {
  id: string;
  examId: string;
  examTitle: string;
  publishedVersionId: string;
  cohortName: string;
  institution?: string | null | undefined;
  startTime: string;
  endTime: string;
  plannedDurationMinutes: number;
  deliveryMode: ExamSchedule['deliveryMode'];
  recurrenceType: 'none' | 'daily' | 'weekly' | 'monthly';
  recurrenceInterval: number;
  recurrenceEndDate?: string | null | undefined;
  bufferBeforeMinutes?: number | null | undefined;
  bufferAfterMinutes?: number | null | undefined;
  autoStart: boolean;
  autoStop: boolean;
  status: ExamSchedule['status'];
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  revision: number;
};

type BackendRuntimeSectionState = {
  sectionKey: ModuleType;
  label: string;
  sectionOrder: number;
  plannedDurationMinutes: number;
  gapAfterMinutes: number;
  status: SectionRuntimeState['status'];
  availableAt?: string | null | undefined;
  actualStartAt?: string | null | undefined;
  actualEndAt?: string | null | undefined;
  pausedAt?: string | null | undefined;
  accumulatedPausedSeconds: number;
  extensionMinutes: number;
  completionReason?: SectionRuntimeState['completionReason'] | null | undefined;
  projectedStartAt?: string | null | undefined;
  projectedEndAt?: string | null | undefined;
};

type BackendExamSessionRuntime = {
  id: string;
  scheduleId: string;
  examId: string;
  status: ExamSessionRuntime['status'];
  actualStartAt?: string | null | undefined;
  actualEndAt?: string | null | undefined;
  activeSectionKey?: ModuleType | null | undefined;
  currentSectionKey?: ModuleType | null | undefined;
  currentSectionRemainingSeconds: number;
  waitingForNextSection: boolean;
  isOverrun: boolean;
  totalPausedSeconds: number;
  createdAt: string;
  updatedAt: string;
  sections: BackendRuntimeSectionState[];
};

const examRevisions = new Map<string, number>();
const scheduleRevisions = new Map<string, number>();
const attemptSchedules = new Map<string, string>();

function envFlag(name: string): boolean {
  const env = import.meta.env as Record<string, string | boolean | undefined>;
  return String(env[name] ?? 'false') === 'true';
}

function featureFlag(viteName: string, legacyName: string): boolean {
  return envFlag(viteName) || envFlag(legacyName);
}

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') {
    return null;
  }

  const prefix = `${name}=`;
  const match = document.cookie
    .split(';')
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith(prefix));

  return match ? decodeURIComponent(match.slice(prefix.length)) : null;
}

function hasAuthenticatedSessionCookie(): boolean {
  const configuredName = import.meta.env['VITE_AUTH_SESSION_COOKIE_NAME'];
  const cookieNames = [
    typeof configuredName === 'string' ? configuredName : null,
    '__Host-session',
  ].filter((value): value is string => Boolean(value));

  return cookieNames.some((cookieName) => Boolean(readCookie(cookieName)));
}

function isBackendEnvelope<T>(value: unknown): value is BackendEnvelope<T> {
  return (
    typeof value === 'object' &&
    value !== null &&
    'success' in value &&
    typeof (value as { success?: unknown }).success === 'boolean'
  );
}

function extractBackendData<T>(value: unknown): T {
  if (isBackendEnvelope<T>(value)) {
    if (!value.success) {
      throw new Error(value.error?.message ?? 'Backend request failed');
    }

    return value.data as T;
  }

  return value as T;
}

function compactObject<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, fieldValue]) => fieldValue !== undefined),
  ) as T;
}

export function isBackendBuilderEnabled(): boolean {
  return true;
}

export function isBackendLibraryEnabled(): boolean {
  return true;
}

export function isBackendSchedulingEnabled(): boolean {
  return true;
}

export function isBackendDeliveryEnabled(): boolean {
  return true;
}

export function isBackendProctoringEnabled(): boolean {
  return true;
}

export function isBackendGradingEnabled(): boolean {
  return true;
}

export function hasBackendStatusCode(error: unknown, statusCode: number): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'statusCode' in error &&
    (error as { statusCode?: unknown }).statusCode === statusCode
  );
}

export function isBackendNotFound(error: unknown): boolean {
  return hasBackendStatusCode(error, 404);
}

export function rememberExamRevision(id: string, revision: number | undefined): void {
  if (Number.isInteger(revision)) {
    examRevisions.set(id, revision as number);
  }
}

export function getExamRevision(id: string): number | undefined {
  return examRevisions.get(id);
}

export function clearExamRevision(id: string): void {
  examRevisions.delete(id);
}

export function rememberScheduleRevision(id: string, revision: number | undefined): void {
  if (Number.isInteger(revision)) {
    scheduleRevisions.set(id, revision as number);
  }
}

export function getScheduleRevision(id: string): number | undefined {
  return scheduleRevisions.get(id);
}

export function clearScheduleRevision(id: string): void {
  scheduleRevisions.delete(id);
}

export function rememberAttemptSchedule(attemptId: string, scheduleId: string): void {
  attemptSchedules.set(attemptId, scheduleId);
}

export function getAttemptSchedule(attemptId: string): string | undefined {
  return attemptSchedules.get(attemptId);
}

export async function backendGet<T>(endpoint: string, config?: ApiRequestConfig): Promise<T> {
  const response = await get<BackendEnvelope<T> | T>(endpoint, config);
  return extractBackendData<T>(response.data);
}

export async function backendPost<T, TBody = unknown>(
  endpoint: string,
  body?: TBody,
  config?: ApiRequestConfig,
): Promise<T> {
  const response = await post<BackendEnvelope<T> | T>(endpoint, body, config);
  return extractBackendData<T>(response.data);
}

export async function backendPut<T, TBody = unknown>(
  endpoint: string,
  body?: TBody,
  config?: ApiRequestConfig,
): Promise<T> {
  const response = await put<BackendEnvelope<T> | T>(endpoint, body, config);
  return extractBackendData<T>(response.data);
}

export async function backendPatch<T, TBody = unknown>(
  endpoint: string,
  body: TBody,
  config?: ApiRequestConfig,
): Promise<T> {
  const response = await patch<BackendEnvelope<T> | T>(endpoint, body, config);
  return extractBackendData<T>(response.data);
}

export async function backendDelete(endpoint: string, config?: ApiRequestConfig): Promise<void> {
  await del<BackendEnvelope<unknown> | unknown>(endpoint, config);
}

export function buildCreateExamPayload(exam: Pick<ExamEntity, 'slug' | 'title' | 'type' | 'visibility'>) {
  return {
    slug: exam.slug,
    title: exam.title,
    examType: exam.type,
    visibility: exam.visibility,
  };
}

export function buildUpdateExamPayload(
  exam: Pick<ExamEntity, 'title' | 'status' | 'visibility'>,
  revision: number,
) {
  return compactObject({
    title: exam.title,
    status: exam.status,
    visibility: exam.visibility,
    revision,
  });
}

export function buildCreateSchedulePayload(
  schedule: Pick<
    ExamSchedule,
    'examId' | 'publishedVersionId' | 'cohortName' | 'institution' | 'startTime' | 'endTime' | 'autoStart' | 'autoStop'
  >,
) {
  return {
    examId: schedule.examId,
    publishedVersionId: schedule.publishedVersionId,
    cohortName: schedule.cohortName,
    institution: schedule.institution,
    startTime: schedule.startTime,
    endTime: schedule.endTime,
    autoStart: schedule.autoStart,
    autoStop: schedule.autoStop,
  };
}

export function buildUpdateSchedulePayload(schedule: ExamSchedule, revision: number) {
  return compactObject({
    publishedVersionId: schedule.publishedVersionId,
    cohortName: schedule.cohortName,
    institution: schedule.institution,
    startTime: schedule.startTime,
    endTime: schedule.endTime,
    autoStart: schedule.autoStart,
    autoStop: schedule.autoStop,
    status: schedule.status,
    revision,
  });
}

export function mapBackendExamEntity(payload: BackendExamEntity): ExamEntity {
  rememberExamRevision(payload.id, payload.revision);

  return {
    id: payload.id,
    slug: payload.slug,
    title: payload.title,
    type: payload.examType,
    status: payload.status,
    visibility: payload.visibility,
    owner: payload.ownerId,
    createdAt: payload.createdAt,
    updatedAt: payload.updatedAt,
    publishedAt: payload.publishedAt ?? undefined,
    archivedAt: payload.archivedAt ?? undefined,
    currentDraftVersionId: payload.currentDraftVersionId ?? null,
    currentPublishedVersionId: payload.currentPublishedVersionId ?? null,
    canEdit: true,
    canPublish: true,
    canDelete: true,
    totalQuestions: payload.totalQuestions ?? undefined,
    totalReadingQuestions: payload.totalReadingQuestions ?? undefined,
    totalListeningQuestions: payload.totalListeningQuestions ?? undefined,
    schemaVersion: payload.schemaVersion ?? 1,
  };
}

export function mapBackendExamVersion(payload: BackendExamVersion): ExamVersion {
  return {
    id: payload.id,
    examId: payload.examId,
    versionNumber: payload.versionNumber,
    parentVersionId: payload.parentVersionId ?? null,
    contentSnapshot: payload.contentSnapshot,
    configSnapshot: payload.configSnapshot,
    validationSnapshot: payload.validationSnapshot ?? undefined,
    createdBy: payload.createdBy,
    createdAt: payload.createdAt,
    publishNotes: payload.publishNotes ?? undefined,
    isDraft: payload.isDraft,
    isPublished: payload.isPublished,
  };
}

export function mapBackendExamVersionSummary(payload: BackendExamVersionSummary): ExamVersionSummary {
  return {
    id: payload.id,
    examId: payload.examId,
    versionNumber: payload.versionNumber,
    parentVersionId: payload.parentVersionId ?? null,
    validationSnapshot: payload.validationSnapshot ?? undefined,
    createdBy: payload.createdBy,
    createdAt: payload.createdAt,
    publishNotes: payload.publishNotes ?? undefined,
    isDraft: payload.isDraft,
    isPublished: payload.isPublished,
  };
}

export function mapBackendExamEvent(payload: BackendExamEvent): ExamEvent {
  return {
    id: payload.id,
    examId: payload.examId,
    versionId: payload.versionId ?? undefined,
    actor: payload.actorId,
    action: payload.action,
    fromState: payload.fromState ?? undefined,
    toState: payload.toState ?? undefined,
    timestamp: payload.createdAt,
    payload: payload.payload ?? undefined,
  };
}

export function mapBackendSchedule(payload: BackendExamSchedule): ExamSchedule {
  rememberScheduleRevision(payload.id, payload.revision);

  return {
    id: payload.id,
    examId: payload.examId,
    examTitle: payload.examTitle,
    publishedVersionId: payload.publishedVersionId,
    cohortName: payload.cohortName,
    institution: payload.institution ?? undefined,
    startTime: payload.startTime,
    endTime: payload.endTime,
    plannedDurationMinutes: payload.plannedDurationMinutes,
    deliveryMode: payload.deliveryMode,
    recurrence:
      payload.recurrenceType === 'none'
        ? undefined
        : {
            type: payload.recurrenceType,
            interval: payload.recurrenceInterval,
            endDate: payload.recurrenceEndDate ?? undefined,
          },
    bufferBeforeMinutes: payload.bufferBeforeMinutes ?? undefined,
    bufferAfterMinutes: payload.bufferAfterMinutes ?? undefined,
    autoStart: payload.autoStart,
    autoStop: payload.autoStop,
    status: payload.status,
    createdAt: payload.createdAt,
    createdBy: payload.createdBy,
    updatedAt: payload.updatedAt,
  };
}

export function mapBackendRuntime(
  payload: BackendExamSessionRuntime,
  schedule: Pick<ExamSchedule, 'examTitle' | 'cohortName' | 'deliveryMode'>,
): ExamSessionRuntime {
  return {
    id: payload.id,
    scheduleId: payload.scheduleId,
    examId: payload.examId,
    examTitle: schedule.examTitle,
    cohortName: schedule.cohortName,
    deliveryMode: schedule.deliveryMode,
    status: payload.status,
    actualStartAt: payload.actualStartAt ?? null,
    actualEndAt: payload.actualEndAt ?? null,
    activeSectionKey: payload.activeSectionKey ?? null,
    currentSectionKey: payload.currentSectionKey ?? null,
    currentSectionRemainingSeconds: payload.currentSectionRemainingSeconds,
    waitingForNextSection: payload.waitingForNextSection,
    isOverrun: payload.isOverrun,
    totalPausedSeconds: payload.totalPausedSeconds,
    sections: payload.sections.map((section) => ({
      sectionKey: section.sectionKey,
      label: section.label,
      order: section.sectionOrder,
      plannedDurationMinutes: section.plannedDurationMinutes,
      gapAfterMinutes: section.gapAfterMinutes,
      status: section.status,
      availableAt: section.availableAt ?? null,
      actualStartAt: section.actualStartAt ?? null,
      actualEndAt: section.actualEndAt ?? null,
      pausedAt: section.pausedAt ?? null,
      accumulatedPausedSeconds: section.accumulatedPausedSeconds,
      extensionMinutes: section.extensionMinutes,
      completionReason: section.completionReason ?? undefined,
      projectedStartAt: section.projectedStartAt ?? null,
      projectedEndAt: section.projectedEndAt ?? null,
    })),
    createdAt: payload.createdAt,
    updatedAt: payload.updatedAt,
  };
}

export function mapBackendControlEvent(payload: {
  id: string;
  scheduleId: string;
  runtimeId: string;
  examId: string;
  actorId: string;
  action: CohortControlEvent['action'];
  sectionKey?: ModuleType | null | undefined;
  minutes?: number | null | undefined;
  reason?: string | null | undefined;
  payload?: Record<string, unknown> | null | undefined;
  createdAt: string;
}): CohortControlEvent {
  return {
    id: payload.id,
    scheduleId: payload.scheduleId,
    runtimeId: payload.runtimeId,
    examId: payload.examId,
    actor: payload.actorId,
    action: payload.action,
    sectionKey: payload.sectionKey ?? undefined,
    minutes: payload.minutes ?? undefined,
    reason: payload.reason ?? undefined,
    timestamp: payload.createdAt,
    payload: payload.payload ?? undefined,
  };
}
