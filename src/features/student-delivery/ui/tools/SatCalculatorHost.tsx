import { SatCalculatorPanel, type SatCalculatorPanelProps } from "./SatCalculatorPanel";
import { SatExamZoomPlane } from "../zoom/SatExamZoomContext";

interface SatCalculatorHostProps extends Omit<SatCalculatorPanelProps, "prewarmWhenClosed"> {
  moduleId: string;
  examZoom?: number | null | undefined;
  examHeight?: number | null | undefined;
  contrastMode?: string | undefined;
}

/** This sibling of the stage host keeps the same frames through stage changes. */
export function SatCalculatorHost({
  moduleId,
  examZoom,
  examHeight,
  contrastMode = "default",
  ...panel
}: SatCalculatorHostProps) {
  return (
    <div
      className="sat-ui sat-calculator-host pointer-events-none fixed inset-0"
      style={{ background: "transparent" }}
      data-sat-calculator-host
      data-sat-contrast={contrastMode}
    >
      <SatExamZoomPlane
        scale={examZoom ?? 1}
        height={examHeight}
        contrastMode={contrastMode}
        viewportClassName="pointer-events-none relative h-full w-full"
      >
        <SatCalculatorPanel
          key={`${panel.scheduleId}:${panel.attemptId}:${moduleId}`}
          {...panel}
          prewarmWhenClosed
        />
      </SatExamZoomPlane>
    </div>
  );
}
