// Student runtime poll loop (plan C1): the student live channel that replaces
// sockets. One tick = one versioned poll; revision change triggers exactly
// one refresh; pollAfterSecs from the server sets the next delay (adaptive
// cadence: 2s fast-lane post-command, 25s steady). Terminal errors (410)
// stop the loop — never retry-storm a retired surface.
import type { StudentRuntimePollView } from './studentRuntimePoll';

export interface StudentRuntimePollLoopInput {
  readonly poll: (sinceRevision: number) => Promise<StudentRuntimePollView>;
  readonly sinceRevision: number;
  readonly onRevision: (revision: number) => void;
  readonly schedule: (delayMs: number) => void;
}

export interface StudentRuntimePollLoop {
  tick(): Promise<StudentRuntimePollView>;
  nextDelayMs(): number;
  stopped(): boolean;
}

export function createStudentRuntimePollLoop(input: StudentRuntimePollLoopInput): StudentRuntimePollLoop {
  let since = input.sinceRevision;
  let delayMs = 25_000;
  let isStopped = false;

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
          isStopped = true;
        }
        throw error;
      }
      delayMs = Math.max(1_000, view.pollAfterSecs * 1_000);
      input.schedule(delayMs);
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
