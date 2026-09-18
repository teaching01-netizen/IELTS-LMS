// Student runtime poll loop (plan C1): the student RECOVERY channel. One tick =
// one versioned poll; a revision change triggers exactly one refresh; 304 =
// steady, no work.
//
// Phase 6: this loop is the single owner of poll TIMING — current revision,
// next delay, backoff, and the server's pollAfterSecs. It used to compute a
// delay and hand it to a `schedule` callback nobody implemented, while
// useAsyncPolling owned a second, independent timer (a static client policy).
// Two owners meant the server's adaptive cadence was computed and discarded, so
// the documented "server controls the cadence" was not true. The loop now
// returns the delay through nextDelayMs(); the React timer asks for it after
// every run instead of deciding for itself.
//
// The `cadence` resolver is the one thing the loop does not own: how tight the
// transport should be depends on whether the live socket is connected, which
// the realtime coordinator tracks. It supplies bounds; the loop clamps the
// server's value into them, so a server fast-lane can never be slower than the
// transport's needs and a shared steady cadence can never be faster than its
// bounds.
import type { StudentRuntimePollView } from './studentRuntimePoll';

/** Transport cadence bounds in ms (floor = tightest, ceiling = laziest). */
export interface StudentRuntimePollCadence {
  readonly floorMs: number;
  readonly ceilingMs: number;
}

export const DEFAULT_STUDENT_POLL_CADENCE: StudentRuntimePollCadence = {
  floorMs: 2_000,
  ceilingMs: 25_000,
};

export function clampStudentPollDelay(ms: number, cadence: StudentRuntimePollCadence): number {
  const floor = Math.max(1_000, cadence.floorMs);
  const ceiling = Math.max(floor, cadence.ceilingMs);
  if (!Number.isFinite(ms)) {
    return ceiling;
  }
  return Math.min(ceiling, Math.max(floor, ms));
}

export interface StudentRuntimePollLoopInput {
  readonly poll: (sinceRevision: number) => Promise<StudentRuntimePollView>;
  readonly sinceRevision: number;
  readonly onRevision: (revision: number) => void;
  /** Transport bounds; omitted = DEFAULT_STUDENT_POLL_CADENCE. */
  readonly cadence?: () => StudentRuntimePollCadence;
}

export interface StudentRuntimePollLoop {
  tick(): Promise<StudentRuntimePollView>;
  nextDelayMs(): number;
  stopped(): boolean;
}

export function createStudentRuntimePollLoop(input: StudentRuntimePollLoopInput): StudentRuntimePollLoop {
  let since = input.sinceRevision;
  let failures = 0;
  let delayMs = 25_000;
  let isStopped = false;

  const cadence = () => input.cadence?.() ?? DEFAULT_STUDENT_POLL_CADENCE;

  return {
    async tick(): Promise<StudentRuntimePollView> {
      if (isStopped) {
        throw new Error('Runtime poll loop is stopped.');
      }
      let view: StudentRuntimePollView;
      try {
        view = await input.poll(since);
      } catch (error) {
        if (error && typeof error === 'object' && (error as { terminal?: boolean }).terminal === true) {
          // Retired surface (410): never retry-storm it.
          isStopped = true;
          throw error;
        }
        // A transport failure backs the window off so an outage does not
        // become a retry storm; the next successful tick resets it.
        failures += 1;
        const bounds = cadence();
        delayMs = clampStudentPollDelay(bounds.floorMs * 2 ** Math.min(failures, 4), bounds);
        throw error;
      }
      failures = 0;
      const bounds = cadence();
      const serverDelayMs = Math.max(1_000, view.pollAfterSecs * 1_000);
      delayMs = clampStudentPollDelay(serverDelayMs, bounds);
      if (!view.notModified && view.revision !== since) {
        since = view.revision;
        input.onRevision(view.revision);
      }
      return view;
    },
    nextDelayMs(): number {
      return delayMs;
    },
    stopped(): boolean {
      return isStopped;
    },
  };
}
