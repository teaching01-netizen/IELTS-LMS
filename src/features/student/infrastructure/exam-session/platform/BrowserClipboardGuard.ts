import type {
  StudentPlatformEvent,
  StudentPlatformMonitor,
} from '../../../contracts/exam-session/StudentPlatformMonitor';

function nowIso(): string {
  return new Date().toISOString();
}

export function createBrowserClipboardGuard(): StudentPlatformMonitor {
  return {
    subscribe(listener) {
      if (typeof document === 'undefined') {
        return () => undefined;
      }

      const handleClipboard = (event: ClipboardEvent) => {
        const platformEvent: StudentPlatformEvent = {
          type: 'CLIPBOARD_ATTEMPTED',
          timestamp: nowIso(),
          detail: event.type,
        };
        listener(platformEvent);
      };

      document.addEventListener('copy', handleClipboard, true);
      document.addEventListener('cut', handleClipboard, true);
      document.addEventListener('paste', handleClipboard, true);
      return () => {
        document.removeEventListener('copy', handleClipboard, true);
        document.removeEventListener('cut', handleClipboard, true);
        document.removeEventListener('paste', handleClipboard, true);
      };
    },
  };
}
