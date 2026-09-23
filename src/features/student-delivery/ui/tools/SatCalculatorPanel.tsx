import { useEffect, useMemo, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import {
  calculatorLocaleKey,
  calculatorWorkspaceKey,
  loadCalculatorLocale,
  loadCalculatorWorkspace,
  saveCalculatorWorkspace,
} from "../../infrastructure/satCalculatorWorkspace";
import type {
  DesmosCalculatorMode,
  DesmosLocale,
} from "../../infrastructure/desmos/desmosTypes";
import { DesmosCalculator } from "./DesmosCalculator";
import { SatFloatingTool } from "./SatFloatingTool";
import { satToolGeometryKey } from "../../infrastructure/satToolGeometryStore";
import { useSatMediaQuery } from "../useSatMediaQuery";
import { resolveSatToolSize } from "../../domain/satToolSizePolicy";
import { satToolViewKey } from "../../infrastructure/satToolStateStore";
import { useSatExamZoom } from "../zoom/SatExamZoomContext";

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

/** Compact breakpoint mirrors the primitive's sheet switch (SatFloatingTool). */
const SAT_TOOL_COMPACT_QUERY = "(max-width: 639px), (max-height: 560px)";

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
  const localeKey = useMemo(
    () => calculatorLocaleKey(scheduleId, attemptId, moduleAttemptId),
    [attemptId, moduleAttemptId, scheduleId]
  );
  const { logicalSize } = useSatExamZoom();
  const [mode, setMode] = useState<DesmosCalculatorMode>(
    () => loadCalculatorWorkspace(storageKey).activeMode
  );
  const [locale, setLocale] = useState<DesmosLocale>(() => loadCalculatorLocale(localeKey));
  const compact = useSatMediaQuery(SAT_TOOL_COMPACT_QUERY);

  useEffect(() => {
    setMode(loadCalculatorWorkspace(storageKey).activeMode);
    setLocale(loadCalculatorLocale(localeKey));
  }, [localeKey, storageKey]);

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

  // Bluebook floating tool (Phase 9): draggable + resizable, geometry
  // persists per module-attempt. With prewarmWhenClosed the tool shell keeps
  // one mounted tree while closed (keepAlive): the same ready Desmos iframes
  // are revealed on open — never remounted. Otherwise closed tools unmount.
  // Calculator input state persists through Desmos, mode through the
  // workspace store, locale (frozen exam English) through its own key.
  // Compact keeps the bottom sheet.
  if (!open && !prewarmWhenClosed) return null;
  // Single mode selector (a11y contract pinned by SatCalculatorPanel.test):
  // radiogroup labelled "Calculator type", two radios with
  // data-sat-calculator-mode, arrow/Home/End switching, aria-checked.
  // Desktop renders it in the window header (headerControls); compact has
  // no header slot by design, so it renders at the top of the body instead.
  // Exactly one of the two mounts at a time.
  const modeSwitch = (
    <div
      className="grid w-full min-w-0 max-w-[240px] grid-cols-2 rounded-[8px] bg-[var(--sat-surface-subtle)] p-0.5"
      role="radiogroup"
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
          role="radio"
          aria-checked={mode === candidate}
          className={`sat-pressable sat-state-transition min-h-11 min-w-0 rounded-[6px] px-2 sat-type-control-primary font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-focus)] ${mode === candidate ? "bg-[var(--sat-surface)] text-[var(--sat-text)] shadow-sm" : "text-[var(--sat-text-secondary)] hover:text-[var(--sat-text)]"} disabled:cursor-not-allowed disabled:bg-[var(--sat-disabled-background)] disabled:text-[var(--sat-disabled-text)]`}
        >
          {candidate === "scientific" ? "Scientific" : "Graphing"}
        </button>
      ))}
    </div>
  );
  const body = (
    <div className="flex h-full min-h-0 flex-col bg-[var(--sat-surface)]">
      {compact ? (
        <div className="flex shrink-0 items-center justify-end border-b border-[var(--sat-divider-soft)] px-3 py-1.5">
          {modeSwitch}
        </div>
      ) : null}
      <div className="h-full min-h-0 flex-1">
        <DesmosCalculator
          mode={mode}
          locale={locale}
          disabled={disabled}
          prewarmInactiveModes={prewarmWhenClosed || open}
          silenceLiveRegions={!open || undefined}
        />
      </div>
    </div>
  );
  // First-open size only (Phase-02 policy): resolveSatToolSize for the
  // active mode. Mode switches preserve the current geometry (the window
  // never resizes on mode change); saved geometry, when present, wins over
  // this default inside the primitive.
  const firstOpenSize = resolveSatToolSize("calculator", mode);
  return (
    <SatFloatingTool
      title="Calculator"
      open={open}
      geometryKey={satToolGeometryKey(scheduleId, attemptId, moduleAttemptId, "calculator")}
      viewStateKey={satToolViewKey(scheduleId, attemptId, moduleAttemptId)}
      defaultGeometry={{
        x: Math.max(32, logicalSize({ width: window.innerWidth, height: window.innerHeight }).width - (firstOpenSize.w + 52)),
        y: 110,
        w: firstOpenSize.w,
        h: firstOpenSize.h,
      }}
      resizable
      disabled={disabled}
      keepAlive={prewarmWhenClosed}
      headerControls={compact ? undefined : modeSwitch}
      onClose={onClose}
    >
      {body}
    </SatFloatingTool>
  );
}
