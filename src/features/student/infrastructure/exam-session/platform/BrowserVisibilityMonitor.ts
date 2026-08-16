import type {
  StudentPlatformEvent,
  StudentPlatformMonitor,
} from '../../../contracts/exam-session/StudentPlatformMonitor';

function nowIso(): string {
  return new Date().toISOString();
}

export function createBrowserVisibilityMonitor(): StudentPlatformMonitor {
  return {
    subscribe(listener) {
      if (typeof document === 'undefined') {
        return () => undefined;
      }

      const handleVisibilityChange = () => {
        const event: StudentPlatformEvent = {
          type: document.visibilityState === 'hidden' ? 'VISIBILITY_HIDDEN' : 'VISIBILITY_VISIBLE',
          timestamp: nowIso(),
        };
        listener(event);
      };

      document.addEventListener('visibilitychange', handleVisibilityChange);
      return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
    },
  };
}
