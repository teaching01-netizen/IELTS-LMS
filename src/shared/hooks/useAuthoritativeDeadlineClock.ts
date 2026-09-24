import { useMemo, useSyncExternalStore } from 'react';

/**
 * Two shared clocks: precise (1s) for urgent surfaces (stage header, detail
 * view, sub-5-minute rows) and coarse (15s) for idle roster rows. Both
 * clocks share one subscriber set each, so a 300-row room costs ~20
 * renders/sec at rest instead of 300. Server-authoritative math below is
 * untouched — only the tick cadence adapts.
 */
export const COARSE_CLOCK_MS = 15_000;
export const URGENT_THRESHOLD_SECONDS = 300;

type ClockBand = 'precise' | 'coarse';

const clockState: Record<ClockBand, { nowMs: number; timer: number | null; subscribers: Set<() => void>; intervalMs: number }> = {
  precise: { nowMs: Date.now(), timer: null, subscribers: new Set(), intervalMs: 1_000 },
  coarse: { nowMs: Date.now(), timer: null, subscribers: new Set(), intervalMs: COARSE_CLOCK_MS },
};

function startSharedClock(band: ClockBand) {
  const state = clockState[band];
  if (state.timer !== null || typeof window === 'undefined') return;
  state.nowMs = Date.now();
  state.timer = window.setInterval(() => {
    state.nowMs = Date.now();
    for (const subscriber of state.subscribers) subscriber();
  }, state.intervalMs);
}

function stopSharedClock(band: ClockBand) {
  const state = clockState[band];
  if (state.timer === null || state.subscribers.size > 0 || typeof window === 'undefined') return;
  window.clearInterval(state.timer);
  state.timer = null;
}

function subscribeToBand(band: ClockBand) {
  return (subscriber: () => void) => {
    clockState[band].subscribers.add(subscriber);
    startSharedClock(band);
    return () => {
      clockState[band].subscribers.delete(subscriber);
      stopSharedClock(band);
    };
  };
}

const subscribePreciseClock = subscribeToBand('precise');
const subscribeCoarseClock = subscribeToBand('coarse');

function getPreciseNow() {
  return clockState.precise.nowMs;
}

function getCoarseNow() {
  return clockState.coarse.nowMs;
}

// Back-compat aliases for existing precise subscribers.
const subscribers = clockState.precise.subscribers;
function subscribeSharedClock(subscriber: () => void) {
  return subscribePreciseClock(subscriber);
}
function getSharedNow() {
  return getPreciseNow();
}
void subscribers;
void subscribeSharedClock;
void getSharedNow;

/**
 * One accepted server instant: the `serverNow` a payload carried and the local
 * instant THAT payload was received. The pair is the whole correction —
 * `serverNow - receivedAt` — so a cached, slow or re-rendered payload cannot be
 * read as "the server is six seconds behind".
 */
export interface ServerClockSnapshot {
  serverNow: string | null;
  /** `Date.now()` when this `serverNow` landed; 0 when it has never landed. */
  receivedAt: number;
}

/**
 * Server-vs-device skew for one accepted snapshot. Pairing a `serverNow` with
 * the instant its own payload was received is the student app's rule
 * (`satClockOffsetMs`); pairing it with "now at render" turns the gap between
 * two reads into visible skew, which is how two windows on one screen ended up
 * counting the same deadline seconds apart.
 *
 * A snapshot with no receipt instant contributes no correction rather than a
 * made-up one: an uncorrected clock is a smaller lie than a guessed skew.
 */
export function resolveServerClockOffsetMs(
  snapshot: ServerClockSnapshot | null | undefined,
  fallbackNowMs: number
): number {
  if (!snapshot || !snapshot.serverNow) return 0;
  const serverNowMs = Date.parse(snapshot.serverNow);
  if (!Number.isFinite(serverNowMs)) return 0;
  const receivedAt = Number.isFinite(snapshot.receivedAt) && snapshot.receivedAt > 0
    ? snapshot.receivedAt
    : fallbackNowMs;
  return serverNowMs - receivedAt;
}

/**
 * The room's verified clock when one has been accepted, otherwise the fallback
 * a surface can still see (`runtime.serverNow`) with an unknown receipt. An
 * unknown receipt keeps the old render-anchored approximation rather than
 * dropping the correction altogether, so a projection that arrives outside the
 * accepted-clock path still lands on the server's instant.
 */
export function resolveRoomClock(
  accepted: ServerClockSnapshot | null | undefined,
  fallbackServerNow?: string | null
): ServerClockSnapshot | null {
  if (accepted?.serverNow) return accepted;
  if (fallbackServerNow) return { serverNow: fallbackServerNow, receivedAt: 0 };
  return accepted ?? null;
}

