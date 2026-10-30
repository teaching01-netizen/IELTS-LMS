import {
  clearDurableDraft,
  listDurableDrafts,
  loadDurableDraft,
  saveDurableDraft,
} from '../../../utils/durableDraftStore';
import {
  parseIeltsSharedSchedule,
  type IeltsSharedSchedule,
} from '../domain/exam-session/ieltsSharedSchedule';

/**
 * Durable offline package for an IELTS shared-timetable attempt
 * (docs/superpowers/plans/2026-10-30-ielts-shared-clock-offline-continuity.md
 * §3, §4.4). The manifest is a server descriptor delivered under existing
 * authentication; a stored copy is untrusted input and never authorizes a
 * server write. Answers stay in the durability engine, not here.
 */

export interface IeltsOfflineMediaDescriptor {
  resourceId: string;
  kind: 'audio' | 'image';
  partId: string | null;
  mediaRevision: string;
  url: string;
  sha256: string | null;
  bytes: number | null;
}

export interface IeltsOfflineManifest {
  schemaVersion: 1;
  runtimeId: string;
  scheduleId: string;
  attemptId: string;
  publishedVersionId: string;
  clientSessionId: string;
  leaseEpoch: number;
  controlEpoch: number;
  recoveryRunGeneration: number | null;
  schedule: IeltsSharedSchedule;
  serverNow: string;
  contentDigest: string;
  media: IeltsOfflineMediaDescriptor[];
}

/** Verified bytes of one resource, as held in Cache Storage. */
export interface IeltsOfflineMediaRecord {
  resourceId: string;
  kind: 'audio' | 'image';
  partId: string | null;
  mediaRevision: string;
  url: string;
  sha256: string;
  bytes: number;
  contentType: string;
}

export interface IeltsClockAnchor {
  /** Server instant of the last authoritative read. */
  serverNowMs: number;
  /** Wall clock when it was received. */
  receivedWallMs: number;
  /** Highest server time this device has ever projected (never moves back). */
  lastEstimatedServerNowMs: number;
}

export interface IeltsOfflinePackage {
  schemaVersion: 1;
  key: string;
  status: 'incomplete' | 'ready';
  userId: string;
  scheduleId: string;
  candidateId: string;
  manifest: IeltsOfflineManifest;
  /** Student static session payload (schedule + filtered version), credential-free. */
  staticPayload: Record<string, unknown>;
  /** Last authoritative runtime/attempt projection, credential-free. */
  liveSnapshot: { runtime: unknown; attempt: unknown } | null;
  shellBuildId: string | null;
  media: IeltsOfflineMediaRecord[];
  clock: IeltsClockAnchor;
  preparedAt: string | null;
  /** Set on logout: the package cannot open the exam, but is not deleted. */
  blocked: boolean;
}

const MAX_MEDIA = 256;
const PACKAGE_KEY_PREFIX = 'ielts-offline-package:';
const ROUTE_INDEX_STORAGE_KEY = 'ielts_offline_route_index_v1';
const LAST_USER_STORAGE_KEY = 'ielts_offline_last_user_v1';
const CREDENTIAL_KEYS = ['attemptCredential', 'admission', 'offlineManifest', 'clientSessionId'];

const str = (value: unknown, max = 512): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= max;
const count = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0;

export function parseIeltsOfflineManifest(value: unknown): IeltsOfflineManifest | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const schedule = parseIeltsSharedSchedule(raw['schedule']);
  const generation = raw['recoveryRunGeneration'];
  if (
    raw['schemaVersion'] !== 1 ||
    !schedule ||
    !['runtimeId', 'scheduleId', 'attemptId', 'publishedVersionId', 'clientSessionId', 'contentDigest'].every((k) =>
      str(raw[k]),
    ) ||
    !count(raw['leaseEpoch']) ||
    !count(raw['controlEpoch']) ||
    !(generation === null || count(generation)) ||
    !str(raw['serverNow']) ||
    !Number.isFinite(Date.parse(raw['serverNow'] as string)) ||
    !Array.isArray(raw['media']) ||
    raw['media'].length > MAX_MEDIA
  ) {
    return null;
  }
  const media: IeltsOfflineMediaDescriptor[] = [];
  for (const entry of raw['media'] as unknown[]) {
    const m = (entry ?? {}) as Record<string, unknown>;
    if (
      !str(m['resourceId'], 64) ||
      (m['kind'] !== 'audio' && m['kind'] !== 'image') ||
      !(m['partId'] === null || str(m['partId'], 64)) ||
      !str(m['mediaRevision'], 64) ||
      !str(m['url'], 2048) ||
      !(m['sha256'] === null || (typeof m['sha256'] === 'string' && /^[0-9a-f]{64}$/.test(m['sha256']))) ||
      !(m['bytes'] === null || count(m['bytes']))
    ) {
      return null;
    }
    media.push({
      resourceId: m['resourceId'],
      kind: m['kind'],
      partId: m['partId'] as string | null,
      mediaRevision: m['mediaRevision'],
      url: m['url'],
      sha256: m['sha256'] as string | null,
      bytes: m['bytes'] as number | null,
    });
  }
  return {
    schemaVersion: 1,
    runtimeId: raw['runtimeId'] as string,
    scheduleId: raw['scheduleId'] as string,
    attemptId: raw['attemptId'] as string,
    publishedVersionId: raw['publishedVersionId'] as string,
    clientSessionId: raw['clientSessionId'] as string,
    leaseEpoch: raw['leaseEpoch'] as number,
    controlEpoch: raw['controlEpoch'] as number,
    recoveryRunGeneration: generation as number | null,
    schedule,
    serverNow: raw['serverNow'] as string,
    contentDigest: raw['contentDigest'] as string,
    media,
  };
}

