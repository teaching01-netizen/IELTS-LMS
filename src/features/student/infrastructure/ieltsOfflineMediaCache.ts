import type { IeltsOfflineMediaDescriptor, IeltsOfflineMediaRecord } from './ieltsOfflinePackageStore';

/**
 * Attempt-scoped Cache Storage for verified IELTS media bytes. Keys are a
 * synthetic origin bound to media revision + resource, never the fetch URL,
 * so an expiring signed URL cannot invalidate verified bytes and the service
 * worker never serves these entries to ordinary fetches.
 */

const CACHE_PREFIX = 'ielts-offline-media-v1:';
const KEY_ORIGIN = 'https://ielts-offline.invalid';
const MAX_CONCURRENT_FETCHES = 2;

export type IeltsMediaFailure =
  | 'cache_unavailable'
  | 'http_error'
  | 'opaque_response'
  | 'size_mismatch'
  | 'digest_mismatch'
  | 'undecodable'
  | 'quota'
  | 'cancelled';

export class IeltsOfflineMediaError extends Error {
  constructor(
    readonly reason: IeltsMediaFailure,
    readonly resourceId: string,
  ) {
    super(`IELTS offline media ${resourceId}: ${reason}`);
  }
}

export interface IeltsMediaCacheDeps {
  fetchImpl?: typeof fetch;
  caches?: CacheStorage | undefined;
  /** Confirms the browser can parse a complete audio file (metadata + duration). */
  probeAudio?: (blob: Blob) => Promise<boolean>;
}

const cacheName = (attemptId: string) => `${CACHE_PREFIX}${attemptId}`;
const cacheKey = (record: Pick<IeltsOfflineMediaDescriptor, 'mediaRevision' | 'resourceId'>) =>
  `${KEY_ORIGIN}/${record.mediaRevision}/${record.resourceId}`;

export async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

function isQuotaError(error: unknown): boolean {
  return error instanceof DOMException && (error.name === 'QuotaExceededError' || error.code === 22);
}

