import { SatFloatingTool } from "./SatFloatingTool";
import { satToolGeometryKey } from "../../infrastructure/satToolGeometryStore";
import { SatReferenceSheet } from "./reference/SatReferenceSheet";

export interface SatReferenceSheetPanelProps {
  open: boolean;
  disabled?: boolean;
  scheduleId?: string | undefined;
  attemptId?: string | undefined;
  moduleAttemptId?: string | undefined;
  onClose: () => void;
}

export function SatReferenceSheetPanel({
  open,
  disabled = false,
  scheduleId = "debug-schedule",
  attemptId = "debug-attempt",
  moduleAttemptId = "debug-module",
  onClose,
}: SatReferenceSheetPanelProps) {
  // Bluebook floating tool (Phase 9): draggable, fixed size (content sheet).
  return (
    <SatFloatingTool
      title="Reference Sheet"
      open={open}
      geometryKey={satToolGeometryKey(scheduleId, attemptId, moduleAttemptId, "reference")}
      defaultGeometry={{ x: 48, y: 110, w: 380, h: 480 }}
      disabled={disabled}
      onClose={onClose}
    >
      <div className="h-full overflow-y-auto bg-[var(--sat-surface)]">
        <SatReferenceSheet />
      </div>
    </SatFloatingTool>
  );
}