// --- Latest server-issued manifest per attempt (in memory) -----------------

const latestManifests = new Map<string, IeltsOfflineManifest>();
const manifestListeners = new Set<(manifest: IeltsOfflineManifest) => void>();

/** Called wherever an authenticated session context arrives. */
export function rememberIeltsOfflineManifest(raw: unknown): void {
  const manifest = parseIeltsOfflineManifest(raw);
  if (!manifest) return;
  const current = latestManifests.get(manifest.attemptId);
  if (current && Date.parse(current.serverNow) > Date.parse(manifest.serverNow)) return;
  latestManifests.set(manifest.attemptId, manifest);
  for (const listener of manifestListeners) listener(manifest);
}

export function latestIeltsOfflineManifest(attemptId: string): IeltsOfflineManifest | null {
  return latestManifests.get(attemptId) ?? null;
}

export function subscribeIeltsOfflineManifest(listener: (manifest: IeltsOfflineManifest) => void): () => void {
  manifestListeners.add(listener);
  return () => manifestListeners.delete(listener);
}

// --- Identity and route index ---------------------------------------------

/**
 * Package identity: user, attempt, version, browser session, lease and
 * recovery run. Any change is a different package (INV-3).
 */
export function ieltsOfflinePackageKey(userId: string, manifest: IeltsOfflineManifest): string {
  return [
    'ielts-offline-package',
    userId,
    manifest.attemptId,
    manifest.publishedVersionId,
    manifest.clientSessionId,
    manifest.leaseEpoch,
    manifest.recoveryRunGeneration ?? 'none',
  ].join(':');
}

