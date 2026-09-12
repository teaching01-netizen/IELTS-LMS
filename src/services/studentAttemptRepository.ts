import { backendGet, backendPost, rememberAttemptSchedule } from "./backendBridge";
import { studentSessionTransport } from "./studentSessionTransport";
import {
  buildAttemptAuthorizationHeader as buildAttemptAuthorizationHeaderFromAdapter,
  clearAttemptCredential as clearAttemptCredentialFromAdapter,
  hasAttemptCredential as hasAttemptCredentialFromAdapter,
  refreshAttemptCredentialForAttempt as refreshAttemptCredentialForAttemptFromAdapter,
  storeAttemptCredential as storeAttemptCredentialFromAdapter,
  tryBuildAttemptAuthorizationHeader as tryBuildAttemptAuthorizationHeaderFromAdapter,
} from "./attemptCredentialAdapter";
import type { ApiRequestConfig } from "../app/api/apiClient";
import { ApiError } from "../shared/api-client/errors";
import { ApiClientError } from "../app/api/apiClient";
import type {
  StudentAttempt,
  StudentFinalAnswerPatch,
  StudentAttemptMutation,
  StudentAttemptSeed,
  StudentHeartbeatEvent,
} from "../types/studentAttempt";
import {
  mergeStudentAttemptRecovery,
  normalizeStudentAttempt,
} from "./studentAttemptNormalization";
import type { ModuleType } from "../types";
import type { ExamSchedule } from "../types/domain";
import { createTtlLruCache } from "../utils/ttlLruCache";
import {
  emitStudentObservabilityMetric,
  withStudentObservabilityDimensions,
} from "../utils/studentObservability";

const STORAGE_KEY_ATTEMPTS = "ielts_student_attempts_v1";
const STORAGE_KEY_PENDING_MUTATIONS = "ielts_student_attempt_pending_mutations_v1";
const STORAGE_KEY_HEARTBEAT_EVENTS = "ielts_student_attempt_heartbeat_events_v1";
const STORAGE_KEY_ATTEMPT_RECEIPTS = "ielts_student_attempt_receipts_v1";
const STUDENT_ATTEMPT_IDB_NAME = "ielts_student_attempt_cache_v1";
const STUDENT_ATTEMPT_IDB_VERSION = 1;
const STUDENT_ATTEMPT_IDB_PENDING_STORE = "pending_mutations";
const STORAGE_KEY_CLIENT_SESSION_PREFIX = "ielts-student-client-session:v1:";
const STORAGE_KEY_MUTATION_WATERMARK_PREFIX = "ielts-student-mutation-watermark:v1:";
const MAX_HEARTBEAT_EVENTS_PER_ATTEMPT = 200;
const MAX_HEARTBEAT_FLUSH_EVENTS = 50;
const MAX_PENDING_MUTATIONS_PER_ATTEMPT = 5_000;
const MAX_PENDING_MUTATION_BYTES_PER_ATTEMPT = 2 * 1024 * 1024;

export interface StudentLocalCachePolicy {
  submittedReceiptTtlMs: number;
  staleUnfinishedAttemptTtlMs: number;
  maxPendingMutationsPerAttempt: number;
  maxPendingMutationBytesPerAttempt: number;
}

export const studentLocalCachePolicy: StudentLocalCachePolicy = {
  submittedReceiptTtlMs: 24 * 60 * 60 * 1000,
  staleUnfinishedAttemptTtlMs: 7 * 24 * 60 * 60 * 1000,
  maxPendingMutationsPerAttempt: MAX_PENDING_MUTATIONS_PER_ATTEMPT,
  maxPendingMutationBytesPerAttempt: MAX_PENDING_MUTATION_BYTES_PER_ATTEMPT,
};

export interface StudentAttemptReceipt {
  attemptId: string;
  scheduleId: string;
  submittedAt: string;
  submissionId: string;
  lastServerAcceptedSeq: number;
  compactedAt: string;
}

export interface StudentAttemptCachePruneResult {
  compactedAttempts: number;
  purgedAttempts: number;
  purgedReceipts: number;
}

export interface StudentAttemptLocalCacheStats {
  approximateBytes: number;
  attemptCount: number;
  receiptCount: number;
  pendingMutationCount: number;
  heartbeatEventCount: number;
}

interface PendingAttemptMutationRecord {
  attemptId: string;
  mutations: StudentAttemptMutation[];
}

interface BackendStudentAttempt {
  id: string;
  scheduleId: string;
  studentKey: string;
  examId: string;
  revision?: number | null | undefined;
  publishedVersionId?: string | null | undefined;
  examTitle: string;
  candidateId: string;
  candidateName: string;
  candidateEmail: string;
  phase: StudentAttempt["phase"];
  currentModule: StudentAttempt["currentModule"];
  currentQuestionId?: string | null | undefined;
  answers?: StudentAttempt["answers"] | null | undefined;
  writingAnswers?: StudentAttempt["writingAnswers"] | null | undefined;
  flags?: StudentAttempt["flags"] | null | undefined;
  violationsSnapshot?: StudentAttempt["violations"] | null | undefined;
  finalSubmission?:
    | {
        submissionId?: string | null | undefined;
        submittedAt?: string | null | undefined;
        answers?: StudentAttempt["answers"] | null | undefined;
        writingAnswers?: StudentAttempt["writingAnswers"] | null | undefined;
        flags?: StudentAttempt["flags"] | null | undefined;
      }
    | null
    | undefined;
  submittedAt?: string | null | undefined;
  integrity?: Partial<StudentAttempt["integrity"]> | null | undefined;
  recovery?: Partial<StudentAttempt["recovery"]> | null | undefined;
  protocolVersion?: number | null | undefined;
  deliveryStatus?: StudentAttempt["deliveryStatus"];
  leaseEpoch?: number | null | undefined;
  controlEpoch?: number | null | undefined;
  responseRevision?: number | null | undefined;
  deadlineAt?: string | null | undefined;
  closingGraceUntil?: string | null | undefined;
  finalResponseDigest?: string | null | undefined;
  activeClientSessionId?: string | null | undefined;
  proctorStatus?: StudentAttempt["proctorStatus"] | null | undefined;
  proctorNote?: string | null | undefined;
  proctorUpdatedAt?: string | null | undefined;
  proctorUpdatedBy?: string | null | undefined;
  lastWarningId?: string | null | undefined;
  lastAcknowledgedWarningId?: string | null | undefined;
  createdAt: string;
  updatedAt: string;
}

interface BackendStudentSessionContext {
  attempt?: BackendStudentAttempt | null | undefined;
  attemptCredential?: BackendAttemptCredential | null | undefined;
  runtime?:
    | {
        status: string;
        currentSectionKey?: ModuleType | null | undefined;
      }
    | null
    | undefined;
}

interface BackendHeartbeatResponse {
  attempt?: BackendStudentAttempt | null | undefined;
  runtime?: unknown;
  refreshedAttemptCredential?: BackendAttemptCredential | null | undefined;
}

interface SaveAttemptLifecycleContext {
  flushCycleId?: string;
  sampledSuccessLogs?: boolean;
}

interface BackendAttemptCredential {
  attemptToken: string;
  expiresAt: string;
}

const mutationSequenceWatermarks = createTtlLruCache<string, number>({
  maxEntries: 500,
  ttlMs: 2 * 60 * 60 * 1000,
});
let pendingMutationDbPromise: Promise<IDBDatabase | null> | null = null;

function generateId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function generateClientUuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `00000000-0000-4000-8000-${Math.random().toString(16).slice(2, 14).padEnd(12, "0")}`;
}

function getBrowserStorage(type: "localStorage" | "sessionStorage"): Storage | null {
  try {
    const owner:
      (Pick<Window, "localStorage" | "sessionStorage"> & Partial<typeof globalThis>) | null =
      typeof window !== "undefined"
        ? window
        : typeof globalThis !== "undefined"
          ? globalThis
          : null;
    const storage = owner?.[type];
    return storage ?? null;
  } catch {
    return null;
  }
}

