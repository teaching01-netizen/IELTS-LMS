import { useEffect, useMemo, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Calculator } from "lucide-react";
import {
  calculatorWorkspaceKey,
  loadCalculatorWorkspace,
  saveCalculatorWorkspace,
} from "../../infrastructure/satCalculatorWorkspace";
import type { DesmosCalculatorMode } from "../../infrastructure/desmos/desmosTypes";
import { DesmosCalculator } from "./DesmosCalculator";
import { SatToolWindow } from "./SatToolWindow";

export interface SatCalculatorPanelProps {
  open: boolean;
  scheduleId: string;
  attemptId: string;
  moduleAttemptId: string;
  disabled?: boolean;
  prewarmWhenClosed?: boolean;
  onClose: () => void;
}

const calculatorModes: readonly DesmosCalculatorMode[] = ["scientific", "graphing"];

export function SatCalculatorPanel({
  open,
  scheduleId,
  attemptId,
  moduleAttemptId,
  disabled = false,
  prewarmWhenClosed = false,
  onClose,
}: SatCalculatorPanelProps) {
  const storageKey = useMemo(
    () => calculatorWorkspaceKey(scheduleId, attemptId, moduleAttemptId),
    [attemptId, moduleAttemptId, scheduleId]
  );
  const [mode, setMode] = useState<DesmosCalculatorMode>(
    () => loadCalculatorWorkspace(storageKey).activeMode
  );

  useEffect(() => {
    setMode(loadCalculatorWorkspace(storageKey).activeMode);
  }, [storageKey]);

  const handleModeChange = (nextMode: DesmosCalculatorMode) => {
    if (nextMode === mode || disabled) return;
    setMode(nextMode);
    saveCalculatorWorkspace(storageKey, { activeMode: nextMode });
  };

  const handleModeKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (disabled || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const group = event.currentTarget.parentElement;
    const nextMode = event.key === "ArrowLeft" || event.key === "Home" ? "scientific" : "graphing";
    handleModeChange(nextMode);
    window.requestAnimationFrame(() => {
      group?.querySelector<HTMLButtonElement>(`[data-sat-calculator-mode="${nextMode}"]`)?.focus();
    });
  };

  return (
    <SatToolWindow
      title="Calculator"
      open={open}
      collapsible
      keepMountedOnClose
      prewarmWhenClosed={prewarmWhenClosed}
      interactionDisabled={disabled}
      onClose={onClose}
    >
      <div className="grid h-full min-h-0 grid-rows-[minmax(56px,auto)_minmax(0,1fr)] bg-[var(--sat-surface)]">
        <div className="flex min-w-0 items-center justify-end gap-3 border-b border-[var(--sat-divider-soft)] px-3 py-1.5 sm:px-4">
          <div className="hidden min-w-0 items-center gap-2 sat-type-metadata font-medium text-[var(--sat-text-secondary)] min-[520px]:flex">
            <Calculator className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="truncate">Desmos · College Board</span>
          </div>
          <div
            className="grid w-full max-w-[240px] grid-cols-2 rounded-[8px] bg-[var(--sat-surface-subtle)] p-1 min-[520px]:ml-auto"
            role="group"
            aria-label="Calculator type"
          >
            {calculatorModes.map((candidate) => (
              <button
                type="button"
                key={candidate}
                data-sat-calculator-mode={candidate}
                onClick={() => handleModeChange(candidate)}
                onKeyDown={handleModeKeyDown}
                disabled={disabled}
                aria-pressed={mode === candidate}
                className={`sat-pressable sat-state-transition min-h-11 min-w-0 rounded-[6px] px-2 sat-type-control-primary font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-focus)] ${mode === candidate ? "bg-[var(--sat-surface)] text-[var(--sat-text)] shadow-sm" : "text-[var(--sat-text-secondary)] hover:text-[var(--sat-text)]"} disabled:cursor-not-allowed disabled:bg-[var(--sat-disabled-background)] disabled:text-[var(--sat-disabled-text)]`}
              >
                {candidate === "scientific" ? "Scientific" : "Graphing"}
              </button>
            ))}
          </div>
        </div>
        <DesmosCalculator
          mode={mode}
          disabled={disabled}
          prewarmInactiveModes={prewarmWhenClosed}
        />
      </div>
    </SatToolWindow>
  );
}
