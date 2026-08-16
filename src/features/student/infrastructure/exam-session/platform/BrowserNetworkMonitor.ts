import type {
  StudentPlatformEvent,
  StudentPlatformMonitor,
} from '../../../contracts/exam-session/StudentPlatformMonitor';

function nowIso(): string {
  return new Date().toISOString();
}

export function createBrowserNetworkMonitor(): StudentPlatformMonitor {
  return {
    subscribe(listener) {
      if (typeof window === 'undefined') {
        return () => undefined;
      }

      const handleOnline = () => {
        const event: StudentPlatformEvent = { type: 'NETWORK_ONLINE', timestamp: nowIso() };
        listener(event);
      };
      const handleOffline = () => {
        const event: StudentPlatformEvent = { type: 'NETWORK_OFFLINE', timestamp: nowIso() };
        listener(event);
      };

      window.addEventListener('online', handleOnline);
      window.addEventListener('offline', handleOffline);
      return () => {
        window.removeEventListener('online', handleOnline);
        window.removeEventListener('offline', handleOffline);
      };
    },
  };
}
