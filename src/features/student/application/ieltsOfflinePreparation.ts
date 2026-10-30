import {
  beginIeltsOfflinePackage,
  markIeltsOfflinePackageReady,
  type IeltsOfflineManifest,
  type IeltsOfflinePackage,
} from '../infrastructure/ieltsOfflinePackageStore';
import {
  IeltsOfflineMediaError,
  cacheIeltsOfflineMedia,
  verifyIeltsOfflineMedia,
  type IeltsMediaCacheDeps,
} from '../infrastructure/ieltsOfflineMediaCache';
import { ensureIeltsOfflineShell, type IeltsShellResult } from '../infrastructure/ieltsOfflineShell';
import { verifyAnswerStorage } from './ieltsSectionPreparation';

export type IeltsOfflinePreparationFailure =
  | 'manifest_invalid'
  | 'identity_mismatch'
  | 'shell_unavailable'
  | 'media_failed'
  | 'audio_unavailable'
  | 'quota'
  | 'storage_failed'
  | 'cancelled';

export type IeltsOfflinePreparationResult =
  | { status: 'prepared'; record: IeltsOfflinePackage }
  | { status: 'failed'; reason: IeltsOfflinePreparationFailure; resourceId?: string };

export interface IeltsOfflinePreparationIdentity {
  userId: string;
  candidateId: string;
  scheduleId: string;
  attemptId: string;
  publishedVersionId: string | null;
  clientSessionId: string | null;
}

export interface IeltsOfflinePreparationDeps extends IeltsMediaCacheDeps {
  ensureShell?: () => Promise<IeltsShellResult>;
  verifyStorage?: (attemptId: string) => Promise<boolean>;
  estimateStorage?: () => Promise<{ quota?: number; usage?: number } | undefined>;
  now?: () => number;
}

/**
 * Prepares one device to continue the committed timetable offline. It only
 * ever writes this device's package and caches: it never calls /ready and
 * cannot move the room schedule or another student's readiness (FR-3).
 */
export async function prepareIeltsOfflinePackage(
  input: {
    manifest: IeltsOfflineManifest;
    identity: IeltsOfflinePreparationIdentity;
    staticPayload: Record<string, unknown>;
    liveSnapshot: { runtime: unknown; attempt: unknown } | null;
    signal?: AbortSignal;
  },
  deps: IeltsOfflinePreparationDeps = {},
): Promise<IeltsOfflinePreparationResult> {
  const { manifest, identity, signal } = input;
  const failed = (reason: IeltsOfflinePreparationFailure, resourceId?: string): IeltsOfflinePreparationResult => ({
    status: 'failed',
    reason: signal?.aborted ? 'cancelled' : reason,
    ...(resourceId ? { resourceId } : {}),
  });
  if (
    manifest.scheduleId !== identity.scheduleId ||
    manifest.attemptId !== identity.attemptId ||
    (identity.publishedVersionId !== null && manifest.publishedVersionId !== identity.publishedVersionId) ||
    (identity.clientSessionId !== null && manifest.clientSessionId !== identity.clientSessionId)
  ) {
    return failed('identity_mismatch');
  }
  const now = deps.now ?? Date.now;
  let record: IeltsOfflinePackage;
  try {
    record = await beginIeltsOfflinePackage({
      userId: identity.userId,
      candidateId: identity.candidateId,
      manifest,
      staticPayload: input.staticPayload,
      liveSnapshot: input.liveSnapshot,
      receivedWallMs: now(),
    });
  } catch {
    return failed('storage_failed');
  }
  const shell = await (deps.ensureShell ?? ensureIeltsOfflineShell)();
  if (!shell.ok) return failed('shell_unavailable');
  if (signal?.aborted) return failed('cancelled');

  const knownBytes = manifest.media.reduce((sum, m) => sum + (m.bytes ?? 0), 0);
  const estimateStorage = deps.estimateStorage ?? (async () => globalThis.navigator?.storage?.estimate?.());
  const estimate = await estimateStorage().catch(() => undefined);
  if (estimate?.quota !== undefined && knownBytes > estimate.quota - (estimate.usage ?? 0)) return failed('quota');
  // Best effort: ask the browser not to evict exam data under pressure.
  void globalThis.navigator?.storage?.persist?.().catch(() => false);

  let media;
  try {
    media = await cacheIeltsOfflineMedia(manifest.attemptId, manifest.media, { ...deps, ...(signal ? { signal } : {}) });
  } catch (error) {
    if (error instanceof IeltsOfflineMediaError) {
      const reason: IeltsOfflinePreparationFailure =
        error.reason === 'quota' ? 'quota' : error.reason === 'cancelled' ? 'cancelled' : error.reason === 'undecodable' ? 'audio_unavailable' : 'media_failed';
      return failed(reason, error.resourceId);
    }
    return failed('media_failed');
  }
  if (!(await verifyIeltsOfflineMedia(manifest.attemptId, media, deps.caches))) return failed('media_failed');
  if (!(await (deps.verifyStorage ?? verifyAnswerStorage)(manifest.attemptId))) return failed('storage_failed');
  if (signal?.aborted) return failed('cancelled');
  try {
    return { status: 'prepared', record: await markIeltsOfflinePackageReady(record, media, shell.buildId) };
  } catch {
    return failed('storage_failed');
  }
}
