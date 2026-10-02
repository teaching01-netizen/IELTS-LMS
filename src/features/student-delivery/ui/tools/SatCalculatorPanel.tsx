import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import {
  calculatorLocaleKey,
  calculatorWorkspaceKey,
  loadCalculatorLocale,
  loadCalculatorWorkspace,
  saveCalculatorWorkspace,
} from "../../infrastructure/satCalculatorWorkspace";
import type { DesmosCalculatorMode, DesmosLocale } from "../../infrastructure/desmos/desmosTypes";
import { DesmosCalculator } from "./DesmosCalculator";
import { SatFloatingTool } from "./SatFloatingTool";
import { satToolGeometryKey } from "../../infrastructure/satToolGeometryStore";
import { useSatMediaQuery } from "../useSatMediaQuery";
import { satToolViewKey } from "../../infrastructure/satToolStateStore";
import { useSatExamZoom } from "../zoom/SatExamZoomContext";
import { readSatCalculatorSafeArea } from "./satToolPlacementRuntime";

export interface SatCalculatorPanelProps {
  open: boolean;
  scheduleId: string;
  attemptId: string;
  moduleAttemptId: string;
  disabled?: boolean;
  prewarmWhenClosed?: boolean;
  onClose: () => void;
}

const calculatorModes: readonly DesmosCalculatorMode[] = ["graphing", "scientific"];

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
  const { logicalSize, viewportToLogicalLength, scale } = useSatExamZoom();
  const [safeArea, setSafeArea] = useState(() =>
    readSatCalculatorSafeArea(viewportToLogicalLength)
  );
  useLayoutEffect(() => {
    const measure = () => {
      const next = readSatCalculatorSafeArea(viewportToLogicalLength);
      setSafeArea((current) =>
        Object.keys(next).every(
          (key) => next[key as keyof typeof next] === current[key as keyof typeof next]
        )
          ? current
          : next
      );
    };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    const body = document.getElementById("sat-question-content");
    if (body) observer?.observe(body);
    window.addEventListener("resize", measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [open, storageKey, viewportToLogicalLength]);
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
    const nextMode = event.key === "ArrowLeft" || event.key === "Home" ? "graphing" : "scientific";
    handleModeChange(nextMode);
    window.requestAnimationFrame(() => {
      group?.querySelector<HTMLButtonElement>(`[data-sat-calculator-mode="${nextMode}"]`)?.focus();
    });
  };

  // Keep Desmos mounted while closed; mode selection is shared across presentations.
  const modeSwitch = (
    <div
      className="sat-calculator-modes grid min-w-0 grid-cols-2 gap-0.5"
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
          className={`sat-calculator-mode min-w-0 rounded px-2 font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-focus)] ${mode === candidate ? "bg-white text-black" : "text-white hover:bg-white/10"} disabled:cursor-not-allowed disabled:opacity-50`}
        >
          {candidate === "scientific" ? "Scientific" : "Graphing"}
        </button>
      ))}
    </div>
  );
  const body = (
    <div className="flex h-full min-h-0 flex-col bg-[var(--sat-surface)]">
      {compact ? (
        <div className="flex shrink-0 items-center justify-end bg-[var(--sat-ref-header-bg)] border-b border-[var(--sat-divider-soft)] px-3 py-1.5">
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
  // Window dimensions are physical pixels, converted once into the zoom plane.
  const viewport = logicalSize({ width: window.innerWidth, height: window.innerHeight });
  const bodyWidth = viewport.width - safeArea.left - safeArea.right;
  const bodyHeight = Math.max(1, viewport.height - safeArea.top - safeArea.bottom);
  const firstOpenSize = {
    w: Math.min(bodyWidth, Math.max(400 / scale, Math.min(440 / scale, bodyWidth * 0.36))),
    h: bodyHeight,
  };
  const defaultGeometry = useMemo(
    () => ({ x: safeArea.left, y: safeArea.top, w: firstOpenSize.w, h: firstOpenSize.h }),
    [safeArea, firstOpenSize.w, firstOpenSize.h]
  );
  const minimumSize = useMemo(
    () => ({ w: 400 / scale, h: Math.min(480 / scale, bodyHeight) }),
    [scale, bodyHeight]
  );
  const maximumSize = useMemo(
    () => ({ w: Math.min(620 / scale, bodyWidth), h: bodyHeight }),
    [scale, bodyWidth, bodyHeight]
  );
  return (
    <SatFloatingTool
      title="Calculator"
      open={open}
      geometryKey={satToolGeometryKey(
        scheduleId,
        attemptId,
        moduleAttemptId,
        "calculator:portrait-v1"
      )}
      viewStateKey={satToolViewKey(scheduleId, attemptId, moduleAttemptId)}
      defaultGeometry={defaultGeometry}
      geometryScale={scale}
      safeArea={safeArea}
      minSize={minimumSize}
      maxSize={maximumSize}
      style={
        {
          "--sat-tool-unit": `${1 / scale}px`,
          "--sat-tool-control-hit": `${44 / scale}px`,
          "--sat-calculator-type": `${12 / scale}px`,
        } as CSSProperties
      }
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