function readJsonStorage<T>(key: string): T | null {
  try {
    const raw = globalThis.localStorage?.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeJsonStorage(key: string, value: unknown): void {
  try {
    globalThis.localStorage?.setItem(key, JSON.stringify(value));
  } catch {
    // The durable package remains; only the synchronous hint is lost.
  }
}

type RouteIndex = Record<string, { packageKey: string; userId: string }>;
const routeKey = (scheduleId: string, candidateId: string) => `${scheduleId}\u0000${candidateId}`;

/** Synchronous hint for the route guard: a package may exist for this route. */
export function hasIeltsOfflineRoute(scheduleId: string, candidateId: string): boolean {
  return Boolean(readJsonStorage<RouteIndex>(ROUTE_INDEX_STORAGE_KEY)?.[routeKey(scheduleId, candidateId)]);
}

/** Records the last authenticated account on this browser. */
export function recordIeltsOfflineAccount(userId: string | null): void {
  if (userId) writeJsonStorage(LAST_USER_STORAGE_KEY, { userId });
}

function lastIeltsOfflineAccount(): string | null {
  return readJsonStorage<{ userId?: unknown }>(LAST_USER_STORAGE_KEY)?.userId as string | null ?? null;
}

// --- Durable package lifecycle --------------------------------------------

function stripCredentials(payload: Record<string, unknown>): Record<string, unknown> {
  const copy = { ...payload };
  for (const key of CREDENTIAL_KEYS) delete copy[key];
  return copy;
}

/** Writes the package as incomplete. Nothing can open it until markReady. */
export async function beginIeltsOfflinePackage(input: {
  userId: string;
  candidateId: string;
  manifest: IeltsOfflineManifest;
  staticPayload: Record<string, unknown>;
  liveSnapshot: { runtime: unknown; attempt: unknown } | null;
  receivedWallMs: number;
}): Promise<IeltsOfflinePackage> {
  const serverNowMs = Date.parse(input.manifest.serverNow);
  const record: IeltsOfflinePackage = {
    schemaVersion: 1,
    key: ieltsOfflinePackageKey(input.userId, input.manifest),
    status: 'incomplete',
    userId: input.userId,
    scheduleId: input.manifest.scheduleId,
    candidateId: input.candidateId,
    manifest: input.manifest,
    staticPayload: stripCredentials(input.staticPayload),
    liveSnapshot: input.liveSnapshot,
    shellBuildId: null,
    media: [],
    clock: { serverNowMs, receivedWallMs: input.receivedWallMs, lastEstimatedServerNowMs: serverNowMs },
    preparedAt: null,
    blocked: false,
  };
  await saveDurableDraft(record.key, record);
  return record;
}

/** Commit marker, written last: only now may the package authorize offline transitions. */
export async function markIeltsOfflinePackageReady(
  record: IeltsOfflinePackage,
  media: IeltsOfflineMediaRecord[],
  shellBuildId: string,
): Promise<IeltsOfflinePackage> {
  const ready: IeltsOfflinePackage = {
    ...record,
    status: 'ready',
    media,
    shellBuildId,
    preparedAt: new Date().toISOString(),
  };
  await saveDurableDraft(ready.key, ready);
  const index = readJsonStorage<RouteIndex>(ROUTE_INDEX_STORAGE_KEY) ?? {};
  index[routeKey(ready.scheduleId, ready.candidateId)] = { packageKey: ready.key, userId: ready.userId };
  writeJsonStorage(ROUTE_INDEX_STORAGE_KEY, index);
  return ready;
}

/** Refreshes the cached schedule/projection and clock from a newer authoritative read. */
export async function refreshIeltsOfflinePackage(
  key: string,
  update: {
    schedule?: IeltsSharedSchedule | null;
    liveSnapshot?: { runtime: unknown; attempt: unknown } | null;
    serverNowMs?: number;
    receivedWallMs?: number;
    lastEstimatedServerNowMs?: number;
  },
): Promise<void> {
  const current = await loadDurableDraft<IeltsOfflinePackage>(key);
  if (!current || current.schemaVersion !== 1) return;
  const clock = { ...current.clock };
  if (update.serverNowMs !== undefined && update.receivedWallMs !== undefined) {
    clock.serverNowMs = update.serverNowMs;
    clock.receivedWallMs = update.receivedWallMs;
  }
  clock.lastEstimatedServerNowMs = Math.max(
    clock.lastEstimatedServerNowMs,
    update.lastEstimatedServerNowMs ?? 0,
    update.serverNowMs ?? 0,
  );
  const schedule =
    update.schedule && update.schedule.scheduleRevision >= current.manifest.schedule.scheduleRevision
      ? update.schedule
      : current.manifest.schedule;
  await saveDurableDraft(key, {
    ...current,
    manifest: { ...current.manifest, schedule },
    liveSnapshot: update.liveSnapshot ?? current.liveSnapshot,
    clock,
  } satisfies IeltsOfflinePackage);
}

export type IeltsOfflineRestoreRefusal =
  | 'no_package'
  | 'not_ready'
  | 'blocked'
  | 'identity_mismatch'
  | 'corrupt';

/**
 * Loads the ready package for an offline reload of this route. The caller
 * must already have seen a network failure; this never runs after an
 * explicit server denial. `currentUserId` is the authenticated account when
 * known; otherwise the last account recorded on this browser must match.
 */
export async function loadIeltsOfflinePackageForRoute(
  scheduleId: string,
  candidateId: string,
  currentUserId: string | null,
): Promise<{ ok: true; record: IeltsOfflinePackage } | { ok: false; reason: IeltsOfflineRestoreRefusal }> {
  const entry = readJsonStorage<RouteIndex>(ROUTE_INDEX_STORAGE_KEY)?.[routeKey(scheduleId, candidateId)];
  if (!entry) return { ok: false, reason: 'no_package' };
  const expectedUser = currentUserId ?? lastIeltsOfflineAccount();
  if (!expectedUser || expectedUser !== entry.userId) return { ok: false, reason: 'identity_mismatch' };
  const record = await loadDurableDraft<IeltsOfflinePackage>(entry.packageKey);
  if (!record) return { ok: false, reason: 'no_package' };
  const manifest = parseIeltsOfflineManifest(record.manifest);
  if (
    record.schemaVersion !== 1 ||
    !manifest ||
    record.key !== ieltsOfflinePackageKey(record.userId, manifest) ||
    record.userId !== expectedUser ||
    record.scheduleId !== scheduleId ||
    record.candidateId !== candidateId
  ) {
    return { ok: false, reason: 'corrupt' };
  }
  if (record.blocked) return { ok: false, reason: 'blocked' };
  if (record.status !== 'ready') return { ok: false, reason: 'not_ready' };
  return { ok: true, record: { ...record, manifest } };
}

/**
 * Every package stored for one attempt, across version/session/lease/run
 * identities. Cleanup needs them all; normal restore never does.
 */
export async function listIeltsOfflinePackagesForAttempt(
  attemptId: string,
): Promise<IeltsOfflinePackage[]> {
  if (!attemptId) return [];
  const rows = await listDurableDrafts<unknown>(PACKAGE_KEY_PREFIX);
  const out: IeltsOfflinePackage[] = [];
  for (const { key, value } of rows) {
    if (!value || typeof value !== 'object') continue;
    const record = value as Partial<IeltsOfflinePackage>;
    if (
      record.schemaVersion === 1 &&
      record.key === key &&
      record.manifest?.attemptId === attemptId &&
      typeof record.scheduleId === 'string' &&
      typeof record.candidateId === 'string'
    ) {
      out.push(record as IeltsOfflinePackage);
    }
  }
  return out;
}

/**
 * Removes local copies of server-acknowledged answers. They are not unsent
 * work, so an identity fence may clear them; per-question pending drafts and
 * evidence stay untouched.
 */
function clearConfirmedAnswerCopies(): void {
  try {
    const storage = globalThis.localStorage;
    if (!storage) return;
    const keys: string[] = [];
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key?.startsWith('v2_confirmed_answers:')) keys.push(key);
    }
    for (const key of keys) storage.removeItem(key);
  } catch {
    // A locked storage cannot expose more access than it already has.
  }
}

