import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Calculator } from 'lucide-react';
import {
  calculatorWorkspaceKey,
  loadCalculatorWorkspace,
  saveCalculatorWorkspace,
  type SatCalculatorWorkspace,
} from '../../application/satCalculatorWorkspace';
import type { DesmosCalculatorMode, DesmosCalculatorState } from '../../infrastructure/desmos/desmosTypes';
import { DesmosCalculator } from './DesmosCalculator';
import { SatToolWindow } from './SatToolWindow';

export interface SatCalculatorPanelProps {
  open: boolean;
  scheduleId: string;
  attemptId: string;
  moduleAttemptId: string;
  disabled?: boolean;
  onClose: () => void;
}

const PERSIST_DEBOUNCE_MS = 300;

export function SatCalculatorPanel({
  open,
  scheduleId,
  attemptId,
  moduleAttemptId,
  disabled = false,
  onClose,
}: SatCalculatorPanelProps) {
  const storageKey = useMemo(
    () => calculatorWorkspaceKey(scheduleId, attemptId, moduleAttemptId),
    [attemptId, moduleAttemptId, scheduleId],
  );
  const workspaceRef = useRef<SatCalculatorWorkspace>(loadCalculatorWorkspace(storageKey));
  const persistTimerRef = useRef<number | null>(null);
  const [mode, setMode] = useState<DesmosCalculatorMode>(workspaceRef.current.activeMode);

  const persistNow = useCallback(() => {
    if (persistTimerRef.current !== null) {
      window.clearTimeout(persistTimerRef.current);
      persistTimerRef.current = null;
    }
    saveCalculatorWorkspace(storageKey, workspaceRef.current);
  }, [storageKey]);

  const schedulePersist = useCallback(() => {
    if (persistTimerRef.current !== null) window.clearTimeout(persistTimerRef.current);
    persistTimerRef.current = window.setTimeout(() => {
      persistTimerRef.current = null;
      saveCalculatorWorkspace(storageKey, workspaceRef.current);
    }, PERSIST_DEBOUNCE_MS);
  }, [storageKey]);

  useEffect(() => {
    workspaceRef.current = loadCalculatorWorkspace(storageKey);
    setMode(workspaceRef.current.activeMode);
    return () => persistNow();
  }, [persistNow, storageKey]);

  const handleModeChange = (nextMode: DesmosCalculatorMode) => {
    if (nextMode === mode) return;
    workspaceRef.current = { ...workspaceRef.current, activeMode: nextMode };
    persistNow();
    setMode(nextMode);
  };
  const handleStateChange = useCallback((state: DesmosCalculatorState) => {
    workspaceRef.current = mode === 'graphing'
      ? { ...workspaceRef.current, graphingState: state }
      : { ...workspaceRef.current, scientificState: state };
    schedulePersist();
  }, [mode, schedulePersist]);

  const initialState = mode === 'graphing'
    ? workspaceRef.current.graphingState
    : workspaceRef.current.scientificState;

  return (
    <SatToolWindow title="Calculator" open={open} onClose={() => { persistNow(); onClose(); }}>
      <div className="grid h-full min-h-0 grid-rows-[52px_minmax(0,1fr)] bg-white">
        <div className="flex items-center justify-between gap-4 border-b border-slate-200 px-4">
          <div className="flex items-center gap-2 text-xs font-medium text-slate-500">
            <Calculator className="h-4 w-4" aria-hidden="true" />
            <span>Desmos</span>
          </div>
          <div className="inline-flex rounded-xl bg-slate-100 p-1" role="group" aria-label="Calculator type">
            {(['scientific', 'graphing'] as const).map((candidate) => (
              <button
                type="button"
                key={candidate}
                onClick={() => handleModeChange(candidate)}
                aria-pressed={mode === candidate}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 ${mode === candidate ? 'bg-white text-slate-950 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
              >
                {candidate === 'scientific' ? 'Scientific' : 'Graphing'}
              </button>
            ))}
          </div>
        </div>
        <DesmosCalculator
          mode={mode}
          initialState={initialState}
          disabled={disabled}
          onStateChange={handleStateChange}
        />
      </div>
    </SatToolWindow>
  );
}
