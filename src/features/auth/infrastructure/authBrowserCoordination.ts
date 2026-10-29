/**
 * Browser-side coordination for credential changes across tabs.
 *
 * These primitives serialize cooperating tabs of this app only. The database
 * session row stays the authority: nothing here grants or proves access, and
 * no message or stored value carries a credential or a user object.
 */

export type LogoutScope = 'current' | 'all';

export interface LogoutIntent {
  v: 1;
  id: string;
  scope: LogoutScope;
  createdAt: string;
}

export type AuthBroadcast =
  | { type: 'logout'; id: string }
  | { type: 'credential-changed'; id: string };

const INTENT_KEY = 'ielts-auth:logout-intent:v1';
const NOTICE_KEY = 'ielts-auth:logout-all-unconfirmed:v1';
const BROADCAST_KEY = 'ielts-auth:broadcast:v1';
const CHANNEL_NAME = 'ielts-auth';
const LOCK_NAME = 'ielts-auth-mutation';

export function newOperationId(): string {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

function parseIntent(raw: string | null): LogoutIntent | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<LogoutIntent> | null;
    if (
      value &&
      value.v === 1 &&
      typeof value.id === 'string' &&
      (value.scope === 'current' || value.scope === 'all') &&
      typeof value.createdAt === 'string'
    ) {
      return value as LogoutIntent;
    }
  } catch {
    // A corrupt record is treated as absent; the server stays authoritative.
  }
  return null;
}

export function readLogoutIntent(unavailableFallback: LogoutIntent | null = null): LogoutIntent | null {
  try {
    const store = storage();
    return store ? parseIntent(store.getItem(INTENT_KEY)) : unavailableFallback;
  } catch {
    return unavailableFallback;
  }
}

/**
 * Persist a logout intent before any network call so a lost response or a
 * browser restart still finishes the logout before restoring the session.
 * `persisted: false` (private mode, quota) means the caller tracks it in memory.
 */
export function writeLogoutIntent(scope: LogoutScope): { intent: LogoutIntent; persisted: boolean } {
  const intent: LogoutIntent = { v: 1, id: newOperationId(), scope, createdAt: new Date().toISOString() };
  const store = storage();
  try {
    store?.setItem(INTENT_KEY, JSON.stringify(intent));
    return { intent, persisted: parseIntent(store?.getItem(INTENT_KEY) ?? null)?.id === intent.id };
  } catch {
    return { intent, persisted: false };
  }
}

/** Remove the intent only if it is still the one this operation created. */
export function clearLogoutIntent(id: string): boolean {
  const store = storage();
  try {
    const current = parseIntent(store?.getItem(INTENT_KEY) ?? null);
    if (!current || current.id !== id) return false;
    store?.removeItem(INTENT_KEY);
  } catch {
    return false;
  }
  return true;
}

/** "This browser is signed out; sign-out everywhere was not confirmed." */
export function readLogoutAllUnconfirmed(): boolean {
  try {
    return storage()?.getItem(NOTICE_KEY) === '1';
  } catch {
    return false;
  }
}

export function setLogoutAllUnconfirmed(value: boolean): void {
  try {
    if (value) storage()?.setItem(NOTICE_KEY, '1');
    else storage()?.removeItem(NOTICE_KEY);
  } catch {
    // Notice is advisory only.
  }
}

export function supportsAuthMutationLock(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.locks?.request === 'function';
}

let inTabQueue: Promise<unknown> = Promise.resolve();

/**
 * Serialize credential-changing operations (login, reauth, reset, activation,
 * logout) across cooperating tabs with Web Locks. Without Web Locks this falls
 * back to an in-tab queue; callers must not claim cross-tab serialization then.
 */
export function withAuthMutationLock<T>(operation: () => Promise<T>): Promise<T> {
  if (supportsAuthMutationLock()) {
    return navigator.locks.request(LOCK_NAME, { mode: 'exclusive' }, operation) as Promise<T>;
  }
  const run = inTabQueue.then(operation, operation);
  inTabQueue = run.catch(() => undefined);
  return run;
}

const TAB_ID = newOperationId();

/**
 * Publish an invalidation to other tabs. Uses BroadcastChannel, with a
 * storage-event fallback. Own messages are ignored by subscribers.
 */
export function publishAuthEvent(event: AuthBroadcast): void {
  const message = { ...event, tab: TAB_ID };
  if (typeof BroadcastChannel !== 'undefined') {
    try {
      const channel = new BroadcastChannel(CHANNEL_NAME);
      channel.postMessage(message);
      channel.close();
      return;
    } catch {
      // Fall through to storage events.
    }
  }
  try {
    storage()?.setItem(BROADCAST_KEY, JSON.stringify({ ...message, at: Date.now() }));
  } catch {
    // Other tabs reconcile on focus/visibility instead.
  }
}

function parseBroadcast(value: unknown): AuthBroadcast | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (record['tab'] === TAB_ID || typeof record['id'] !== 'string') return null;
  if (record['type'] === 'logout' || record['type'] === 'credential-changed') {
    return { type: record['type'], id: record['id'] };
  }
  return null;
}

export function subscribeAuthEvents(handler: (event: AuthBroadcast) => void): () => void {
  const cleanups: Array<() => void> = [];
  if (typeof BroadcastChannel !== 'undefined') {
    try {
      const channel = new BroadcastChannel(CHANNEL_NAME);
      channel.onmessage = (message: MessageEvent) => {
        const event = parseBroadcast(message.data);
        if (event) handler(event);
      };
      cleanups.push(() => channel.close());
    } catch {
      // Storage events below still deliver.
    }
  }
  if (typeof window !== 'undefined') {
    const onStorage = (event: StorageEvent) => {
      if (event.key === INTENT_KEY && event.newValue) {
        const intent = parseIntent(event.newValue);
        if (intent) handler({ type: 'logout', id: intent.id });
        return;
      }
      if (event.key !== BROADCAST_KEY || !event.newValue) return;
      try {
        const parsed = parseBroadcast(JSON.parse(event.newValue));
        if (parsed) handler(parsed);
      } catch {
        // Ignore malformed values.
      }
    };
    window.addEventListener('storage', onStorage);
    cleanups.push(() => window.removeEventListener('storage', onStorage));
  }
  return () => cleanups.forEach((cleanup) => cleanup());
}
