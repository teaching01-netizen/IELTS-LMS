import { useSyncExternalStore } from 'react';

function subscribeOnline(onChange: () => void): () => void {
  window.addEventListener('online', onChange);
  window.addEventListener('offline', onChange);
  return () => {
    window.removeEventListener('online', onChange);
    window.removeEventListener('offline', onChange);
  };
}

const readOnline = () => (typeof navigator === 'undefined' ? true : navigator.onLine === true);
const readOnlineOnServer = () => true;

/**
 * Browser connectivity as React state. `navigator.onLine` is advisory: a false
 * positive only costs one bounded retry. The server snapshot keeps SSR and
 * hydration deterministic (always online, then reconciled on the client).
 */
export function useBrowserOnline(): boolean {
  return useSyncExternalStore(subscribeOnline, readOnline, readOnlineOnServer);
}