/** Logout: block offline access to every package; unsent work is kept. */
export async function blockIeltsOfflinePackages(): Promise<void> {
  clearConfirmedAnswerCopies();
  const index = readJsonStorage<RouteIndex>(ROUTE_INDEX_STORAGE_KEY) ?? {};
  try {
    globalThis.localStorage?.removeItem(ROUTE_INDEX_STORAGE_KEY);
    globalThis.localStorage?.removeItem(LAST_USER_STORAGE_KEY);
  } catch {
    // Durable flags below still block reuse.
  }
  await Promise.all(
    Object.values(index).map(async ({ packageKey }) => {
      const record = await loadDurableDraft<IeltsOfflinePackage>(packageKey);
      if (record) await saveDurableDraft(packageKey, { ...record, blocked: true });
    }),
  );
}

/**
 * Removes the package after server-confirmed completion. Callers must have a
 * server submission receipt and no pending answers or evidence (INV-8).
 */
export async function discardIeltsOfflinePackage(record: Pick<IeltsOfflinePackage, 'key' | 'scheduleId' | 'candidateId'>): Promise<void> {
  await clearDurableDraft(record.key);
  const index = readJsonStorage<RouteIndex>(ROUTE_INDEX_STORAGE_KEY) ?? {};
  const k = routeKey(record.scheduleId, record.candidateId);
  if (index[k]?.packageKey === record.key) {
    delete index[k];
    writeJsonStorage(ROUTE_INDEX_STORAGE_KEY, index);
  }
}

/** Binds package access to the auth lifecycle (call once at app start). */
export function bindIeltsOfflinePackagesToAuth(auth: {
  onAuthIdentityFenced: (listener: () => void) => () => void;
  onAuthIdentityResolved: (listener: (userId: string) => void) => () => void;
}): () => void {
  const offFenced = auth.onAuthIdentityFenced(() => void blockIeltsOfflinePackages().catch(() => undefined));
  const offResolved = auth.onAuthIdentityResolved((userId) => recordIeltsOfflineAccount(userId));
  return () => {
    offFenced();
    offResolved();
  };
}

/** True only for a failure to reach the server at all (never an HTTP answer). */
export function isOfflineTransportFailure(error: unknown): boolean {
  if (error instanceof TypeError) return true;
  if (!error || typeof error !== 'object') return false;
  const e = error as { category?: unknown; code?: unknown; backendCode?: unknown; statusCode?: unknown; status?: unknown };
  return e.category === 'network' || e.code === 'NETWORK_ERROR' || e.backendCode === 'NETWORK_ERROR';
}
