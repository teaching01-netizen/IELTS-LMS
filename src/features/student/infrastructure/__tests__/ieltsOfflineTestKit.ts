import type { IeltsOfflineManifest } from '../ieltsOfflinePackageStore';

/** Minimal in-memory Cache Storage (jsdom has none). */
export function createFakeCaches(): CacheStorage & { corrupt(key: string): void } {
  const stores = new Map<string, Map<string, Response>>();
  const open = async (name: string) => {
    const store = stores.get(name) ?? new Map<string, Response>();
    stores.set(name, store);
    return {
      match: async (key: RequestInfo | URL) => store.get(String(key))?.clone(),
      put: async (key: RequestInfo | URL, response: Response) => void store.set(String(key), response),
    } as unknown as Cache;
  };
  return {
    open,
    delete: async (name: string) => stores.delete(name),
    corrupt(key: string) {
      for (const store of stores.values()) if (store.has(key)) store.set(key, new Response('tampered'));
    },
  } as unknown as CacheStorage & { corrupt(key: string): void };
}

export function testManifest(overrides: Partial<IeltsOfflineManifest> = {}): IeltsOfflineManifest {
  return {
    schemaVersion: 1,
    runtimeId: 'rt-1',
    scheduleId: 'sched-1',
    attemptId: 'att-1',
    publishedVersionId: 'ver-1',
    clientSessionId: 'cs-1',
    leaseEpoch: 1,
    controlEpoch: 3,
    recoveryRunGeneration: null,
    schedule: {
      schemaVersion: 1,
      scheduleRevision: 1,
      status: 'active',
      windows: [
        { sectionKey: 'listening', order: 0, startAt: '2026-10-30T03:00:00Z', deadlineAt: '2026-10-30T03:30:00Z', saveUntil: '2026-10-30T03:30:03Z' },
        { sectionKey: 'reading', order: 1, startAt: '2026-10-30T03:30:03Z', deadlineAt: '2026-10-30T04:30:03Z', saveUntil: '2026-10-30T04:30:06Z' },
      ],
    },
    serverNow: '2026-10-30T02:59:00Z',
    contentDigest: 'digest-1',
    media: [
      { resourceId: 'r-audio', kind: 'audio', partId: 'p1', mediaRevision: 'rev-a', url: '/media/a.mp3', sha256: null, bytes: null },
      { resourceId: 'r-image', kind: 'image', partId: null, mediaRevision: 'rev-i', url: 'https://cdn.example/i.png', sha256: null, bytes: null },
    ],
    ...overrides,
  };
}

export function okFetch(bodies: Record<string, string>, init: { type?: ResponseType } = {}): typeof fetch {
  return (async (url: RequestInfo | URL) => {
    const body = bodies[String(url)];
    if (body === undefined) return new Response('missing', { status: 404 });
    const response = new Response(body, { status: 200, headers: { 'content-type': 'application/octet-stream', 'content-length': String(body.length) } });
    if (init.type) Object.defineProperty(response, 'type', { value: init.type });
    return response;
  }) as typeof fetch;
}
