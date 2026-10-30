/**
 * Client of public/ielts-offline-sw.js. The page identifies its own build by
 * this module's hashed chunk path, so it can never be told "prepared" for a
 * different deployment's shell.
 */

const SW_URL = '/ielts-offline-sw.js';
const REPLY_TIMEOUT_MS = 60_000;

export type IeltsShellResult = { ok: true; buildId: string } | { ok: false; reason: 'unsupported' | 'shell_unavailable' };

function ownAssetPath(): string | null {
  try {
    const path = new URL(import.meta.url).pathname;
    // Development serves source modules, not a build asset: no offline shell.
    return path.startsWith('/assets/') ? path : null;
  } catch {
    return null;
  }
}

async function activeWorker(): Promise<ServiceWorker | null> {
  const container = globalThis.navigator?.serviceWorker;
  if (!container) return null;
  await container.register(SW_URL, { scope: '/' });
  const registration = await container.ready;
  return registration.active;
}

function ask<T>(worker: ServiceWorker, message: Record<string, unknown>): Promise<T> {
  return new Promise((resolve, reject) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => reject(new Error('shell worker did not reply')), REPLY_TIMEOUT_MS);
    channel.port1.onmessage = (event) => {
      clearTimeout(timer);
      resolve(event.data as T);
    };
    worker.postMessage(message, [channel.port2]);
  });
}

/** Installs (if needed) and verifies the complete shell of the running build. */
export async function ensureIeltsOfflineShell(): Promise<IeltsShellResult> {
  const assetPath = ownAssetPath();
  if (!assetPath || typeof MessageChannel === 'undefined') return { ok: false, reason: 'unsupported' };
  try {
    const worker = await activeWorker();
    if (!worker) return { ok: false, reason: 'unsupported' };
    const reply = await ask<{ ok: boolean; buildId?: string }>(worker, { type: 'verify', assetPath });
    return reply.ok && reply.buildId ? { ok: true, buildId: reply.buildId } : { ok: false, reason: 'shell_unavailable' };
  } catch {
    return { ok: false, reason: 'shell_unavailable' };
  }
}

/** Keeps the build an exam started on until that exam is server-confirmed. */
export async function pinIeltsOfflineShell(buildId: string, attemptId: string): Promise<void> {
  const worker = await activeWorker().catch(() => null);
  if (worker) await ask(worker, { type: 'pin', buildId, attemptId }).catch(() => undefined);
}

export async function unpinIeltsOfflineShell(attemptId: string): Promise<void> {
  const worker = await activeWorker().catch(() => null);
  if (worker) await ask(worker, { type: 'unpin', attemptId }).catch(() => undefined);
}
