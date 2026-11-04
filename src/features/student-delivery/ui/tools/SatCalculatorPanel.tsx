import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import {
  calculatorWorkspaceKey,
  isPrewarmKey,
  loadCalculatorWorkspace,
  saveCalculatorWorkspace,
} from "../../infrastructure/satCalculatorWorkspace";
import { SAT_EXAM_LOCALE } from "../../infrastructure/desmos/desmosTypes";
import type { DesmosCalculatorMode } from "../../infrastructure/desmos/desmosTypes";
import { DesmosCalculator, type DesmosOutcomeEvent } from "./DesmosCalculator";
import { SatFloatingTool } from "./SatFloatingTool";
import { satToolGeometryKey } from "../../infrastructure/satToolGeometryStore";
import { useSatMediaQuery } from "../useSatMediaQuery";
import { satToolViewKey } from "../../infrastructure/satToolStateStore";
import { useSatExamZoom } from "../zoom/SatExamZoomContext";
import { readSatCalculatorDragArea, readSatCalculatorSafeArea } from "./satToolPlacementRuntime";
import { emitStudentObservabilityMetric } from "../../../../utils/studentObservability";

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

/** Idle budget after which the deferred mode mounts without any signal. */
const SAT_DESMOS_IDLE_EAGER_MS = 30_000;

/** Prewarm jitter window spreading pending-host second-mode mounts. */
const SAT_DESMOS_PREWARM_JITTER_MS = 10_000;

