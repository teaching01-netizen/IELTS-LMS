import { useEffect, useRef, useState } from 'react';
import { loadDesmos } from '../../infrastructure/desmos/loadDesmos';
import {
  SAT_DESMOS_GRAPHING_OPTIONS,
  SAT_DESMOS_SCIENTIFIC_OPTIONS,
} from '../../infrastructure/desmos/desmosTestingConfig';
import type {
  DesmosCalculatorInstance,
  DesmosCalculatorMode,
  DesmosCalculatorState,
} from '../../infrastructure/desmos/desmosTypes';

export interface DesmosCalculatorProps {
  mode: DesmosCalculatorMode;
  initialState?: DesmosCalculatorState;
  disabled?: boolean;
  onStateChange: (state: DesmosCalculatorState) => void;
}

type LoadState = 'loading' | 'ready' | 'error';
const CHANGE_EVENT = 'change.sat-exam';
const STATE_CAPTURE_DEBOUNCE_MS = 160;

export function DesmosCalculator({
  mode,
  initialState,
  disabled = false,
  onStateChange,
}: DesmosCalculatorProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const callbackRef = useRef(onStateChange);
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [error, setError] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);

  useEffect(() => { callbackRef.current = onStateChange; }, [onStateChange]);

  useEffect(() => {
    let cancelled = false;
    let calculator: DesmosCalculatorInstance | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let fallbackResize: (() => void) | null = null;
    let animationFrame = 0;
    let stateCaptureTimer: number | null = null;

    setLoadState('loading');
    setError(null);

    void loadDesmos().then((Desmos) => {
      if (cancelled || !hostRef.current) return;
      const featureEnabled = mode === 'graphing'
        ? Desmos.enabledFeatures.GraphingCalculator
        : Desmos.enabledFeatures.ScientificCalculator;
      if (!featureEnabled) {
        throw new Error(`${mode === 'graphing' ? 'Graphing' : 'Scientific'} Calculator is not enabled for this Desmos API key.`);
      }

      calculator = mode === 'graphing'
        ? Desmos.GraphingCalculator(hostRef.current, SAT_DESMOS_GRAPHING_OPTIONS)
        : Desmos.ScientificCalculator(hostRef.current, SAT_DESMOS_SCIENTIFIC_OPTIONS);

      if (initialState !== undefined) {
        try { calculator.setState(initialState); } catch { calculator.setBlank?.(); }
      }

      calculator.observeEvent(CHANGE_EVENT, () => {
        if (!calculator || cancelled) return;
        if (stateCaptureTimer !== null) window.clearTimeout(stateCaptureTimer);
        stateCaptureTimer = window.setTimeout(() => {
          stateCaptureTimer = null;
          if (!calculator || cancelled) return;
          try { callbackRef.current(calculator.getState()); } catch { /* Vendor state capture is best-effort. */ }
        }, STATE_CAPTURE_DEBOUNCE_MS);
      });

      if (typeof ResizeObserver !== 'undefined') {
        resizeObserver = new ResizeObserver(() => calculator?.resize());
        resizeObserver.observe(hostRef.current);
      } else {
        fallbackResize = () => calculator?.resize();
        window.addEventListener('resize', fallbackResize);
      }
      animationFrame = window.requestAnimationFrame(() => calculator?.resize());
      setLoadState('ready');
    }).catch((loadError: unknown) => {
      if (cancelled) return;
      setError(loadError instanceof Error ? loadError.message : 'The calculator could not be loaded.');
      setLoadState('error');
    });

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(animationFrame);
      if (stateCaptureTimer !== null) window.clearTimeout(stateCaptureTimer);
      resizeObserver?.disconnect();
      if (fallbackResize) window.removeEventListener('resize', fallbackResize);
      if (calculator) {
        try { callbackRef.current(calculator.getState()); } catch { /* Preserve exam teardown. */ }
        calculator.unobserveEvent(CHANGE_EVENT);
        calculator.destroy();
      }
    };
  }, [initialState, mode, retryNonce]);

  return (
    <div className="relative h-full min-h-0 w-full overflow-hidden bg-white" data-sat-trusted-tool="desmos">
      <div ref={hostRef} className="h-full min-h-[320px] w-full" aria-label={`${mode} calculator`} />
      {loadState === 'loading' ? (
        <div className="absolute inset-0 grid place-items-center bg-white/95" role="status">
          <div className="text-center">
            <div className="mx-auto mb-3 h-5 w-5 animate-spin rounded-full border-2 border-slate-200 border-t-slate-900" />
            <p className="text-sm font-medium text-slate-600">Loading calculator…</p>
          </div>
        </div>
      ) : null}
      {loadState === 'error' ? (
        <div className="absolute inset-0 grid place-items-center bg-white p-8" role="alert">
          <div className="max-w-sm text-center">
            <p className="text-base font-semibold text-slate-950">Calculator unavailable</p>
            <p className="mt-2 text-sm leading-6 text-slate-600">{error}</p>
            <p className="mt-3 text-xs text-slate-500">Your exam remains active. Retry once, then notify your proctor if the tool is still unavailable.</p>
            <button type="button" onClick={() => setRetryNonce((value) => value + 1)} className="mt-4 h-10 rounded-xl bg-slate-950 px-4 text-sm font-semibold text-white hover:bg-slate-800">Retry calculator</button>
          </div>
        </div>
      ) : null}
      {disabled && loadState === 'ready' ? (
        <div className="absolute inset-0 grid place-items-center bg-white/70 backdrop-blur-[1px]">
          <p className="rounded-full bg-slate-950 px-4 py-2 text-sm font-semibold text-white">Paused by proctor</p>
        </div>
      ) : null}
    </div>
  );
}