function getIndexedDbFactory(): IDBFactory | null {
  try {
    const owner: (Pick<Window, "indexedDB"> & Partial<typeof globalThis>) | null =
      typeof window !== "undefined"
        ? window
        : typeof globalThis !== "undefined"
          ? globalThis
          : null;
    const indexedDb = owner?.indexedDB;
    return indexedDb ?? null;
  } catch {
    return null;
  }
}

function idbRequestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed."));
  });
}

function waitForIdbTransaction(transaction: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("IndexedDB transaction failed."));
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("IndexedDB transaction aborted."));
  });
}

function isPendingAttemptMutationRecord(
  candidate: unknown
): candidate is PendingAttemptMutationRecord {
  if (!candidate || typeof candidate !== "object") {
    return false;
  }

  const record = candidate as Partial<PendingAttemptMutationRecord>;
  return typeof record.attemptId === "string" && Array.isArray(record.mutations);
}

function arePendingMutationRecordSetsEqual(
  left: PendingAttemptMutationRecord[],
  right: PendingAttemptMutationRecord[]
): boolean {
  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch {
    return false;
  }
}

async function openPendingMutationDatabase(): Promise<IDBDatabase | null> {
  if (pendingMutationDbPromise) {
    return pendingMutationDbPromise;
  }

  const indexedDb = getIndexedDbFactory();
  if (!indexedDb) {
    return null;
  }

  pendingMutationDbPromise = new Promise<IDBDatabase | null>((resolve) => {
    const request = indexedDb.open(STUDENT_ATTEMPT_IDB_NAME, STUDENT_ATTEMPT_IDB_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STUDENT_ATTEMPT_IDB_PENDING_STORE)) {
        database.createObjectStore(STUDENT_ATTEMPT_IDB_PENDING_STORE, { keyPath: "attemptId" });
      }
    };

    request.onsuccess = () => {
      const database = request.result;
      database.onversionchange = () => {
        database.close();
      };
      resolve(database);
    };
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });

  return pendingMutationDbPromise;
}

async function getPendingMutationRecordsFromIndexedDb(): Promise<
  PendingAttemptMutationRecord[] | null
> {
  const database = await openPendingMutationDatabase();
  if (!database) {
    return null;
  }

  try {
    const transaction = database.transaction(STUDENT_ATTEMPT_IDB_PENDING_STORE, "readonly");
    const store = transaction.objectStore(STUDENT_ATTEMPT_IDB_PENDING_STORE);
    const records = await idbRequestToPromise(store.getAll() as IDBRequest<unknown[]>);
    await waitForIdbTransaction(transaction);
    return records.filter(isPendingAttemptMutationRecord);
  } catch {
    return null;
  }
}

async function writePendingMutationRecordsToIndexedDb(
  records: PendingAttemptMutationRecord[]
): Promise<boolean> {
  const database = await openPendingMutationDatabase();
  if (!database) {
    return false;
  }

  try {
    const transaction = database.transaction(STUDENT_ATTEMPT_IDB_PENDING_STORE, "readwrite");
    const store = transaction.objectStore(STUDENT_ATTEMPT_IDB_PENDING_STORE);
    store.clear();
    for (const record of records) {
      store.put(record);
    }
    await waitForIdbTransaction(transaction);
    return true;
  } catch {
    return false;
  }
}

async function putPendingMutationRecordInIndexedDb(
  record: PendingAttemptMutationRecord
): Promise<boolean> {
  const database = await openPendingMutationDatabase();
  if (!database) {
    return false;
  }

  try {
    const transaction = database.transaction(STUDENT_ATTEMPT_IDB_PENDING_STORE, "readwrite");
    transaction.objectStore(STUDENT_ATTEMPT_IDB_PENDING_STORE).put(record);
    await waitForIdbTransaction(transaction);
    return true;
  } catch {
    return false;
  }
}

async function deletePendingMutationRecordInIndexedDb(attemptId: string): Promise<boolean> {
  const database = await openPendingMutationDatabase();
  if (!database) {
    return false;
  }

  try {
    const transaction = database.transaction(STUDENT_ATTEMPT_IDB_PENDING_STORE, "readwrite");
    transaction.objectStore(STUDENT_ATTEMPT_IDB_PENDING_STORE).delete(attemptId);
    await waitForIdbTransaction(transaction);
    return true;
  } catch {
    return false;
  }
}

