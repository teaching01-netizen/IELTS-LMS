import type {
  StudentPlatformEvent,
  StudentPlatformMonitor,
} from '../../../contracts/exam-session/StudentPlatformMonitor';

export interface BrowserKeyboardGuardOptions {
  readonly isForbidden?: (event: KeyboardEvent) => boolean;
}

function nowIso(): string {
  return new Date().toISOString();
}

export function createBrowserKeyboardGuard(
  options: BrowserKeyboardGuardOptions = {},
): StudentPlatformMonitor {
  const isForbidden = options.isForbidden ?? ((event: KeyboardEvent) => event.key === 'PrintScreen');

  return {
    subscribe(listener) {
      if (typeof document === 'undefined') {
        return () => undefined;
      }

      const handleKeyDown = (event: KeyboardEvent) => {
        if (!isForbidden(event)) {
          return;
        }
        const platformEvent: StudentPlatformEvent = {
          type: 'FORBIDDEN_SHORTCUT',
          timestamp: nowIso(),
          detail: event.key,
        };
        listener(platformEvent);
      };

      document.addEventListener('keydown', handleKeyDown, true);
      return () => document.removeEventListener('keydown', handleKeyDown, true);
    },
  };
}