/**
 * The room's clock: one corrected instant every countdown on a page reads, so
 * the hero clock, the run sheet, each roster row and the inspector cannot
 * disagree about "now". A surface that has to show several windows at once (the
 * staff run sheet, whose section, module and break rows all count down together)
 * reads this once and derives each row from that one instant instead of pairing
 * one deadline per hook call; a surface showing a single window hands this to
 * `useAuthoritativeDeadlineClock` as `roomClock` rather than its own
 * `serverNow`.
 */
export function useRoomClockMs(
  clock?: ServerClockSnapshot | null,
  options?: { coarse?: boolean }
): number {
  const subscribe = options?.coarse ? subscribeCoarseClock : subscribePreciseClock;
  const getNow = options?.coarse ? getCoarseNow : getPreciseNow;
  const nowMs = useSyncExternalStore(subscribe, getNow, getNow);
  // Read the accepted instant as primitives: the correction only moves when the
  // accepted server instant does, not when a caller hands over a new object.
  const acceptedServerNow = clock?.serverNow ?? null;
  const acceptedReceivedAt = clock?.receivedAt ?? 0;
  const clockOffsetMs = useMemo(
    () =>
      resolveServerClockOffsetMs(
        { serverNow: acceptedServerNow, receivedAt: acceptedReceivedAt },
        Date.now(),
      ),
    [acceptedServerNow, acceptedReceivedAt],
  );
  return nowMs + clockOffsetMs;
}

export function resolveAuthoritativeRemainingSeconds(options: {
  deadlineAt?: string | null;
  clockOffsetMs: number;
  fallbackSeconds: number;
  running: boolean;
  nowMs: number;
}): number {
  const fallback = Math.max(0, Math.floor(options.fallbackSeconds));
  if (!options.running || !options.deadlineAt) return fallback;
  const deadlineMs = Date.parse(options.deadlineAt);
  if (!Number.isFinite(deadlineMs) || !Number.isFinite(options.clockOffsetMs)) return fallback;
  const adjustedNowMs = options.nowMs + options.clockOffsetMs;
  return Math.max(0, Math.ceil((deadlineMs - adjustedNowMs) / 1_000));
}

export function useAuthoritativeDeadlineClock(options: {
  deadlineAt?: string | null;
  serverNow?: string | null;
  /**
   * Receipt instant of the payload that carried `serverNow`. Supplying it makes
   * the correction receipt-anchored instead of render-anchored; a caller that
   * has no stamp keeps the previous approximation.
   */
  serverNowReceivedAt?: number | null;
  fallbackSeconds: number;
  running: boolean;
  /**
   * Opt a far-from-deadline surface into the 15s coarse tick. Urgent
   * surfaces (headers, detail views, sub-5-minute rows) omit it and stay
   * on the 1s precise clock.
   */
  coarse?: boolean;
  /**
   * The room's clock. When given, the countdown is read against that single
   * corrected instant instead of computing a correction of its own, so every
   * window on the page advances together.
   */
  roomClock?: ServerClockSnapshot | null | undefined;
}) {
  const subscribe = options.coarse ? subscribeCoarseClock : subscribePreciseClock;
  const getNow = options.coarse ? getCoarseNow : getPreciseNow;
  const nowMs = useSyncExternalStore(subscribe, getNow, getNow);
  const roomServerNow = options.roomClock?.serverNow ?? null;
  const roomReceivedAt = options.roomClock?.receivedAt ?? 0;
  const surfaceServerNow = options.serverNow ?? null;
  const surfaceReceivedAt = options.serverNowReceivedAt ?? null;
  const clockOffsetMs = useMemo(() => {
    // One room clock wins when the page has one; otherwise the surface still
    // corrects, anchored on its own payload's receipt when it knows it.
    if (roomServerNow) {
      return resolveServerClockOffsetMs(
        { serverNow: roomServerNow, receivedAt: roomReceivedAt },
        Date.now(),
      );
    }
    if (!surfaceServerNow) return 0;
    const serverNowMs = Date.parse(surfaceServerNow);
    if (!Number.isFinite(serverNowMs)) return 0;
    const receivedAt = surfaceReceivedAt && surfaceReceivedAt > 0
      ? surfaceReceivedAt
      : Date.now();
    return serverNowMs - receivedAt;
  }, [roomServerNow, roomReceivedAt, surfaceServerNow, surfaceReceivedAt]);
  return resolveAuthoritativeRemainingSeconds({
    deadlineAt: options.deadlineAt ?? null,
    fallbackSeconds: options.fallbackSeconds,
    running: options.running,
    nowMs,
    clockOffsetMs,
  });
}
