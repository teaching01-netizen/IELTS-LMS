import type { SatQuestionResponseDraft } from '../domain/satResponses';
import {
  clearDurableDraft,
  loadDurableDraft,
  saveDurableDraft,
} from '../../../utils/durableDraftStore';

const SAT_RESPONSE_OUTBOX_PREFIX = 'sat-response-outbox:v1:';
const SAT_RESPONSE_CHECKPOINT_PREFIX = 'sat-response-checkpoint:v1:';
const MAX_TOMBSTONES = 200;

export type SatResponseInteractionType = 'typing' | 'discrete';

export interface SatResponseOutboxEntry {
  writeId: string;
  draft: SatQuestionResponseDraft;
  moduleAttemptId?: string | undefined;
  stageKey?: string | null | undefined;
  runtimeRevision?: number | null | undefined;
  createdAt?: string | undefined;
  interactionType?: SatResponseInteractionType | undefined;
}

export interface SatResponseTombstone {
  writeId: string;
  questionId: string;
  moduleAttemptId: string | null;
  stageKey: string | null;
  runtimeRevision: number | null;
  createdAt: string;
  rejectedAt: string;
  reason: string;
  payloadHash: string;
}

interface SatResponseOutboxRecord {
  schemaVersion: 2;
  entries: SatResponseOutboxEntry[];
  tombstones: SatResponseTombstone[];
}

interface LegacySatResponseOutboxRecord {
  schemaVersion: 1;
  entries: SatResponseOutboxEntry[];
}

export interface SatResponseRecoveryState {
  entries: SatResponseOutboxEntry[];
  tombstones: SatResponseTombstone[];
}

function outboxKey(scheduleId: string, attemptId: string): string {
  return `${SAT_RESPONSE_OUTBOX_PREFIX}${encodeURIComponent(scheduleId)}:${encodeURIComponent(attemptId)}`;
}

function browserStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}
function normalizeEntry(entry: SatResponseOutboxEntry): SatResponseOutboxEntry {
  return {
    ...entry,
    draft: {
      ...entry.draft,
      eliminatedOptionIds: [...entry.draft.eliminatedOptionIds],
      annotations: { ...entry.draft.annotations },
    },
  };
}

function checkpointPrefix(scheduleId: string, attemptId: string): string {
  return `${SAT_RESPONSE_CHECKPOINT_PREFIX}${encodeURIComponent(scheduleId)}:${encodeURIComponent(attemptId)}:`;
}

function checkpointKey(scheduleId: string, attemptId: string, questionId: string): string {
  return `${checkpointPrefix(scheduleId, attemptId)}${encodeURIComponent(questionId)}`;
}

function parseEntry(raw: string | null): SatResponseOutboxEntry | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as SatResponseOutboxEntry;
    if (!parsed?.writeId || !parsed.draft?.questionId) return null;
    return normalizeEntry(parsed);
  } catch {
    return null;
  }
}

function parseRecord(raw: string | null): SatResponseRecoveryState | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as SatResponseOutboxRecord | LegacySatResponseOutboxRecord;
    if (!Array.isArray(parsed?.entries)) return null;
    return {
      entries: parsed.entries.map(normalizeEntry),
      tombstones: parsed.schemaVersion === 2 && Array.isArray(parsed.tombstones)
        ? parsed.tombstones.slice(-MAX_TOMBSTONES)
        : [],
    };
  } catch {
    return null;
  }
}

function recordFor(
  entries: readonly SatResponseOutboxEntry[],
  tombstones: readonly SatResponseTombstone[],
): SatResponseOutboxRecord {
  return {
    schemaVersion: 2,
    entries: entries.map(normalizeEntry),
    tombstones: tombstones.slice(-MAX_TOMBSTONES),
  };
}

function localCheckpoints(scheduleId: string, attemptId: string): SatResponseOutboxEntry[] {
  const storage = browserStorage();
  if (!storage) return [];
  const prefix = checkpointPrefix(scheduleId, attemptId);
  const entries: SatResponseOutboxEntry[] = [];
  try {
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (!key?.startsWith(prefix)) continue;
      const entry = parseEntry(storage.getItem(key));
      if (entry) entries.push(entry);
    }
  } catch {
    return entries;
  }
  return entries;
}

export function checkpointSatResponseEntry(
  scheduleId: string,
  attemptId: string,
  entry: SatResponseOutboxEntry,
): void {
  try {
    browserStorage()?.setItem(
      checkpointKey(scheduleId, attemptId, entry.draft.questionId),
      JSON.stringify(normalizeEntry(entry)),
    );
  } catch {
    // IndexedDB persistence remains the durable fallback.
  }
}

export function clearSatResponseCheckpoint(
  scheduleId: string,
  attemptId: string,
  questionId: string,
): void {
  try {
    browserStorage()?.removeItem(checkpointKey(scheduleId, attemptId, questionId));
  } catch {
    // Best-effort cleanup; durable state remains authoritative for recovery.
  }
}

export async function loadSatResponseRecoveryState(
  scheduleId: string,
  attemptId: string,
): Promise<SatResponseRecoveryState> {
  const key = outboxKey(scheduleId, attemptId);
  const durable = await loadDurableDraft<SatResponseOutboxRecord | LegacySatResponseOutboxRecord>(key);
  const legacyLocal = parseRecord(browserStorage()?.getItem(key) ?? null);
  const durableState = durable ? parseRecord(JSON.stringify(durable)) : null;
  const entries = new Map<string, SatResponseOutboxEntry>();
  for (const entry of [...(durableState?.entries ?? []), ...(legacyLocal?.entries ?? []), ...localCheckpoints(scheduleId, attemptId)]) {
    const existing = entries.get(entry.draft.questionId);
    if (!existing || (entry.createdAt ?? '') >= (existing.createdAt ?? '')) {
      entries.set(entry.draft.questionId, entry);
    }
  }
  return {
    entries: [...entries.values()],
    tombstones: durableState?.tombstones ?? legacyLocal?.tombstones ?? [],
  };
}

export async function loadSatResponseOutbox(
  scheduleId: string,
  attemptId: string,
): Promise<SatResponseOutboxEntry[]> {
  return (await loadSatResponseRecoveryState(scheduleId, attemptId)).entries;
}

export async function persistSatResponseOutbox(
  scheduleId: string,
  attemptId: string,
  entries: readonly SatResponseOutboxEntry[],
  tombstones: readonly SatResponseTombstone[] = [],
): Promise<void> {
  const key = outboxKey(scheduleId, attemptId);
  const storage = browserStorage();
  const record = recordFor(entries, tombstones);
  try {
    if (entries.length === 0 && tombstones.length === 0) {
      await clearDurableDraft(key);
    } else {
      await saveDurableDraft(key, record);
    }
  } catch (error) {
    if (!storage) {
      throw new Error('Unable to persist the SAT response recovery outbox.', { cause: error });
    }
  }

  try {
    storage?.removeItem(key);
  } catch {
    // The legacy v1 aggregate is migration input only.
  }
}

export function satResponseOutboxStorageKey(scheduleId: string, attemptId: string): string {
  return outboxKey(scheduleId, attemptId);
}

export function satResponseCheckpointStorageKey(
  scheduleId: string,
  attemptId: string,
  questionId: string,
): string {
  return checkpointKey(scheduleId, attemptId, questionId);
}
