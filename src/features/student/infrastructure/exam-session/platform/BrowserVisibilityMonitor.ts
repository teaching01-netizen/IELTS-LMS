import type {
  StudentPlatformEvent,
  StudentPlatformMonitor,
} from '../../../contracts/exam-session/StudentPlatformMonitor';

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * The single browser boundary for Page Visibility.
 *
 * Deliberately dumb: it reports only what the browser establishes — the exam
 * document became hidden, or it became visible again. It knows nothing about
 * IELTS, ACT, SAT, students, warnings, or backend audits, so detection
 * semantics can live in one provider-neutral application rule
 * (`application/exam-session/examVisibilityIntegrity.ts`) instead of being
 * re-invented per delivery branch.
 *
 * `visibilitychange`/`document.visibilityState` is the supported primitive for
 * "the user switched tab/app" (it also fires on mobile when the student leaves
 * the browser or locks the device). `pagehide`/`beforeunload`/`unload` are not
 * used here: they are unreliable on mobile and are not evidence that the page
 * was hidden while the exam was still mounted.
 */
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

let sharedMonitor: StudentPlatformMonitor | null = null;

/**
 * One document listener for the whole app, fanned out to every subscriber.
 *
 * Both delivery branches (the IELTS/ACT proctoring provider and the SAT
 * integrity control) mount at once during a running exam and would otherwise
 * register competing `visibilitychange` listeners that can disagree about
 * ordering and dedupe. Sharing the browser subscription removes that class of
 * bug: the normalized events are identical, and only the provider-specific
 * reaction differs.
 */
export function sharedBrowserVisibilityMonitor(): StudentPlatformMonitor {
  if (!sharedMonitor) {
    sharedMonitor = createRefCountedBrowserVisibilityMonitor();
  }
  return sharedMonitor;
}

function createRefCountedBrowserVisibilityMonitor(): StudentPlatformMonitor {
  const listeners = new Set<(event: StudentPlatformEvent) => void>();
  let detach: (() => void) | null = null;

  return {
    subscribe(listener) {
      listeners.add(listener);
      if (!detach) {
        detach = createBrowserVisibilityMonitor().subscribe((event) => {
          // Copy: a listener may unsubscribe while it is being notified.
          for (const current of [...listeners]) {
            current(event);
          }
        });
      }

      return () => {
        listeners.delete(listener);
        if (listeners.size === 0 && detach) {
          detach();
          detach = null;
        }
      };
    },
  };
}