/** Default audio probe: the full blob must expose finite, positive duration. */
export function probeAudioWithElement(blob: Blob, timeoutMs = 15_000): Promise<boolean> {
  if (typeof Audio === 'undefined' || typeof URL.createObjectURL !== 'function') return Promise.resolve(false);
  return new Promise((resolve) => {
    const audio = new Audio();
    const url = URL.createObjectURL(blob);
    const finish = (ok: boolean) => {
      clearTimeout(timer);
      audio.removeAttribute('src');
      audio.load();
      URL.revokeObjectURL(url);
      resolve(ok);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    audio.preload = 'metadata';
    audio.onloadedmetadata = () => finish(Number.isFinite(audio.duration) && audio.duration > 0);
    audio.onerror = () => finish(false);
    audio.src = url;
  });
}

function fetchInit(url: string, signal: AbortSignal | undefined): RequestInit {
  // Same-origin media carries the session cookie exactly like an <img>/<audio>
  // element would; cross-origin media must be CORS-readable (never opaque).
  const sameOrigin = url.startsWith('/') || url.startsWith(globalThis.location?.origin ?? '\u0000');
  return { credentials: sameOrigin ? 'same-origin' : 'omit', mode: sameOrigin ? 'same-origin' : 'cors', cache: 'no-store', signal: signal ?? null };
}

async function cacheOne(
  cache: Cache,
  descriptor: IeltsOfflineMediaDescriptor,
  deps: Required<Pick<IeltsMediaCacheDeps, 'fetchImpl' | 'probeAudio'>>,
  signal: AbortSignal | undefined,
): Promise<IeltsOfflineMediaRecord> {
  const fail = (reason: IeltsMediaFailure) => new IeltsOfflineMediaError(reason, descriptor.resourceId);
  let response: Response;
  try {
    response = await deps.fetchImpl(descriptor.url, fetchInit(descriptor.url, signal));
  } catch (error) {
    throw fail(signal?.aborted ? 'cancelled' : 'http_error');
  }
  if (response.type === 'opaque' || response.type === 'opaqueredirect') throw fail('opaque_response');
  if (!response.ok) throw fail('http_error');
  const bytes = await response.arrayBuffer().catch(() => {
    throw fail(signal?.aborted ? 'cancelled' : 'http_error');
  });
  const declared = Number(response.headers.get('content-length'));
  const encoded = Boolean(response.headers.get('content-encoding'));
  if ((!encoded && Number.isFinite(declared) && declared > 0 && declared !== bytes.byteLength) || bytes.byteLength === 0) {
    throw fail('size_mismatch');
  }
  if (descriptor.bytes !== null && descriptor.bytes !== bytes.byteLength) throw fail('size_mismatch');
  const digest = await sha256Hex(bytes);
  if (descriptor.sha256 !== null && descriptor.sha256 !== digest) throw fail('digest_mismatch');
  const contentType = response.headers.get('content-type') ?? (descriptor.kind === 'audio' ? 'audio/mpeg' : 'image/*');
  const blob = new Blob([bytes], { type: contentType });
  if (descriptor.kind === 'audio' && !(await deps.probeAudio(blob))) throw fail('undecodable');
  try {
    await cache.put(
      cacheKey(descriptor),
      new Response(bytes, { headers: { 'content-type': contentType, 'x-ielts-sha256': digest } }),
    );
  } catch (error) {
    throw fail(isQuotaError(error) ? 'quota' : 'cache_unavailable');
  }
  return {
    resourceId: descriptor.resourceId,
    kind: descriptor.kind,
    partId: descriptor.partId,
    mediaRevision: descriptor.mediaRevision,
    url: descriptor.url,
    sha256: digest,
    bytes: bytes.byteLength,
    contentType,
  };
}

/**
 * Downloads and verifies every resource with bounded concurrency. Any
 * failure rejects with IeltsOfflineMediaError; already cached entries remain
 * for a retry and are re-verified before use.
 */
export async function cacheIeltsOfflineMedia(
  attemptId: string,
  media: IeltsOfflineMediaDescriptor[],
  options: IeltsMediaCacheDeps & { signal?: AbortSignal; onProgress?: (done: number, total: number) => void } = {},
): Promise<IeltsOfflineMediaRecord[]> {
  const storage = options.caches ?? globalThis.caches;
  if (!storage) throw new IeltsOfflineMediaError('cache_unavailable', '*');
  const cache = await storage.open(cacheName(attemptId));
  const deps = {
    fetchImpl: options.fetchImpl ?? globalThis.fetch.bind(globalThis),
    probeAudio: options.probeAudio ?? ((blob: Blob) => probeAudioWithElement(blob)),
  };
  const results: IeltsOfflineMediaRecord[] = new Array(media.length);
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < media.length) {
      if (options.signal?.aborted) throw new IeltsOfflineMediaError('cancelled', '*');
      const index = next++;
      results[index] = await cacheOne(cache, media[index]!, deps, options.signal);
      options.onProgress?.(++done, media.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(MAX_CONCURRENT_FETCHES, media.length) }, worker));
  return results;
}

/** Reads one verified resource; null when missing or its bytes no longer match. */
export async function readIeltsOfflineMedia(
  attemptId: string,
  record: IeltsOfflineMediaRecord,
  storage: CacheStorage | undefined = globalThis.caches,
): Promise<Blob | null> {
  if (!storage) return null;
  try {
    const cache = await storage.open(cacheName(attemptId));
    const response = await cache.match(cacheKey(record));
    if (!response) return null;
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength !== record.bytes || (await sha256Hex(bytes)) !== record.sha256) return null;
    return new Blob([bytes], { type: record.contentType });
  } catch {
    return null;
  }
}

/** Read-back verification of the whole set before the package is marked ready. */
export async function verifyIeltsOfflineMedia(
  attemptId: string,
  records: IeltsOfflineMediaRecord[],
  storage?: CacheStorage,
): Promise<boolean> {
  for (const record of records) {
    if (!(await readIeltsOfflineMedia(attemptId, record, storage))) return false;
  }
  return true;
}

/** Removes the attempt's media after confirmed completion. */
export async function deleteIeltsOfflineMedia(attemptId: string, storage: CacheStorage | undefined = globalThis.caches): Promise<void> {
  await storage?.delete(cacheName(attemptId));
}
