import { useMemo, useSyncExternalStore } from 'react';

let sharedNowMs = Date.now();
let sharedTimer: number | null = null;
const subscribers = new Set<() => void>();

function startSharedClock() {
  if (sharedTimer !== null || typeof window === 'undefined') return;
  sharedNowMs = Date.now();
  sharedTimer = window.setInterval(() => {
    sharedNowMs = Date.now();
    for (const subscriber of subscribers) subscriber();
  }, 1_000);
}

function stopSharedClock() {
  if (sharedTimer === null || subscribers.size > 0 || typeof window === 'undefined') return;
  window.clearInterval(sharedTimer);
  sharedTimer = null;
}

function subscribeSharedClock(subscriber: () => void) {
  subscribers.add(subscriber);
  startSharedClock();
  return () => {
    subscribers.delete(subscriber);
    stopSharedClock();
  };
}

function getSharedNow() {
  return sharedNowMs;
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
}) {
  const nowMs = useSyncExternalStore(subscribeSharedClock, getSharedNow, getSharedNow);
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
