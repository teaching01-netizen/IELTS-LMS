import { useCallback, useEffect, useRef, useState } from "react";
import type {
  DesmosCalculatorMode,
  DesmosLocale,
} from "../../infrastructure/desmos/desmosTypes";
import { SAT_EXAM_LOCALE, desmosEmbedUrl } from "../../infrastructure/desmos/desmosTypes";
import {
  classifyDesmosOutcome,
  DESMOS_MAX_RETRIES,
  DESMOS_WATCHDOG_MS,
  startDesmosWatchdog,
  type DesmosLoadOutcome,
  type DesmosModeStatus,
} from "../../infrastructure/desmos/desmosWatchdog";
import { useSatExamZoom } from "../zoom/SatExamZoomContext";

export interface DesmosOutcomeEvent {
  mode: DesmosCalculatorMode;
  outcome: DesmosLoadOutcome;
  durationMs: number;
  retryCount: number;
}

export interface DesmosCalculatorProps {
  mode: DesmosCalculatorMode;
  /**
   * Exam locale for the embed. Defaults to SAT_EXAM_LOCALE (frozen English)
   * so the calculator follows the exam shell — never navigator.language.
   * Both prewarmed frames share this value so reveal never reloads.
   */
  locale?: DesmosLocale | undefined;
  disabled?: boolean;
  prewarmInactiveModes?: boolean;
  /**
   * Phase 01 aria contract: set when this tree is hidden (tool closed or
   * keepAlive prewarm). Strips live-region roles; visible output unchanged.
   */
  silenceLiveRegions?: boolean | undefined;
  /**
   * Burst bound per mode: without onLoad in this window the frame resolves
   * to timeout + error UI + Retry (the exam never blocks). Defaults to
   * DESMOS_WATCHDOG_MS (14s).
   */
  watchdogMs?: number | undefined;
  /**
   * Lazy second mode (burst plan CF-2): the inactive mode mounts only when
   * the parent allows prewarm AND signals eagerInactive (active ready,
   * hover/focus intent, or idle budget elapsed). Permission without timing
   * keeps a single document per student during the burst minute.
   */
  eagerInactive?: boolean | undefined;
  /** Beacon for the Math-window board: ready/timeout/blocked/error per mode. */
  onDesmosOutcome?: ((event: DesmosOutcomeEvent) => void) | undefined;
}

const DESMOS_MODES = ["scientific", "graphing"] as const;

type ModeRecord<T> = Record<DesmosCalculatorMode, T>;

const INITIAL_STATUS: ModeRecord<DesmosModeStatus> = {
  scientific: "loading",
  graphing: "loading",
};

const INITIAL_RETRIES: ModeRecord<number> = { scientific: 0, graphing: 0 };

function desmosErrorHint(status: DesmosModeStatus): string {
  switch (status) {
    case "blocked":
      return "The calculator is blocked on this network. Your answers are safe — ask for the allowlisted connection, or retry.";
    case "timeout":
      return "The calculator is taking too long to load. Your answers are safe — retry without reloading the page.";
    default:
      return "The calculator failed to load. Your answers are safe — retry without reloading the page.";
  }
}

/**
 * TRACK-A-01: distinguish a real Desmos commit from a fast-failure error
 * document. Only flags KNOWN error URLs (chrome-error, neterror, blocked):
 * plain about:blank / test-origin hrefs (jsdom, pre-commit) are NOT errors,
 * so synthetic unit-test loads keep passing. A real Desmos commit is
 * cross-origin (access throws) → not an error.
 */
function isKnownDesmosErrorDocument(node: HTMLIFrameElement | null): boolean {
  if (!node) return false;
  try {
    const href = node.contentWindow?.location?.href;
    if (typeof href !== "string" || href.length === 0) return false;
    return (
      href.startsWith("chrome-error://") ||
      href.startsWith("edge-error://") ||
      href.startsWith("about:neterror") ||
      href.startsWith("about:blocked") ||
      href.includes("chromewebdata") ||
      href.includes("neterror")
    );
  } catch {
    return false;
  }
}