function getJsonArrayFromStorage<T>(key: string): T[] {
  const local = getBrowserStorage("localStorage");
  const raw = local?.getItem(key);
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function setJsonArrayInStorage<T>(key: string, data: T[]): void {
  const local = getBrowserStorage("localStorage");
  if (!local) {
    return;
  }

  local.setItem(key, JSON.stringify(data));
}

function submittedAtForAttempt(attempt: StudentAttempt): string | null {
  return attempt.submittedAt ?? attempt.finalSubmission?.submittedAt ?? null;
}

function submissionIdForAttempt(attempt: StudentAttempt): string | null {
  return attempt.finalSubmission?.submissionId ?? null;
}

export function compactSubmittedAttempt(
  attempt: StudentAttempt,
  compactedAt: Date = new Date()
): StudentAttemptReceipt {
  const submittedAt = submittedAtForAttempt(attempt);
  const submissionId = submissionIdForAttempt(attempt);
  if (!submittedAt || !submissionId) {
    throw new Error("Cannot compact an attempt without submission receipt metadata.");
  }

  return {
    attemptId: attempt.id,
    scheduleId: attempt.scheduleId,
    submittedAt,
    submissionId,
    lastServerAcceptedSeq: attempt.recovery.serverAcceptedThroughSeq ?? 0,
    compactedAt: compactedAt.toISOString(),
  };
}

function isSubmittedSyncedAttempt(
  attempt: StudentAttempt,
  pendingMutations: StudentAttemptMutation[],
  heartbeatEvents: StudentHeartbeatEvent[]
): boolean {
  return (
    attempt.phase === "post-exam" &&
    Boolean(submittedAtForAttempt(attempt)) &&
    Boolean(submissionIdForAttempt(attempt)) &&
    pendingMutations.length === 0 &&
    heartbeatEvents.length === 0 &&
    attempt.recovery.pendingMutationCount === 0 &&
    attempt.recovery.syncState === "saved"
  );
}

function hasUnsyncedLocalState(
  attempt: StudentAttempt,
  pendingMutations: StudentAttemptMutation[],
  heartbeatEvents: StudentHeartbeatEvent[]
): boolean {
  return (
    pendingMutations.length > 0 ||
    heartbeatEvents.length > 0 ||
    attempt.recovery.pendingMutationCount > 0 ||
    attempt.recovery.syncState === "saving" ||
    attempt.recovery.syncState === "offline" ||
    attempt.recovery.syncState === "syncing_reconnect" ||
    attempt.recovery.syncState === "error"
  );
}

function staleCutoffForAttempt(
  attempt: StudentAttempt,
  schedule: Pick<ExamSchedule, "endTime"> | null | undefined
): number {
  const scheduleEnd = schedule?.endTime ? Date.parse(schedule.endTime) : NaN;
  const updatedAt = Date.parse(attempt.updatedAt);
  if (Number.isFinite(scheduleEnd)) {
    return scheduleEnd;
  }
  return Number.isFinite(updatedAt) ? updatedAt : 0;
}

export async function pruneStudentAttemptCache(
  now: Date = new Date(),
  scheduleLookup: (scheduleId: string) => Pick<ExamSchedule, "endTime"> | null | undefined = () =>
    null
): Promise<StudentAttemptCachePruneResult> {
  const attempts =
    getJsonArrayFromStorage<StudentAttempt>(STORAGE_KEY_ATTEMPTS).map(normalizeStudentAttempt);
  const pending = getJsonArrayFromStorage<PendingAttemptMutationRecord>(
    STORAGE_KEY_PENDING_MUTATIONS
  );
  const heartbeats = getJsonArrayFromStorage<StudentHeartbeatEvent>(STORAGE_KEY_HEARTBEAT_EVENTS);
  const receipts = getJsonArrayFromStorage<StudentAttemptReceipt>(STORAGE_KEY_ATTEMPT_RECEIPTS);
  const pendingByAttempt = new Map(pending.map((entry) => [entry.attemptId, entry.mutations]));
  const heartbeatsByAttempt = new Map<string, StudentHeartbeatEvent[]>();

  for (const event of heartbeats) {
    const existing = heartbeatsByAttempt.get(event.attemptId) ?? [];
    existing.push(event);
    heartbeatsByAttempt.set(event.attemptId, existing);
  }

  const nextAttempts: StudentAttempt[] = [];
  const nextReceipts = [...receipts];
  let compactedAttempts = 0;
  let purgedAttempts = 0;
  const nowMs = now.getTime();

  for (const attempt of attempts) {
    const attemptPending = pendingByAttempt.get(attempt.id) ?? [];
    const attemptHeartbeats = heartbeatsByAttempt.get(attempt.id) ?? [];

    if (isSubmittedSyncedAttempt(attempt, attemptPending, attemptHeartbeats)) {
      const receipt = compactSubmittedAttempt(attempt, now);
      const existingIndex = nextReceipts.findIndex(
        (candidate) => candidate.attemptId === receipt.attemptId
      );
      if (existingIndex >= 0) {
        nextReceipts[existingIndex] = receipt;
      } else {
        nextReceipts.push(receipt);
      }
      compactedAttempts += 1;
      continue;
    }

    const schedule = scheduleLookup(attempt.scheduleId);
    const staleFrom = staleCutoffForAttempt(attempt, schedule);
    const isStale =
      staleFrom > 0 && nowMs - staleFrom > studentLocalCachePolicy.staleUnfinishedAttemptTtlMs;
    if (isStale && !hasUnsyncedLocalState(attempt, attemptPending, attemptHeartbeats)) {
      purgedAttempts += 1;
      continue;
    }

    nextAttempts.push(attempt);
  }

  const freshReceipts = nextReceipts.filter((receipt) => {
    const compactedAt = Date.parse(receipt.compactedAt);
    return (
      Number.isFinite(compactedAt) &&
      nowMs - compactedAt <= studentLocalCachePolicy.submittedReceiptTtlMs
    );
  });
  const purgedReceipts = nextReceipts.length - freshReceipts.length;

  setJsonArrayInStorage(STORAGE_KEY_ATTEMPTS, nextAttempts);
  setJsonArrayInStorage(STORAGE_KEY_ATTEMPT_RECEIPTS, freshReceipts);

  return {
    compactedAttempts,
    purgedAttempts,
    purgedReceipts,
  };
}

export function getStudentAttemptLocalCacheStats(): StudentAttemptLocalCacheStats {
  const local = getBrowserStorage("localStorage");
  const readRaw = (key: string) => local?.getItem(key) ?? "[]";
  const attemptsRaw = readRaw(STORAGE_KEY_ATTEMPTS);
  const receiptsRaw = readRaw(STORAGE_KEY_ATTEMPT_RECEIPTS);
  const pendingRaw = readRaw(STORAGE_KEY_PENDING_MUTATIONS);
  const heartbeatsRaw = readRaw(STORAGE_KEY_HEARTBEAT_EVENTS);
  const attempts = getJsonArrayFromStorage<StudentAttempt>(STORAGE_KEY_ATTEMPTS);
  const receipts = getJsonArrayFromStorage<StudentAttemptReceipt>(STORAGE_KEY_ATTEMPT_RECEIPTS);
  const pending = getJsonArrayFromStorage<PendingAttemptMutationRecord>(
    STORAGE_KEY_PENDING_MUTATIONS
  );
  const heartbeats = getJsonArrayFromStorage<StudentHeartbeatEvent>(STORAGE_KEY_HEARTBEAT_EVENTS);

  return {
    approximateBytes:
      attemptsRaw.length + receiptsRaw.length + pendingRaw.length + heartbeatsRaw.length,
    attemptCount: attempts.length,
    receiptCount: receipts.length,
    pendingMutationCount: pending.reduce((total, entry) => total + entry.mutations.length, 0),
    heartbeatEventCount: heartbeats.length,
  };
}

export async function resetStudentAttemptPendingMutationIndexedDbForTests(): Promise<void> {
  const indexedDb = getIndexedDbFactory();
  if (!indexedDb) {
    pendingMutationDbPromise = null;
    return;
  }

  const openDatabase = await pendingMutationDbPromise;
  openDatabase?.close();
  pendingMutationDbPromise = null;

  await new Promise<void>((resolve) => {
    const request = indexedDb.deleteDatabase(STUDENT_ATTEMPT_IDB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
}

export function tryBuildAttemptAuthorizationHeader(
  scheduleId: string,
  attemptId: string
): Record<string, string> | null {
  return tryBuildAttemptAuthorizationHeaderFromAdapter(scheduleId, attemptId);
}

function isUnauthorizedError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "statusCode" in error &&
    (error as { statusCode?: unknown }).statusCode === 401
  );
}

function isMissingAttemptCredentialError(error: unknown): boolean {
  return (
    error instanceof Error && error.message.toLowerCase().includes("missing attempt credential")
  );
}

function mutationSupersessionKey(mutation: StudentAttemptMutation): string | null {
  if (mutation.type === "answer" || mutation.type === "flag") {
    const questionId = mutation.payload.questionId;
    if (typeof questionId !== "string") {
      return null;
    }

    if (mutation.type === "answer") {
      const slotIndex = mutation.payload.slotIndex;
      if (typeof slotIndex === "number" && Number.isInteger(slotIndex) && slotIndex >= 0) {
        return `answer:${questionId}:slot:${slotIndex}`;
      }
    }

    return `${mutation.type}:${questionId}`;
  }

  if (mutation.type === "writing_answer") {
    const taskId = mutation.payload.taskId;
    return typeof taskId === "string" ? `${mutation.type}:${taskId}` : null;
  }

  if (mutation.type === "position") {
    return `position:${mutation.payload.currentModule ?? "current"}`;
  }

  return null;
}

function approximateMutationBytes(mutations: StudentAttemptMutation[]): number {
  try {
    return JSON.stringify(mutations).length;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function compactSupersededMutations(mutations: StudentAttemptMutation[]): StudentAttemptMutation[] {
  const latestByKey = new Map<string, number>();
  mutations.forEach((mutation, index) => {
    const key = mutationSupersessionKey(mutation);
    if (key) {
      latestByKey.set(key, index);
    }
  });

  return mutations.filter((mutation, index) => {
    const key = mutationSupersessionKey(mutation);
    return !key || latestByKey.get(key) === index;
  });
}

function enforcePendingMutationPolicy(
  mutations: StudentAttemptMutation[]
): StudentAttemptMutation[] {
  if (
    mutations.length <= studentLocalCachePolicy.maxPendingMutationsPerAttempt &&
    approximateMutationBytes(mutations) <= studentLocalCachePolicy.maxPendingMutationBytesPerAttempt
  ) {
    return mutations;
  }

  let next = compactSupersededMutations(mutations);
  if (
    next.length <= studentLocalCachePolicy.maxPendingMutationsPerAttempt &&
    approximateMutationBytes(next) <= studentLocalCachePolicy.maxPendingMutationBytesPerAttempt
  ) {
    return next;
  }

  const protectedMutations = next.filter((mutation) => mutationSupersessionKey(mutation) === null);
  const compactableMutations = next.filter(
    (mutation) => mutationSupersessionKey(mutation) !== null
  );
  const remainingSlots = Math.max(
    0,
    studentLocalCachePolicy.maxPendingMutationsPerAttempt - protectedMutations.length
  );
  next = [...protectedMutations, ...compactableMutations.slice(-remainingSlots)].sort(
    (left, right) => new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime()
  );

  while (
    next.length > protectedMutations.length &&
    approximateMutationBytes(next) > studentLocalCachePolicy.maxPendingMutationBytesPerAttempt
  ) {
    const firstCompactableIndex = next.findIndex(
      (mutation) => mutationSupersessionKey(mutation) !== null
    );
    if (firstCompactableIndex < 0) {
      break;
    }
    next.splice(firstCompactableIndex, 1);
  }

  return next;
}

function isModuleType(value: unknown): value is ModuleType {
  return (
    value === "listening" || value === "reading" || value === "writing" || value === "speaking"
  );
}

function isAttemptPhase(value: unknown): value is StudentAttempt["phase"] {
  return (
    value === "pre-check" ||
    value === "lobby" ||
    value === "exam" ||
    value === "post-exam" ||
    value === "submitted"
  );
}

export function replayPendingMutationsOntoAttempt(
  attempt: StudentAttempt,
  mutations: StudentAttemptMutation[]
): StudentAttempt {
  if (mutations.length === 0) {
    return attempt;
  }

  let nextAttempt = attempt;

  for (const mutation of mutations) {
    switch (mutation.type) {
      case "answer": {
        const questionId = mutation.payload.questionId;
        const value = mutation.payload.value;
        const validValue =
          typeof value === "string" ||
          value === null ||
          (Array.isArray(value) && value.every((entry) => typeof entry === "string"));
        if (typeof questionId !== "string" || !questionId.trim() || !validValue) {
          break;
        }

        nextAttempt = {
          ...nextAttempt,
          answers: {
            ...nextAttempt.answers,
            [questionId]: value,
          },
        };
        break;
      }
      case "writing_answer": {
        const taskId = mutation.payload.taskId;
        const value = mutation.payload.value;
        if (typeof taskId !== "string" || typeof value !== "string") {
          break;
        }

        nextAttempt = {
          ...nextAttempt,
          writingAnswers: {
            ...nextAttempt.writingAnswers,
            [taskId]: value,
          },
        };
        break;
      }
      case "flag": {
        const questionId = mutation.payload.questionId;
        const value = mutation.payload.value;
        if (typeof questionId !== "string" || typeof value !== "boolean") {
          break;
        }

        nextAttempt = {
          ...nextAttempt,
          flags: {
            ...nextAttempt.flags,
            [questionId]: value,
          },
        };
        break;
      }
      case "position": {
        const currentModule = mutation.payload.currentModule;
        const currentQuestionId = mutation.payload.currentQuestionId;
        const phase = mutation.payload.phase;

        nextAttempt = {
          ...nextAttempt,
          ...(isModuleType(currentModule) ? { currentModule } : {}),
          ...(typeof currentQuestionId === "string" || currentQuestionId === null
            ? { currentQuestionId }
            : {}),
          ...(isAttemptPhase(phase) ? { phase } : {}),
        };
        break;
      }
      default:
        break;
    }
  }

  return {
    ...nextAttempt,
    recovery: {
      ...nextAttempt.recovery,
      pendingMutationCount: mutations.length,
    },
  };
}

function attemptAcceptedSeq(attempt: StudentAttempt): number {
  return attempt.recovery.serverAcceptedThroughSeq ?? 0;
}

function shouldPreferLocalAcceptedState(
  localAttempt: StudentAttempt | null,
  incomingAttempt: StudentAttempt
): localAttempt is StudentAttempt {
  if (!localAttempt || localAttempt.id !== incomingAttempt.id || incomingAttempt.submittedAt) {
    return false;
  }

  if (attemptAcceptedSeq(localAttempt) > attemptAcceptedSeq(incomingAttempt)) {
    return true;
  }
  if (attemptAcceptedSeq(localAttempt) < attemptAcceptedSeq(incomingAttempt)) {
    return false;
  }

  return false;
}

function preserveNewerAcceptedLocalState(
  incomingAttempt: StudentAttempt,
  localAttempt: StudentAttempt | null
): StudentAttempt {
  if (!shouldPreferLocalAcceptedState(localAttempt, incomingAttempt)) {
    return incomingAttempt;
  }

  return {
    ...incomingAttempt,
    phase: localAttempt.phase,
    currentModule: localAttempt.currentModule,
    currentQuestionId: localAttempt.currentQuestionId,
    answers: localAttempt.answers,
    writingAnswers: localAttempt.writingAnswers,
    flags: localAttempt.flags,
    recovery: {
      ...incomingAttempt.recovery,
      lastLocalMutationAt:
        localAttempt.recovery.lastLocalMutationAt ?? incomingAttempt.recovery.lastLocalMutationAt,
      lastPersistedAt:
        localAttempt.recovery.lastPersistedAt ?? incomingAttempt.recovery.lastPersistedAt,
      lastDroppedMutations:
        localAttempt.recovery.lastDroppedMutations ?? incomingAttempt.recovery.lastDroppedMutations,
      pendingMutationCount: Math.max(
        localAttempt.recovery.pendingMutationCount,
        incomingAttempt.recovery.pendingMutationCount
      ),
      serverAcceptedThroughSeq: attemptAcceptedSeq(localAttempt),
      clientSessionId:
        localAttempt.recovery.clientSessionId ?? incomingAttempt.recovery.clientSessionId,
      syncState: localAttempt.recovery.syncState,
      finalSubmissionPending:
        localAttempt.recovery.finalSubmissionPending ||
        incomingAttempt.recovery.finalSubmissionPending,
    },
  };
}

export function backendConflictReason(error: unknown): string | null {
  if (error instanceof ApiError || error instanceof ApiClientError) {
    const reason = error.details?.["reason"];
    return typeof reason === "string" && reason.trim() ? reason : null;
  }

  if (typeof error === "object" && error !== null && "backendDetails" in error) {
    const details = (error as { backendDetails?: unknown }).backendDetails;
    if (
      details &&
      typeof details === "object" &&
      "reason" in (details as Record<string, unknown>)
    ) {
      const reason = (details as Record<string, unknown>)["reason"];
      return typeof reason === "string" && reason.trim() ? reason : null;
    }
  }

  return null;
}

function getClientSessionStorageKey(scheduleId: string, studentKey: string): string {
  return `${STORAGE_KEY_CLIENT_SESSION_PREFIX}${scheduleId}:${studentKey}`;
}

function getMutationWatermarkStorageKey(attemptId: string, clientSessionId: string): string {
  return `${STORAGE_KEY_MUTATION_WATERMARK_PREFIX}${attemptId}:${clientSessionId}`;
}

function readStoredMutationSequenceWatermark(
  attemptId: string,
  clientSessionId: string
): number | null {
  const session = getBrowserStorage("sessionStorage");
  if (!session) {
    return null;
  }

  const raw = session.getItem(getMutationWatermarkStorageKey(attemptId, clientSessionId));
  if (raw == null) {
    return null;
  }

  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function storeMutationSequenceWatermark(
  attemptId: string,
  clientSessionId: string,
  watermark: number
): void {
  mutationSequenceWatermarks.set(mutationWatermarkKey(attemptId, clientSessionId), watermark);

  const session = getBrowserStorage("sessionStorage");
  if (!session) {
    return;
  }

  try {
    session.setItem(getMutationWatermarkStorageKey(attemptId, clientSessionId), String(watermark));
  } catch {
    // ignore
  }
}

function readOrPrimeMutationSequenceWatermark(attemptId: string, clientSessionId: string): number {
  const key = mutationWatermarkKey(attemptId, clientSessionId);
  const cached = mutationSequenceWatermarks.get(key);
  if (cached !== undefined) {
    return cached;
  }

  const stored = readStoredMutationSequenceWatermark(attemptId, clientSessionId);
  if (stored !== null) {
    mutationSequenceWatermarks.set(key, stored);
    return stored;
  }

  return 0;
}

function ensureClientSessionId(
  scheduleId: string,
  studentKey: string,
  preferredClientSessionId: string | null = null,
  forceNew = false,
): string {
  const session = getBrowserStorage("sessionStorage");
  const local = getBrowserStorage("localStorage");

  const storageKey = getClientSessionStorageKey(scheduleId, studentKey);
  const stored = session?.getItem(storageKey) ?? local?.getItem(storageKey) ?? null;
  if (stored && !forceNew) {
    try {
      session?.setItem(storageKey, stored);
    } catch {
      // ignore
    }
    try {
      local?.setItem(storageKey, stored);
    } catch {
      // ignore
    }
    return stored;
  }

  const generated =
    typeof preferredClientSessionId === "string" && preferredClientSessionId.trim().length > 0
      ? preferredClientSessionId
      : generateClientUuid();
  try {
    session?.setItem(storageKey, generated);
  } catch {
    // ignore
  }
  try {
    local?.setItem(storageKey, generated);
  } catch {
    // ignore
  }
  return generated;
}

export function ensureClientSessionIdForAttempt(attempt: StudentAttempt): string {
  const preferredClientSessionId =
    attempt.recovery.clientSessionId ?? attempt.integrity.clientSessionId ?? null;
  return ensureClientSessionId(attempt.scheduleId, attempt.studentKey, preferredClientSessionId);
}

/**
 * Shared writer-identity owner for schedule-scoped callers (e.g. SAT delivery)
 * that know (scheduleId, studentKey) but do not hold a full StudentAttempt.
 * Thin wrapper over the same storage key + preferred-id seeding as
 * ensureClientSessionIdForAttempt, so both paths resolve one identity.
 *
 * Exam-day re-audit defect 3: every writer path (heartbeat, credential
 * refresh, V2 saves, takeover) must derive the SAME studentKey for one
 * attempt, or the bearer-bound session check fences the odd one out.
 * The canonical SAT derivation is `student-${scheduleId}-${candidateId}`
 * where candidateId is the attempt's candidate identifier (NOT the attempt
 * id). Callers that only know the attempt id must resolve the StudentAttempt
 * first — never invent a key.
 */
export function ensureClientSessionIdForStudentKey(
  scheduleId: string,
  studentKey: string,
  preferredClientSessionId: string | null = null,
): string {
  return ensureClientSessionId(scheduleId, studentKey, preferredClientSessionId);
}

/** Canonical SAT writer-key derivation (single owner — defect 3). */
export function satWriterStudentKey(scheduleId: string, candidateId: string): string {
  return `student-${scheduleId}-${candidateId}`;
}

/** Persist a newly generated browser session identity after an explicit lease takeover. */
export function rotateClientSessionIdForAttempt(attempt: StudentAttempt): string {
  return ensureClientSessionId(attempt.scheduleId, attempt.studentKey, null, true);
}

export function restoreClientSessionIdForAttempt(
  attempt: StudentAttempt,
  clientSessionId: string,
): string {
  return ensureClientSessionId(attempt.scheduleId, attempt.studentKey, clientSessionId, true);
}

export async function refreshAttemptCredentialForAttempt(
  attempt: StudentAttempt
): Promise<boolean> {
  const clientSessionId = ensureClientSessionIdForAttempt(attempt);
  return refreshAttemptCredentialForAttemptFromAdapter(attempt, clientSessionId);
}

function mutationWatermarkKey(attemptId: string, clientSessionId: string): string {
  return `${attemptId}:${clientSessionId}`;
}

export function mapBackendStudentAttempt(
  payload: BackendStudentAttempt,
  receipt?: { submissionId: string; submittedAt: string } | null | undefined
): StudentAttempt {
  rememberAttemptSchedule(payload.id, payload.scheduleId);

  // Backend may omit `answers`/`writingAnswers`/`flags` after submission and only return them
  // nested under `finalSubmission`. The UI still needs these values for completion summary.
  const answers = payload.answers ?? payload.finalSubmission?.answers ?? {};
  const writingAnswers = payload.writingAnswers ?? payload.finalSubmission?.writingAnswers ?? {};
  const flags = payload.flags ?? payload.finalSubmission?.flags ?? {};

  const finalSubmission =
    payload.finalSubmission?.submissionId && payload.finalSubmission.submittedAt
      ? {
          submissionId: payload.finalSubmission.submissionId,
          submittedAt: payload.finalSubmission.submittedAt,
          ...(payload.finalSubmission.answers ? { answers: payload.finalSubmission.answers } : {}),
          ...(payload.finalSubmission.writingAnswers
            ? { writingAnswers: payload.finalSubmission.writingAnswers }
            : {}),
          ...(payload.finalSubmission.flags ? { flags: payload.finalSubmission.flags } : {}),
        }
      : receipt
        ? {
            submissionId: receipt.submissionId,
            submittedAt: receipt.submittedAt,
          }
        : null;

  return normalizeStudentAttempt({
    id: payload.id,
    scheduleId: payload.scheduleId,
    studentKey: payload.studentKey,
    examId: payload.examId,
    revision: payload.revision ?? 0,
    publishedVersionId: payload.publishedVersionId ?? null,
    examTitle: payload.examTitle,
    candidateId: payload.candidateId,
    candidateName: payload.candidateName,
    candidateEmail: payload.candidateEmail,
    phase: payload.phase,
    currentModule: payload.currentModule,
    currentQuestionId: payload.currentQuestionId ?? null,
    answers,
    writingAnswers,
    flags,
    violations: payload.violationsSnapshot ?? [],
    submittedAt:
      payload.submittedAt ?? payload.finalSubmission?.submittedAt ?? receipt?.submittedAt ?? null,
    ...(finalSubmission ? { finalSubmission } : {}),
    proctorStatus: payload.proctorStatus ?? "active",
    proctorNote: payload.proctorNote ?? null,
    proctorUpdatedAt: payload.proctorUpdatedAt ?? null,
    proctorUpdatedBy: payload.proctorUpdatedBy ?? null,
    lastWarningId: payload.lastWarningId ?? null,
    lastAcknowledgedWarningId: payload.lastAcknowledgedWarningId ?? null,
    integrity: {
      preCheck: payload.integrity?.preCheck ?? null,
      deviceFingerprintHash: payload.integrity?.deviceFingerprintHash ?? null,
      clientSessionId:
        payload.integrity?.clientSessionId ?? payload.recovery?.clientSessionId ?? null,
      lastDisconnectAt: payload.integrity?.lastDisconnectAt ?? null,
      lastReconnectAt: payload.integrity?.lastReconnectAt ?? null,
      lastHeartbeatAt: payload.integrity?.lastHeartbeatAt ?? null,
      lastHeartbeatStatus: payload.integrity?.lastHeartbeatStatus ?? "idle",
    },
    recovery: {
      finalSubmissionPending: payload.recovery?.finalSubmissionPending ?? false,
      lastRecoveredAt: payload.recovery?.lastRecoveredAt ?? null,
      lastLocalMutationAt: payload.recovery?.lastLocalMutationAt ?? null,
      lastPersistedAt: payload.recovery?.lastPersistedAt ?? null,
      lastDroppedMutations: null,
      pendingMutationCount: payload.recovery?.pendingMutationCount ?? 0,
      serverAcceptedThroughSeq: payload.recovery?.serverAcceptedThroughSeq ?? 0,
      clientSessionId:
        payload.recovery?.clientSessionId ?? payload.integrity?.clientSessionId ?? null,
      syncState: payload.recovery?.syncState ?? "idle",
    },
    createdAt: payload.createdAt,
    updatedAt: payload.updatedAt,
    ...(payload.protocolVersion != null ? { protocolVersion: payload.protocolVersion } : {}),
    ...(payload.deliveryStatus != null ? { deliveryStatus: payload.deliveryStatus } : {}),
    ...(payload.leaseEpoch != null ? { leaseEpoch: payload.leaseEpoch } : {}),
    ...(payload.controlEpoch != null ? { controlEpoch: payload.controlEpoch } : {}),
    ...(payload.responseRevision != null ? { responseRevision: payload.responseRevision } : {}),
    ...(payload.deadlineAt !== undefined ? { deadlineAt: payload.deadlineAt } : {}),
    ...(payload.closingGraceUntil !== undefined
      ? { closingGraceUntil: payload.closingGraceUntil }
      : {}),
    ...(payload.finalResponseDigest !== undefined
      ? { finalResponseDigest: payload.finalResponseDigest }
      : {}),
    ...(payload.activeClientSessionId !== undefined
      ? { activeClientSessionId: payload.activeClientSessionId }
      : {}),
  });
}

function primeMutationSequenceWatermark(attempt: StudentAttempt): void {
  const backendSeq = attempt.recovery.serverAcceptedThroughSeq ?? 0;
  const clientSessionId = ensureClientSessionIdForAttempt(attempt);
  if (!clientSessionId) {
    return;
  }

  const current = readOrPrimeMutationSequenceWatermark(attempt.id, clientSessionId);
  if (backendSeq > current) {
    storeMutationSequenceWatermark(attempt.id, clientSessionId, backendSeq);
  }
}

export function clearAttemptMutationWatermark(attempt: StudentAttempt): void {
  const clientSessionId = attempt.recovery.clientSessionId ?? attempt.integrity.clientSessionId;
  if (!clientSessionId) {
    return;
  }

  mutationSequenceWatermarks.delete(mutationWatermarkKey(attempt.id, clientSessionId));
  try {
    getBrowserStorage("sessionStorage")?.removeItem(
      getMutationWatermarkStorageKey(attempt.id, clientSessionId)
    );
  } catch {
    // ignore
  }
}

export function hasAttemptCredential(scheduleId: string, attemptId: string): boolean {
  return hasAttemptCredentialFromAdapter(scheduleId, attemptId);
}

export interface IStudentAttemptRepository {
  getAttemptByScheduleId(scheduleId: string, studentKey: string): Promise<StudentAttempt | null>;
  getCanonicalAttemptByScheduleId(
    scheduleId: string,
    studentKey: string
  ): Promise<StudentAttempt | null>;
  getAllAttempts(): Promise<StudentAttempt[]>;
  getAttemptsByScheduleId(scheduleId: string): Promise<StudentAttempt[]>;
  saveAttempt(attempt: StudentAttempt, context?: SaveAttemptLifecycleContext): Promise<void>;
  createAttempt(seed: StudentAttemptSeed): Promise<StudentAttempt>;
  savePendingMutations(attemptId: string, mutations: StudentAttemptMutation[]): Promise<void>;
  getPendingMutations(attemptId: string): Promise<StudentAttemptMutation[]>;
  clearPendingMutations(attemptId: string): Promise<void>;
  saveHeartbeatEvent(event: StudentHeartbeatEvent): Promise<void>;
  getHeartbeatEvents(attemptId: string): Promise<StudentHeartbeatEvent[]>;
  deleteHeartbeatEvent(attemptId: string, eventId: string): Promise<void>;
  flushHeartbeatEvents(attemptId: string): Promise<boolean>;
}

class LocalStorageStudentAttemptCache implements IStudentAttemptRepository {
  private readonly pendingMutationFallbackMemory = new Map<string, StudentAttemptMutation[]>();

  private getItem<T>(key: string): T[] {
    try {
      const item = localStorage.getItem(key);
      if (!item) {
        return [];
      }
      const parsed = JSON.parse(item) as unknown;
      return Array.isArray(parsed) ? (parsed as T[]) : [];
    } catch {
      return [];
    }
  }

  private setItem<T>(key: string, data: T[]): void {
    localStorage.setItem(key, JSON.stringify(data));
  }

  async getAttemptByScheduleId(
    scheduleId: string,
    studentKey: string
  ): Promise<StudentAttempt | null> {
    const attempts =
      this.getItem<StudentAttempt>(STORAGE_KEY_ATTEMPTS).map(normalizeStudentAttempt);
    const exactMatch =
      attempts.find(
        (attempt) => attempt.scheduleId === scheduleId && attempt.studentKey === studentKey
      ) ?? null;

    if (exactMatch) {
      return exactMatch;
    }

    const prefix = `student-${scheduleId}-`;
    const candidateId = studentKey.startsWith(prefix)
      ? studentKey.slice(prefix.length)
      : studentKey.split("-").pop() || studentKey;

    return (
      attempts.find(
        (attempt) => attempt.scheduleId === scheduleId && attempt.candidateId === candidateId
      ) ?? null
    );
  }

  async getCanonicalAttemptByScheduleId(
    scheduleId: string,
    studentKey: string
  ): Promise<StudentAttempt | null> {
    return this.getAttemptByScheduleId(scheduleId, studentKey);
  }

  async getAllAttempts(): Promise<StudentAttempt[]> {
    return this.getItem<StudentAttempt>(STORAGE_KEY_ATTEMPTS).map(normalizeStudentAttempt);
  }

  async getAttemptsByScheduleId(scheduleId: string): Promise<StudentAttempt[]> {
    const attempts =
      this.getItem<StudentAttempt>(STORAGE_KEY_ATTEMPTS).map(normalizeStudentAttempt);
    return attempts.filter((attempt) => attempt.scheduleId === scheduleId);
  }

  async saveAttempt(attempt: StudentAttempt): Promise<void> {
    const attempts =
      this.getItem<StudentAttempt>(STORAGE_KEY_ATTEMPTS).map(normalizeStudentAttempt);
    const normalizedAttempt = normalizeStudentAttempt({
      ...attempt,
      updatedAt: new Date().toISOString(),
    });
    const index = attempts.findIndex((candidate) => candidate.id === normalizedAttempt.id);

    if (index >= 0) {
      attempts[index] = normalizedAttempt;
    } else {
      attempts.push(normalizedAttempt);
    }

    this.setItem(STORAGE_KEY_ATTEMPTS, attempts);
  }

  async createAttempt(seed: StudentAttemptSeed): Promise<StudentAttempt> {
    const now = new Date().toISOString();
    const attempt: StudentAttempt = {
      id: generateId("attempt"),
      scheduleId: seed.scheduleId,
      studentKey: seed.studentKey,
      examId: seed.examId,
      revision: 0,
      examTitle: seed.examTitle,
      candidateId: seed.candidateId,
      candidateName: seed.candidateName,
      candidateEmail: seed.candidateEmail,
      phase: seed.phase ?? "pre-check",
      currentModule: seed.currentModule ?? "listening",
      currentQuestionId: seed.currentQuestionId ?? null,
      answers: {},
      writingAnswers: {},
      flags: {},
      violations: [],
      proctorStatus: "active",
      proctorNote: null,
      proctorUpdatedAt: null,
      proctorUpdatedBy: null,
      lastWarningId: null,
      lastAcknowledgedWarningId: null,
      integrity: {
        preCheck: null,
        deviceFingerprintHash: null,
        clientSessionId: null,
        lastDisconnectAt: null,
        lastReconnectAt: null,
        lastHeartbeatAt: null,
        lastHeartbeatStatus: "idle",
      },
      recovery: {
        finalSubmissionPending: false,
        lastRecoveredAt: null,
        lastLocalMutationAt: null,
        lastPersistedAt: null,
        lastDroppedMutations: null,
        pendingMutationCount: 0,
        serverAcceptedThroughSeq: 0,
        clientSessionId: null,
        syncState: "idle",
      },
      createdAt: now,
      updatedAt: now,
    };

    await this.saveAttempt(attempt);
    return attempt;
  }

  async savePendingMutations(
    attemptId: string,
    mutations: StudentAttemptMutation[]
  ): Promise<void> {
    const pending = this.getItem<PendingAttemptMutationRecord>(STORAGE_KEY_PENDING_MUTATIONS);
    const index = pending.findIndex((entry) => entry.attemptId === attemptId);
    const nextEntry: PendingAttemptMutationRecord = {
      attemptId,
      mutations: enforcePendingMutationPolicy(mutations),
    };

    if (index >= 0) {
      pending[index] = nextEntry;
    } else {
      pending.push(nextEntry);
    }

    let localWriteError: unknown = null;
    try {
      this.setItem(STORAGE_KEY_PENDING_MUTATIONS, pending);
    } catch (error) {
      localWriteError = error;
    }

    const indexedDbPersisted = await putPendingMutationRecordInIndexedDb(nextEntry);
    if (localWriteError && !indexedDbPersisted) {
      throw new Error(
        "Unable to durably store pending student mutations in IndexedDB or localStorage.",
        { cause: localWriteError }
      );
    }

    this.pendingMutationFallbackMemory.delete(attemptId);
  }

  async getPendingMutations(attemptId: string): Promise<StudentAttemptMutation[]> {
    const localPending = this.getItem<PendingAttemptMutationRecord>(STORAGE_KEY_PENDING_MUTATIONS);
    const indexedDbPending = await getPendingMutationRecordsFromIndexedDb();
    const fallbackPending = this.pendingMutationFallbackMemory.get(attemptId) ?? [];

    if (indexedDbPending !== null) {
      if (indexedDbPending.length === 0 && localPending.length > 0) {
        const migrated = await writePendingMutationRecordsToIndexedDb(localPending);
        if (migrated) {
          return localPending.find((entry) => entry.attemptId === attemptId)?.mutations ?? [];
        }
      } else {
        if (!arePendingMutationRecordSetsEqual(localPending, indexedDbPending)) {
          try {
            this.setItem(STORAGE_KEY_PENDING_MUTATIONS, indexedDbPending);
          } catch {
            // If localStorage is unavailable/quota-limited, keep IndexedDB as source of truth.
          }
        }
        const indexedResult =
          indexedDbPending.find((entry) => entry.attemptId === attemptId)?.mutations ?? [];
        if (indexedResult.length > 0) {
          this.pendingMutationFallbackMemory.delete(attemptId);
          return indexedResult;
        }
        if (fallbackPending.length > 0) {
          return fallbackPending;
        }
        return indexedResult;
      }
    }

    const localResult =
      localPending.find((entry) => entry.attemptId === attemptId)?.mutations ?? [];
    if (localResult.length > 0) {
      this.pendingMutationFallbackMemory.delete(attemptId);
      return localResult;
    }
    if (fallbackPending.length > 0) {
      return fallbackPending;
    }
    return localResult;
  }

  async clearPendingMutations(attemptId: string): Promise<void> {
    const pending = this.getItem<PendingAttemptMutationRecord>(STORAGE_KEY_PENDING_MUTATIONS);
    let localWriteError: unknown = null;
    try {
      this.setItem(
        STORAGE_KEY_PENDING_MUTATIONS,
        pending.filter((entry) => entry.attemptId !== attemptId)
      );
    } catch (error) {
      localWriteError = error;
    }

    const indexedDbCleared = await deletePendingMutationRecordInIndexedDb(attemptId);
    this.pendingMutationFallbackMemory.delete(attemptId);
    if (localWriteError && !indexedDbCleared) {
      throw new Error(
        "Unable to durably clear acknowledged student mutations; replay will be retried safely.",
        { cause: localWriteError }
      );
    }
  }

  async saveHeartbeatEvent(event: StudentHeartbeatEvent): Promise<void> {
    const events = this.getItem<StudentHeartbeatEvent>(STORAGE_KEY_HEARTBEAT_EVENTS);
    events.push(event);
    const attemptEvents = events
      .filter((candidate) => candidate.attemptId === event.attemptId)
      .sort(
        (left, right) => new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime()
      );
    const pruned =
      attemptEvents.length > MAX_HEARTBEAT_EVENTS_PER_ATTEMPT
        ? attemptEvents.slice(attemptEvents.length - MAX_HEARTBEAT_EVENTS_PER_ATTEMPT)
        : attemptEvents;
    const other = events.filter((candidate) => candidate.attemptId !== event.attemptId);
    this.setItem(STORAGE_KEY_HEARTBEAT_EVENTS, [...other, ...pruned]);
  }

  async getHeartbeatEvents(attemptId: string): Promise<StudentHeartbeatEvent[]> {
    const events = this.getItem<StudentHeartbeatEvent>(STORAGE_KEY_HEARTBEAT_EVENTS);
    return events
      .filter((event) => event.attemptId === attemptId)
      .sort(
        (left, right) => new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime()
      );
  }

  async deleteHeartbeatEvent(attemptId: string, eventId: string): Promise<void> {
    const events = this.getItem<StudentHeartbeatEvent>(STORAGE_KEY_HEARTBEAT_EVENTS);
    this.setItem(
      STORAGE_KEY_HEARTBEAT_EVENTS,
      events.filter((event) => !(event.attemptId === attemptId && event.id === eventId))
    );
  }

  async flushHeartbeatEvents(_attemptId: string): Promise<boolean> {
    return false;
  }
}

class BackendStudentAttemptRepository implements IStudentAttemptRepository {
  private readonly saveAttemptLocks = new Map<string, Promise<void>>();

  constructor(private readonly cache: LocalStorageStudentAttemptCache) {}

  private async withSaveAttemptLock<T>(attemptId: string, work: () => Promise<T>): Promise<T> {
    const previous = this.saveAttemptLocks.get(attemptId) ?? Promise.resolve();
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const lock = previous.then(
      () => gate,
      () => gate
    );

    this.saveAttemptLocks.set(attemptId, lock);

    await previous.catch(() => undefined);
    try {
      return await work();
    } finally {
      release();
      if (this.saveAttemptLocks.get(attemptId) === lock) {
        this.saveAttemptLocks.delete(attemptId);
      }
    }
  }

  private async refreshAttemptCredential(attempt: StudentAttempt): Promise<boolean> {
    try {
      return await refreshAttemptCredentialForAttempt(attempt);
    } catch {
      return false;
    }
  }

  private async ensureAttemptCredential(attempt: StudentAttempt): Promise<boolean> {
    if (hasAttemptCredential(attempt.scheduleId, attempt.id)) {
      return true;
    }

    return this.refreshAttemptCredential(attempt);
  }

  private async postWithAttemptAuth<T>(
    attempt: StudentAttempt,
    endpoint: string,
    body: unknown,
    options?: Omit<ApiRequestConfig, "headers"> & {
      headers?: Record<string, string> | undefined;
    }
  ): Promise<T> {
    const doPost = async (): Promise<T> =>
      backendPost<T>(endpoint, body, {
        ...options,
        headers: {
          ...(options?.headers ?? {}),
          ...buildAttemptAuthorizationHeaderFromAdapter(attempt),
        },
      });

    try {
      return await doPost();
    } catch (error) {
      const shouldRetry = isUnauthorizedError(error) || isMissingAttemptCredentialError(error);
      if (!shouldRetry) {
        throw error;
      }

      const refreshed = isUnauthorizedError(error)
        ? await this.refreshAttemptCredential(attempt)
        : await this.ensureAttemptCredential(attempt);
      if (!refreshed) {
        throw error;
      }

      return doPost();
    }
  }

  private async recordDroppedMutationsAudit(
    attempt: StudentAttempt,
    payload: Record<string, unknown>
  ): Promise<void> {
    try {
      await backendPost(
        studentSessionTransport.paths.audit(attempt.scheduleId),
        {
          actionType: "AUTO_ACTION",
          clientTimestamp: new Date().toISOString(),
          payload: {
            event: "MUTATION_DROPPED_STALE_SECTION",
            ...payload,
          },
        },
        {
          headers: buildAttemptAuthorizationHeaderFromAdapter(attempt),
          retries: 0,
          timeout: 5_000,
        }
      );
    } catch {
      // Best-effort only: never block saving/flush.
    }
  }

  private async reconcileAttemptWithCachedState(
    attempt: StudentAttempt,
    pendingMutations: StudentAttemptMutation[]
  ): Promise<StudentAttempt> {
    const localAttempt =
      (await this.cache.getAllAttempts()).find((candidate) => candidate.id === attempt.id) ?? null;
    const acceptedAttempt = preserveNewerAcceptedLocalState(attempt, localAttempt);
    return replayPendingMutationsOntoAttempt(acceptedAttempt, pendingMutations);
  }

  private async cacheAttempt(attempt: StudentAttempt): Promise<StudentAttempt> {
    const pendingMutations = await this.cache.getPendingMutations(attempt.id);
    const reconciledAttempt = await this.reconcileAttemptWithCachedState(attempt, pendingMutations);
    await this.cache.saveAttempt(reconciledAttempt);
    primeMutationSequenceWatermark(reconciledAttempt);
    return reconciledAttempt;
  }

  async getAttemptByScheduleId(
    scheduleId: string,
    studentKey: string
  ): Promise<StudentAttempt | null> {
    const candidateId = studentSessionTransport.resolveCandidateIdFromStudentKey(
      scheduleId,
      studentKey
    );
    if (!candidateId) {
      return null;
    }
    const session = await backendGet<BackendStudentSessionContext>(
      studentSessionTransport.paths.session(scheduleId, candidateId)
    );
    if (!session.attempt) {
      return null;
    }

    const attempt = mapBackendStudentAttempt(session.attempt);
    storeAttemptCredentialFromAdapter(attempt, session.attemptCredential);
    return this.cacheAttempt(attempt);
  }

  async getCanonicalAttemptByScheduleId(
    scheduleId: string,
    studentKey: string
  ): Promise<StudentAttempt | null> {
    const candidateId = studentSessionTransport.resolveCandidateIdFromStudentKey(
      scheduleId,
      studentKey
    );
    if (!candidateId) return null;
    const session = await backendGet<BackendStudentSessionContext>(
      studentSessionTransport.paths.session(scheduleId, candidateId)
    );
    if (!session.attempt) return null;
    const attempt = mapBackendStudentAttempt(session.attempt);
    storeAttemptCredentialFromAdapter(attempt, session.attemptCredential);
    return attempt;
  }

  async getAllAttempts(): Promise<StudentAttempt[]> {
    return this.cache.getAllAttempts();
  }

  async getAttemptsByScheduleId(scheduleId: string): Promise<StudentAttempt[]> {
    return this.cache.getAttemptsByScheduleId(scheduleId);
  }

  async saveAttempt(attempt: StudentAttempt, context?: SaveAttemptLifecycleContext): Promise<void> {
    void context;
    await this.withSaveAttemptLock(attempt.id, async () => {
      const pendingMutations = await this.cache.getPendingMutations(attempt.id);
      const currentAttempt = await this.reconcileAttemptWithCachedState(attempt, pendingMutations);
      await this.cache.saveAttempt(currentAttempt);
      primeMutationSequenceWatermark(currentAttempt);
    });
  }

  async createAttempt(seed: StudentAttemptSeed): Promise<StudentAttempt> {
    const session = await backendPost<BackendStudentSessionContext>(
      studentSessionTransport.paths.bootstrap(seed.scheduleId),
      {
        studentKey: seed.studentKey,
        candidateId: seed.candidateId,
        candidateName: seed.candidateName,
        candidateEmail: seed.candidateEmail,
        clientSessionId: ensureClientSessionId(seed.scheduleId, seed.studentKey),
      }
    );

    if (!session.attempt) {
      throw new Error("Backend bootstrap did not return an attempt");
    }

    const attempt = mapBackendStudentAttempt(session.attempt);
    storeAttemptCredentialFromAdapter(attempt, session.attemptCredential);
    return this.cacheAttempt(attempt);
  }

  async savePendingMutations(
    attemptId: string,
    mutations: StudentAttemptMutation[]
  ): Promise<void> {
    await this.cache.savePendingMutations(attemptId, mutations);
  }

  async getPendingMutations(attemptId: string): Promise<StudentAttemptMutation[]> {
    return this.cache.getPendingMutations(attemptId);
  }

  async clearPendingMutations(attemptId: string): Promise<void> {
    await this.cache.clearPendingMutations(attemptId);
  }

  async saveHeartbeatEvent(event: StudentHeartbeatEvent): Promise<void> {
    await this.cache.saveHeartbeatEvent(event);

    const attempts = await this.cache.getAllAttempts();
    const attempt = attempts.find((candidate) => candidate.id === event.attemptId);
    if (!attempt) {
      return;
    }

    if (!(await this.ensureAttemptCredential(attempt))) {
      return;
    }

    try {
      const response = await this.postWithAttemptAuth<BackendHeartbeatResponse>(
        attempt,
        studentSessionTransport.paths.heartbeat(
          event.scheduleId,
          event.type === "heartbeat" ? "ack" : undefined
        ),
        {
          attemptId: event.attemptId,
          studentKey: attempt.studentKey,
          clientSessionId: ensureClientSessionIdForAttempt(attempt),
          eventType: event.type,
          payload: event.payload,
          clientTimestamp: event.timestamp,
        },
        undefined
      );

      storeAttemptCredentialFromAdapter(attempt, response.refreshedAttemptCredential);
      if (response.attempt) {
        await this.cacheAttempt(mapBackendStudentAttempt(response.attempt));
      }
      await this.cache.deleteHeartbeatEvent(event.attemptId, event.id);
    } catch {
      // Keep the event in storage for replay on reconnect.
    }
  }

  async getHeartbeatEvents(attemptId: string): Promise<StudentHeartbeatEvent[]> {
    return this.cache.getHeartbeatEvents(attemptId);
  }

  async deleteHeartbeatEvent(attemptId: string, eventId: string): Promise<void> {
    await this.cache.deleteHeartbeatEvent(attemptId, eventId);
  }

  async flushHeartbeatEvents(attemptId: string): Promise<boolean> {
    const attempts = await this.cache.getAllAttempts();
    const attempt = attempts.find((candidate) => candidate.id === attemptId);
    if (!attempt) {
      return false;
    }

    if (!(await this.ensureAttemptCredential(attempt))) {
      return false;
    }

    const events = await this.cache.getHeartbeatEvents(attemptId);
    if (events.length === 0) {
      return true;
    }

    const toFlush = events.slice(0, MAX_HEARTBEAT_FLUSH_EVENTS);
    for (const event of toFlush) {
      try {
        const response = await this.postWithAttemptAuth<BackendHeartbeatResponse>(
          attempt,
          studentSessionTransport.paths.heartbeat(
            event.scheduleId,
            event.type === "heartbeat" ? "ack" : undefined
          ),
          {
            attemptId: event.attemptId,
            studentKey: attempt.studentKey,
            clientSessionId: ensureClientSessionIdForAttempt(attempt),
            eventType: event.type,
            payload: event.payload,
            clientTimestamp: event.timestamp,
          },
          undefined
        );

        storeAttemptCredentialFromAdapter(attempt, response.refreshedAttemptCredential);
        if (response.attempt) {
          await this.cacheAttempt(mapBackendStudentAttempt(response.attempt));
        }
        await this.cache.deleteHeartbeatEvent(event.attemptId, event.id);
      } catch {
        return false;
      }
    }

    return true;
  }
}

const studentAttemptCache = new LocalStorageStudentAttemptCache();
export const studentAttemptRepository: IStudentAttemptRepository =
  new BackendStudentAttemptRepository(studentAttemptCache);