function readDataSaver(): boolean {
  if (typeof navigator === "undefined") return false;
  const connection =
    (navigator as Navigator & {
      connection?: { saveData?: boolean; effectiveType?: string };
    }).connection ?? null;
  if (!connection) return false;
  return (
    connection.saveData === true ||
    connection.effectiveType === "slow-2g" ||
    connection.effectiveType === "2g"
  );
}

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
  const compact = useSatMediaQuery(SAT_TOOL_COMPACT_QUERY);

  useEffect(() => {
    setMode(loadCalculatorWorkspace(storageKey).activeMode);
  }, [storageKey]);

  // Lazy second mode (burst plan CF-2/FR-02): the active mode mounts eager;
  // the inactive mode mounts only once eagerInactive derives true —
  // activeReady (first ready beacon for this panel) OR explicit hover/focus
  // intent OR the 30s idle budget. Data-saver / slow-2g connections defer
  // every automatic path; only explicit hover/focus intent mounts there.
  // Pending (prewarm:) hosts add 0–10s jitter so a bell-burst of Math opens
  // does not mount second documents in lockstep.
  const prewarm = isPrewarmKey(moduleAttemptId);
  const [activeReady, setActiveReady] = useState(false);
  const [hoverIntent, setHoverIntent] = useState(false);
  const [idleElapsed, setIdleElapsed] = useState(false);
  const [prewarmDelayElapsed, setPrewarmDelayElapsed] = useState(!prewarm);
  const [dataSaver] = useState(readDataSaver);
  useEffect(() => {
    if (!prewarm) {
      setPrewarmDelayElapsed(true);
      return;
    }
    const jitterMs = Math.floor(Math.random() * SAT_DESMOS_PREWARM_JITTER_MS);
    const timer = window.setTimeout(() => setPrewarmDelayElapsed(true), jitterMs);
    return () => window.clearTimeout(timer);
  }, [prewarm, moduleAttemptId]);
  useEffect(() => {
    const timer = window.setTimeout(() => setIdleElapsed(true), SAT_DESMOS_IDLE_EAGER_MS);
    return () => window.clearTimeout(timer);
  }, []);
  const eagerInactive =
    hoverIntent || (prewarmDelayElapsed && !dataSaver && (activeReady || idleElapsed));

  const handleDesmosOutcome = useCallback(
    (event: DesmosOutcomeEvent) => {
      emitStudentObservabilityMetric("sat_desmos_outcome", {
        scheduleId,
        attemptId,
        moduleAttemptId,
        mode: event.mode,
        outcome: event.outcome,
        durationMs: event.durationMs,
        retryCount: event.retryCount,
      });
      if (event.outcome === "ready") setActiveReady(true);
    },
    [attemptId, moduleAttemptId, scheduleId],
  );
  const handleModeChange = (nextMode: DesmosCalculatorMode) => {
    if (nextMode === mode || disabled) return;
    // Prewarm read-only (INV-012): a synthetic prewarm: attempt must never
    // persist mode — the real module attempt owns the workspace. Assert +
    // beacon instead of forking the prewarmed frame.
    if (isPrewarmKey(storageKey)) {
      emitStudentObservabilityMetric("sat_desmos_prewrite_blocked", {
        scheduleId,
        attemptId,
        moduleAttemptId,
      });
      return;
    }
    setMode(nextMode);
    const saved = saveCalculatorWorkspace(storageKey, { activeMode: nextMode });
    if (!saved) {
      // Quota/private-mode: keep the mode in memory for this mount and
      // beacon — never throw out of a tool toggle.
      emitStudentObservabilityMetric("sat_desmos_workspace_quota", {
        scheduleId,
        attemptId,
        moduleAttemptId,
      });
    }
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

  // Keep Desmos mounted while closed; the mode is per-moduleAttempt
  // (storageKey) — shared across open/close presentations of the SAME module
  // attempt only, never across modules (INV-004 isolation).
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
      {/* Intent signals only (lazy second-mode mount), not an interactive
          control: the embed keeps its own tab order and roles. */}
      {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions */}
      <div
        className="h-full min-h-0 flex-1"
        onMouseEnter={() => setHoverIntent(true)}
        onFocus={() => setHoverIntent(true)}
      >
        <DesmosCalculator
          mode={mode}
          locale={SAT_EXAM_LOCALE}
          disabled={disabled}
          prewarmInactiveModes={prewarmWhenClosed || open}
          silenceLiveRegions={!open || undefined}
          eagerInactive={eagerInactive}
          onDesmosOutcome={handleDesmosOutcome}
        />
      </div>
    </div>
  );
  // Window dimensions are physical pixels, converted once into the zoom plane.
  const viewport = logicalSize({ width: window.innerWidth, height: window.innerHeight });
  // Drag/resize parity (plan FR-05): the 20px outside band is unconditional —
  // a window flush against the screen edge would push most of that band (and
  // the corner bracket that advertises it) off-screen, which is also where
  // iOS keeps its edge gestures. Fine pointers keep the tight 8px clamp.
  const coarsePointer = useSatMediaQuery("(pointer: coarse)");
  const edgeGutter = viewportToLogicalLength(20);
  // Bluebook layout: the window may cover the exam header and footer. First open
  // stays full height from the top inset down to the body so the expression list
  // stays visible above the keypad; afterwards it moves and resizes screen-wide.
  const dragArea = useMemo(
    () => readSatCalculatorDragArea(viewportToLogicalLength),
    // safeArea re-measures on viewport resize; device insets change with it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [safeArea, viewportToLogicalLength]
  );
  const clampArea = useMemo(
    () => coarsePointer
      ? {
          top: dragArea.top + edgeGutter,
          right: dragArea.right + edgeGutter,
          bottom: dragArea.bottom + edgeGutter,
          left: dragArea.left + edgeGutter,
        }
      : dragArea,
    [coarsePointer, dragArea, edgeGutter]
  );
  const bodyWidth = Math.max(1, viewport.width - safeArea.left - safeArea.right - edgeGutter * 2);
  const bodyHeight = Math.max(1, viewport.height - dragArea.top - safeArea.bottom - edgeGutter * 2);
  const dragWidth = Math.max(1, viewport.width - clampArea.left - clampArea.right);
  const dragHeight = Math.max(1, viewport.height - clampArea.top - clampArea.bottom);
  const firstOpenSize = {
    w: Math.min(bodyWidth, Math.max(400 / scale, Math.min(440 / scale, bodyWidth * 0.36))),
    h: bodyHeight,
  };
  const defaultGeometry = useMemo(
    () => {
      // Sheet parity (plan FR-03): the compact sheet keeps its first-open
      // look (centered 520/scale, 15%/85%) while y/h follow live geometry.
      if (compact) {
        const sheetW = Math.min(viewport.width, 520 / scale);
        return {
          x: Math.max(0, (viewport.width - sheetW) / 2),
          y: viewport.height * 0.15,
          w: sheetW,
          h: viewport.height * 0.85,
        };
      }
      return {
        x: safeArea.left + edgeGutter,
        y: dragArea.top + edgeGutter,
        w: firstOpenSize.w,
        h: firstOpenSize.h,
      };
    },
    [compact, viewport.width, viewport.height, scale, safeArea.left, dragArea.top, edgeGutter, firstOpenSize.w, firstOpenSize.h]
  );
  const minimumSize = useMemo(
    () => ({ w: Math.min(400 / scale, dragWidth), h: Math.min(400 / scale, dragHeight) }),
    [scale, dragWidth, dragHeight]
  );
  const maximumSize = useMemo(() => ({ w: dragWidth, h: dragHeight }), [dragWidth, dragHeight]);
  return (
    <SatFloatingTool
      title="Calculator"
      open={open}
      geometryKey={satToolGeometryKey(
        scheduleId,
        attemptId,
        moduleAttemptId,
        "calculator:portrait-v2"
      )}
      viewStateKey={satToolViewKey(scheduleId, attemptId, moduleAttemptId)}
      defaultGeometry={defaultGeometry}
      geometryScale={scale}
      safeArea={clampArea}
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
      headerControls={modeSwitch}
      onClose={onClose}
    >
      {body}
    </SatFloatingTool>
  );
}