/**
 * Desmos-origin HTTP failures (e.g. shed 503s that still commit a document)
 * are cross-origin unreadable, so the href probe cannot see them. When the
 * browser exposes Resource Timing `responseStatus` (requires
 * Timing-Allow-Origin on the response), a >=400 status proves failure.
 * Returns null when unknown (jsdom, no TAO, unsupported) → caller trusts
 * the load event and the watchdog stays the backstop.
 */
function desmosFailedHttpStatus(src: string): number | null {
  try {
    const entries = performance.getEntriesByName(src) as Array<
      PerformanceResourceTiming & { responseStatus?: unknown }
    >;
    for (let i = entries.length - 1; i >= 0; i--) {
      const status = entries[i]?.responseStatus;
      if (typeof status === "number" && status !== 0) return status;
    }
    return null;
  } catch {
    return null;
  }
}

export function DesmosCalculator({
  mode,
  locale = SAT_EXAM_LOCALE,
  disabled = false,
  prewarmInactiveModes = false,
  silenceLiveRegions = false,
  watchdogMs = DESMOS_WATCHDOG_MS,
  eagerInactive = false,
  onDesmosOutcome,
}: DesmosCalculatorProps) {
  const { scale } = useSatExamZoom();
  const [loadedModes, setLoadedModes] = useState<ReadonlySet<DesmosCalculatorMode>>(
    () => new Set()
  );
  const [mountedModes, setMountedModes] = useState<ReadonlySet<DesmosCalculatorMode>>(
    () => new Set([mode])
  );
  const [statusByMode, setStatusByMode] = useState<ModeRecord<DesmosModeStatus>>(
    () => ({ ...INITIAL_STATUS })
  );
  const [retrySeqByMode, setRetrySeqByMode] = useState<ModeRecord<number>>(
    () => ({ ...INITIAL_RETRIES })
  );
  const containerRef = useRef<HTMLDivElement>(null);
  const scientificRef = useRef<HTMLIFrameElement>(null);
  const graphingRef = useRef<HTMLIFrameElement>(null);
  const mountAtRef = useRef<ModeRecord<number | null>>({
    scientific: null,
    graphing: null,
  });

  // Live mirrors for async watchdog/error callbacks (avoid stale closures).
  const loadedRef = useRef(loadedModes);
  const statusRef = useRef(statusByMode);
  const retryRef = useRef(retrySeqByMode);
  const outcomeRef = useRef(onDesmosOutcome);
  // Terminal outcome already beaconed per (mode, retrySeq): exactly one
  // ready|timeout|blocked|error beacon per mount — retries re-arm it.
  const beaconedRef = useRef<ModeRecord<number>>({ scientific: -1, graphing: -1 });
  useEffect(() => {
    loadedRef.current = loadedModes;
    statusRef.current = statusByMode;
    retryRef.current = retrySeqByMode;
    outcomeRef.current = onDesmosOutcome;
  });

  const emitOutcome = useCallback(
    (
      candidate: DesmosCalculatorMode,
      outcome: DesmosLoadOutcome,
      durationMs: number,
    ) => {
      const seq = retryRef.current[candidate] ?? 0;
      if (beaconedRef.current[candidate] === seq) return;
      beaconedRef.current[candidate] = seq;
      outcomeRef.current?.({
        mode: candidate,
        outcome,
        durationMs,
        retryCount: seq,
      });
    },
    [],
  );

  useEffect(() => {
    setMountedModes((current) => {
      const next = new Set(current);
      next.add(mode);
      if (prewarmInactiveModes && eagerInactive) {
        DESMOS_MODES.forEach((candidate) => next.add(candidate));
      }
      return next.size === current.size ? current : next;
    });
  }, [mode, prewarmInactiveModes, eagerInactive]);

  // Stamp mount time for each newly mounted frame (watchdog + durationMs).
  useEffect(() => {
    mountedModes.forEach((candidate) => {
      if (mountAtRef.current[candidate] == null) {
        mountAtRef.current[candidate] = Date.now();
      }
    });
  }, [mountedModes]);

  // Per-mode watchdog: loading frames that never report onLoad resolve to
  // timeout (INV-010) — error UI + Retry, never an eternal spinner.
  useEffect(() => {
    const cancels: Array<() => void> = [];
    mountedModes.forEach((candidate) => {
      if (loadedRef.current.has(candidate)) return;
      if (statusRef.current[candidate] !== "loading") return;
      const mountAt = mountAtRef.current[candidate] ?? Date.now();
      cancels.push(
        startDesmosWatchdog({
          mode: candidate,
          mountAt,
          timeoutMs: watchdogMs,
          onFired: ({ elapsedMs }) => {
            setStatusByMode((current) =>
              current[candidate] === "loading"
                ? { ...current, [candidate]: "timeout" }
                : current,
            );
            // Terminal beacon for this mount (deduped per retrySeq); a
            // concurrent onError for the same mount loses harmlessly.
            emitOutcome(candidate, "timeout", elapsedMs);
          },
        }),
      );
    });
    return () => {
      cancels.forEach((cancel) => cancel());
    };
    // onDesmosOutcome flows through outcomeRef (parent identity churn safe).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mountedModes, loadedModes, statusByMode, retrySeqByMode, watchdogMs]);

  useEffect(() => {
    if (!disabled) return;
    const active = document.activeElement;
    if (active === scientificRef.current || active === graphingRef.current) {
      (active as HTMLIFrameElement).blur();
      containerRef.current?.focus({ preventScroll: true });
    }
  }, [disabled]);

  const handleFrameError = useCallback(
    (candidate: DesmosCalculatorMode) => {
      if (loadedRef.current.has(candidate)) return;
      if (statusRef.current[candidate] !== "loading") return;
      const elapsedMs = Date.now() - (mountAtRef.current[candidate] ?? Date.now());
      const outcome = classifyDesmosOutcome({ loaded: false, elapsedMs });
      setStatusByMode((current) =>
        current[candidate] === "loading" ? { ...current, [candidate]: outcome } : current,
      );
      emitOutcome(candidate, outcome, elapsedMs);
    },
    [emitOutcome],
  );

  const handleLoad = (candidate: DesmosCalculatorMode) => {
    // TRACK-A-01: fast-failure subframe navigations (abort/blockedbyclient)
    // commit an error document that still fires `load`. Known error URLs are
    // same-origin readable; a real Desmos commit is cross-origin (throws).
    const node =
      candidate === "scientific" ? scientificRef.current : graphingRef.current;
    if (isKnownDesmosErrorDocument(node)) {
      handleFrameError(candidate);
      return;
    }
    // Desmos-origin HTTP failures (shed 503s) commit cross-origin, so the
    // href probe cannot see them. A visible >=400 Resource Timing status
    // proves failure; null (jsdom / no TAO / unsupported) trusts the load.
    const failedStatus = node?.src ? desmosFailedHttpStatus(node.src) : null;
    if (failedStatus !== null && failedStatus >= 400) {
      handleFrameError(candidate);
      return;
    }
    // Error-wins per mount: once the watchdog/error path leaves `loading`,
    // a late `load` (error document or stale commit) must not resurrect ready.
    // Retry bumps retrySeq and re-arms `loading` for a fresh mount.
    if (statusRef.current[candidate] !== "loading") return;
    const durationMs = Date.now() - (mountAtRef.current[candidate] ?? Date.now());
    // Status is `loading` here (early return above); loaded-set membership is
    // the double-beacon guard (emitOutcome also dedupes per retrySeq).
    const alreadyReady = loadedRef.current.has(candidate);
    setLoadedModes((current) => {
      if (current.has(candidate)) return current;
      return new Set(current).add(candidate);
    });
    setStatusByMode((current) =>
      current[candidate] === "ready" ? current : { ...current, [candidate]: "ready" },
    );
    if (!alreadyReady) emitOutcome(candidate, "ready", durationMs);
  };

  // Native error listeners: React does not delegate iframe `error` events,
  // so the onError prop never fires (verified in jsdom + real browsers).
  // The watchdog timeout stays the primary stall detector; this path only
  // reclassifies fast, explicit frame failures (blocked vs error).
  useEffect(() => {
    const pairs = [
      { node: scientificRef.current, candidate: "scientific" as const },
      { node: graphingRef.current, candidate: "graphing" as const },
    ];
    const cleanups = pairs.flatMap(({ node, candidate }) => {
      if (!node) return [];
      const listener = () => handleFrameError(candidate);
      node.addEventListener("error", listener);
      return [() => node.removeEventListener("error", listener)];
    });
    return () => {
      cleanups.forEach((cleanup) => cleanup());
    };
  });

  const handleRetry = (candidate: DesmosCalculatorMode) => {
    if ((retryRef.current[candidate] ?? 0) >= DESMOS_MAX_RETRIES) return;
    mountAtRef.current[candidate] = Date.now();
    setLoadedModes((current) => {
      if (!current.has(candidate)) return current;
      const next = new Set(current);
      next.delete(candidate);
      return next;
    });
    setStatusByMode((current) => ({ ...current, [candidate]: "loading" }));
    setRetrySeqByMode((current) => ({
      ...current,
      [candidate]: (current[candidate] ?? 0) + 1,
    }));
  };

  const activeReady = loadedModes.has(mode);
  const bothModesReady = loadedModes.has("scientific") && loadedModes.has("graphing");
  const activeStatus = statusByMode[mode];
  const activeFailed =
    activeStatus === "timeout" || activeStatus === "blocked" || activeStatus === "error";
  const retryExhausted = (retrySeqByMode[mode] ?? 0) >= DESMOS_MAX_RETRIES;
  const showLoading = !activeReady && activeStatus === "loading";

  return (
    <div
      ref={containerRef}
      className="relative h-full min-h-0 w-full overflow-hidden bg-[var(--sat-surface)]"
      data-sat-trusted-tool="desmos"
      data-desmos-ready={activeReady ? "true" : "false"}
      data-desmos-both-modes-ready={bothModesReady ? "true" : "false"}
      data-desmos-status={activeStatus}
      {...(activeFailed ? { "data-desmos-error": `${mode}:${activeStatus}` } : {})}
      aria-label="Desmos calculator"
      aria-disabled={disabled || undefined}
      tabIndex={-1}
    >
      {DESMOS_MODES.map((candidate) => {
        // mountedModes is authoritative: the active mode plus any mode the
        // parent allowed (prewarm) and timed (eagerInactive) — or revealed
        // by a mode switch. Never render a deferred document.
        if (candidate !== mode && !mountedModes.has(candidate)) {
          return null;
        }
        return (
          <iframe
            ref={candidate === "scientific" ? scientificRef : graphingRef}
            key={`${candidate}:${retrySeqByMode[candidate] ?? 0}`}
            src={desmosEmbedUrl(candidate, locale)}
            title={`Desmos ${candidate} calculator, College Board testing version`}
            className={
              `absolute inset-0 h-full w-full border-0 ${candidate === mode ? "block" : "invisible"}`
            }
            aria-hidden={candidate !== mode || silenceLiveRegions || undefined}
            style={{ width: `${100 * scale}%`, height: `${100 * scale}%`, transform: `scale(${1 / scale})`, transformOrigin: "top left" }}
            loading={candidate === mode || (prewarmInactiveModes && eagerInactive) ? "eager" : "lazy"}
            referrerPolicy="strict-origin-when-cross-origin"
            tabIndex={disabled || candidate !== mode || silenceLiveRegions ? -1 : 0}
            inert={disabled || candidate !== mode || silenceLiveRegions}
            onLoad={() => handleLoad(candidate)}
            data-desmos-mode={candidate}
            data-desmos-mode-status={statusByMode[candidate]}
          />
        );
      })}
      {showLoading && !silenceLiveRegions ? (
        <div
          className="pointer-events-none absolute inset-0 grid place-items-center bg-[var(--sat-surface)]"
          role="status"
          aria-live="polite"
          data-desmos-loading
        >
          <div className="text-center">
            <div
              className="mx-auto mb-3 h-5 w-5 animate-spin rounded-full border-2 border-[var(--sat-divider-soft)] border-t-[var(--sat-text)] motion-reduce:animate-none"
              aria-hidden="true"
            />
            <p className="text-[14px] font-medium text-[var(--sat-text-secondary)]">
              Loading calculator…
            </p>
          </div>
        </div>
      ) : null}
      {showLoading && silenceLiveRegions ? (
        <div
          className="pointer-events-none absolute inset-0 grid place-items-center bg-[var(--sat-surface)]"
          aria-hidden="true"
          data-desmos-loading
        >
          <div className="text-center">
            <div
              className="mx-auto mb-3 h-5 w-5 animate-spin rounded-full border-2 border-[var(--sat-divider-soft)] border-t-[var(--sat-text)] motion-reduce:animate-none"
              aria-hidden="true"
            />
            <p className="text-[14px] font-medium text-[var(--sat-text-secondary)]">
              Loading calculator…
            </p>
          </div>
        </div>
      ) : null}
      {activeFailed && !silenceLiveRegions ? (
        <div
          className="absolute inset-0 z-20 grid place-items-center bg-[var(--sat-surface)]"
          role="alert"
          data-desmos-error-ui={`${mode}:${activeStatus}`}
        >
          <div className="max-w-xs px-6 text-center">
            <p className="text-[14px] font-semibold text-[var(--sat-text)]">
              Calculator unavailable
            </p>
            <p className="mt-1 text-[13px] leading-5 text-[var(--sat-text-secondary)]">
              {desmosErrorHint(activeStatus)}
            </p>
            <button
              type="button"
              onClick={() => handleRetry(mode)}
              disabled={retryExhausted}
              data-desmos-retry={mode}
              className="sat-touch-target sat-pressable mt-4 inline-flex items-center justify-center rounded-full border border-[var(--sat-divider)] bg-[var(--sat-surface)] px-5 text-[14px] font-semibold text-[var(--sat-text)] hover:bg-[var(--sat-surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-focus)] focus-visible:ring-offset-2 disabled:opacity-60"
            >
              {retryExhausted ? "Retry unavailable — keep answering" : "Retry calculator"}
            </button>
          </div>
        </div>
      ) : null}
      {activeFailed && silenceLiveRegions ? (
        <div
          className="absolute inset-0 z-20 grid place-items-center bg-[var(--sat-surface)]"
          aria-hidden="true"
          data-desmos-error-ui={`${mode}:${activeStatus}`}
        >
          <div className="max-w-xs px-6 text-center">
            <p className="text-[14px] font-semibold text-[var(--sat-text)]">
              Calculator unavailable
            </p>
            <button
              type="button"
              onClick={() => handleRetry(mode)}
              disabled={retryExhausted}
              data-desmos-retry={mode}
              tabIndex={-1}
            >
              {retryExhausted ? "Retry unavailable — keep answering" : "Retry calculator"}
            </button>
          </div>
        </div>
      ) : null}
      {disabled && !silenceLiveRegions ? (
        <div
          className="absolute inset-0 z-10 grid place-items-center bg-[var(--sat-surface)]/85"
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          <p className="rounded-full bg-[var(--sat-text)] px-4 py-2 text-[14px] font-semibold text-[var(--sat-background)]">
            Paused by proctor
          </p>
        </div>
      ) : null}
      {disabled && silenceLiveRegions ? (
        <div
          className="absolute inset-0 z-10 grid place-items-center bg-[var(--sat-surface)]/85"
          aria-hidden="true"
        >
          <p className="rounded-full bg-[var(--sat-text)] px-4 py-2 text-[14px] font-semibold text-[var(--sat-background)]">
            Paused by proctor
          </p>
        </div>
      ) : null}
    </div>
  );
}
