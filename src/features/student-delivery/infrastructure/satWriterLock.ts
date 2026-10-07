/**
 * One cooperative writer per browser for a SAT attempt (Web Locks).
 *
 * Tabs of one browser share the same writer identity and local outbox, so the
 * server cannot tell them apart. An exclusive per-attempt lock makes exactly
 * one tab the writer: a second tab is refused immediately (ifAvailable) and
 * never silently starts writing later. Web Locks coordinate one origin in one
 * browser only — cross-device ownership stays with the server.
 *
 * Unavailable Web Locks (insecure context or unsupported browser) is reported
 * as `unsupported`: shared storage is never treated as proof of exclusivity.
 */
export type SatWriterLockResult =
  | { status: "acquired"; release: () => void }
  | { status: "held" }
  | { status: "unsupported" };

/** A just-released lock (reload, remount) frees asynchronously; re-check once. */
const HELD_RECHECK_MS = 300;

export async function acquireSatWriterLock(scheduleId: string, attemptId: string): Promise<SatWriterLockResult> {
  const locks = typeof navigator === "undefined" ? undefined : navigator.locks;
  if (!locks || typeof locks.request !== "function") {
    return { status: "unsupported" };
  }
  const attempt = () =>
    new Promise<SatWriterLockResult>((resolve) => {
      let release: () => void = () => undefined;
      const held = new Promise<void>((done) => {
        release = done;
      });
      locks
        .request(`sat-writer:v1:${scheduleId}:${attemptId}`, { mode: "exclusive", ifAvailable: true }, async (lock) => {
          if (!lock) {
            resolve({ status: "held" });
            return;
          }
          resolve({ status: "acquired", release });
          // Held until the owning page releases it (unmount) or exits.
          await held;
        })
        .catch(() => resolve({ status: "unsupported" }));
    });
  const first = await attempt();
  if (first.status !== "held") return first;
  await new Promise((done) => setTimeout(done, HELD_RECHECK_MS));
  return attempt();
}
