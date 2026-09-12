/* eslint-disable jsx-a11y/no-noninteractive-element-interactions -- iframe onLoad is a lifecycle signal, not a user interaction. */
import { useEffect, useRef, useState } from "react";
import type { DesmosCalculatorMode } from "../../infrastructure/desmos/desmosTypes";

export interface DesmosCalculatorProps {
  mode: DesmosCalculatorMode;
  disabled?: boolean;
  prewarmInactiveModes?: boolean;
  /**
   * Phase 01 aria contract: set when this tree is hidden (tool closed or
   * keepAlive prewarm). Strips live-region roles; visible output unchanged.
   */
  silenceLiveRegions?: boolean | undefined;
}

const DESMOS_MODES = ["scientific", "graphing"] as const;

const DESMOS_EMBED_URLS: Record<DesmosCalculatorMode, string> = {
  scientific: "https://www.desmos.com/testing/collegeboard/scientific?embed",
  graphing: "https://www.desmos.com/testing/collegeboard/graphing?embed",
};

export function DesmosCalculator({
  mode,
  disabled = false,
  prewarmInactiveModes = false,
  silenceLiveRegions = false,
}: DesmosCalculatorProps) {
  const [loadedModes, setLoadedModes] = useState<ReadonlySet<DesmosCalculatorMode>>(
    () => new Set()
  );
  const [mountedModes, setMountedModes] = useState<ReadonlySet<DesmosCalculatorMode>>(
    () => new Set(prewarmInactiveModes ? DESMOS_MODES : [mode])
  );
  const containerRef = useRef<HTMLDivElement>(null);
  const scientificRef = useRef<HTMLIFrameElement>(null);
  const graphingRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    setMountedModes((current) => {
      const next = new Set(current);
      next.add(mode);
      if (prewarmInactiveModes) {
        DESMOS_MODES.forEach((candidate) => next.add(candidate));
      }
      return next.size === current.size ? current : next;
    });
  }, [mode, prewarmInactiveModes]);

  useEffect(() => {
    if (!disabled) return;
    const active = document.activeElement;
    if (active === scientificRef.current || active === graphingRef.current) {
      (active as HTMLIFrameElement).blur();
      containerRef.current?.focus({ preventScroll: true });
    }
  }, [disabled]);

  const activeReady = loadedModes.has(mode);
  const bothModesReady = loadedModes.has("scientific") && loadedModes.has("graphing");

  return (
    <div
      ref={containerRef}
      className="relative h-full min-h-0 w-full overflow-hidden bg-[var(--sat-surface)]"
      data-sat-trusted-tool="desmos"
      data-desmos-ready={activeReady ? "true" : "false"}
      data-desmos-both-modes-ready={bothModesReady ? "true" : "false"}
      aria-label="Desmos calculator"
      aria-disabled={disabled || undefined}
      tabIndex={-1}
    >
      {DESMOS_MODES.map((candidate) => {
        if (!prewarmInactiveModes && candidate !== mode && !mountedModes.has(candidate)) {
          return null;
        }
        return (
          <iframe
            ref={candidate === "scientific" ? scientificRef : graphingRef}
            key={candidate}
            src={DESMOS_EMBED_URLS[candidate]}
            title={`Desmos ${candidate} calculator, College Board testing version`}
            className={`h-full min-h-[320px] w-full border-0 ${candidate === mode ? "block" : "hidden"}`}
            loading={candidate === mode || prewarmInactiveModes ? "eager" : "lazy"}
            referrerPolicy="strict-origin-when-cross-origin"
            tabIndex={disabled ? -1 : 0}
            inert={disabled}
            onLoad={() => setLoadedModes((current) => new Set(current).add(candidate))}
            data-desmos-mode={candidate}
          />
        );
      })}
      {!activeReady && !silenceLiveRegions ? (
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
      {!activeReady && silenceLiveRegions ? (
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
