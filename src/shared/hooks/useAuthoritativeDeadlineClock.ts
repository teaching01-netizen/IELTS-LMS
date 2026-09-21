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
 * The room's `now` in ms: the shared tick plus the same server-vs-device
 * correction every countdown uses. A surface that has to show several windows at
 * once (the staff run sheet, whose section, module and break rows all count down
 * together) reads this and derives each row from the one instant, instead of
 * pairing one deadline per hook call.
 */
export function useServerClockNowMs(
  serverNow?: string | null,
  options?: { coarse?: boolean }
): number {
  const subscribe = options?.coarse ? subscribeCoarseClock : subscribePreciseClock;
  const getNow = options?.coarse ? getCoarseNow : getPreciseNow;
  const nowMs = useSyncExternalStore(subscribe, getNow, getNow);
  const clockOffsetMs = useMemo(() => {
    if (!serverNow) return 0;
    const serverNowMs = Date.parse(serverNow);
    return Number.isFinite(serverNowMs) ? serverNowMs - Date.now() : 0;
  }, [serverNow]);
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
  fallbackSeconds: number;
  running: boolean;
  /**
   * Opt a far-from-deadline surface into the 15s coarse tick. Urgent
   * surfaces (headers, detail views, sub-5-minute rows) omit it and stay
   * on the 1s precise clock.
   */
  coarse?: boolean;
}) {
  const subscribe = options.coarse ? subscribeCoarseClock : subscribePreciseClock;
  const getNow = options.coarse ? getCoarseNow : getPreciseNow;
  const nowMs = useSyncExternalStore(subscribe, getNow, getNow);
  const clockOffsetMs = useMemo(() => {
    if (!options.serverNow) return 0;
    const serverNowMs = Date.parse(options.serverNow);
    return Number.isFinite(serverNowMs) ? serverNowMs - Date.now() : 0;
  }, [options.serverNow]);
  return resolveAuthoritativeRemainingSeconds({
    deadlineAt: options.deadlineAt ?? null,
    fallbackSeconds: options.fallbackSeconds,
    running: options.running,
    nowMs,
    clockOffsetMs,
  });
}
