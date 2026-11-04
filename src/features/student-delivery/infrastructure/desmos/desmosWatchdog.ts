import type { DesmosCalculatorMode } from "./desmosTypes";

/** Terminal per-mode load outcome for one Desmos embed frame. */
export type DesmosLoadOutcome = "ready" | "timeout" | "blocked" | "error";

/** Live per-mode status rendered by DesmosCalculator (loading is transient). */
export type DesmosModeStatus = "loading" | DesmosLoadOutcome;

/** Burst-budget default: a Math-open student sees calculator or error ≤15s. */
export const DESMOS_WATCHDOG_MS = 14_000;

/** User-click retries per mode before the Retry control locks (no reload herd). */
export const DESMOS_MAX_RETRIES = 3;

/**
 * Elapsed-time heuristic separating a fast embed failure (CSP frame-src /
 * network block — the iframe errors almost immediately) from a slow stall
 * (timeout via the watchdog). Documented heuristic, not a probe: the
 * classification only changes the reported outcome + runbook hint, never
 * whether the student can keep answering.
 */
export const DESMOS_FAST_ERROR_MS = 1_500;

export interface DesmosWatchdogInput {
  mode: DesmosCalculatorMode;
  /** Epoch ms the current frame (mount or retry remount) started. */
  mountAt?: number;
  /** Watchdog budget; defaults to DESMOS_WATCHDOG_MS (14s burst bound). */
  timeoutMs?: number;
  onFired: (fired: { mode: DesmosCalculatorMode; elapsedMs: number }) => void;
}

/**
 * One-shot per-mode watchdog: fires `timeout` once when the mode has not
 * reported onLoad within budget. Returns a cancel invoked on ready/unmount/
 * retry-remount. Timer only — the caller owns status + beacon.
 */
export function startDesmosWatchdog({
  mode,
  mountAt = Date.now(),
  timeoutMs = DESMOS_WATCHDOG_MS,
  onFired,
}: DesmosWatchdogInput): () => void {
  const remaining = Math.max(0, mountAt + timeoutMs - Date.now());
  const timer = window.setTimeout(() => {
    onFired({ mode, elapsedMs: Date.now() - mountAt });
  }, remaining);
  return () => window.clearTimeout(timer);
}

export interface DesmosOutcomeClassificationInput {
  /** True only when the frame's onLoad fired for this mount. */
  loaded: boolean;
  /** Epoch-ms delta for this mount (Date.now() - mountAt). */
  elapsedMs: number;
  /** Explicit block signal (e.g. CSP probe); forces `blocked`. */
  cspBlocked?: boolean;
}

/**
 * Classify a terminal frame signal. Watchdog expiry is classified by the
 * caller as `timeout` directly; this covers the onLoad/onError paths:
 * loaded → ready, explicit block or fast error → blocked, else error.
 */
export function classifyDesmosOutcome({
  loaded,
  elapsedMs,
  cspBlocked = false,
}: DesmosOutcomeClassificationInput): DesmosLoadOutcome {
  if (loaded) return "ready";
  if (cspBlocked || elapsedMs <= DESMOS_FAST_ERROR_MS) return "blocked";
  return "error";
}
