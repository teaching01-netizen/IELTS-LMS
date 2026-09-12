import { SAT_COPY } from "../../domain/satCopy";
import { SatCenterModal } from "../primitives/SatCenterModal";

export interface SatUnscheduledBreakDialogProps {
  open: boolean;
  onCancel: () => void;
  onTakeBreak: () => void;
  returnFocusSelector?: string | undefined;
}

/**
 * Bluebook Unscheduled Break confirm (Phase 8). Dangerous actions get a
 * confirmation: the timer keeps running is stated explicitly. Above every
 * tool (z breakConfirm 86). Cancel and Start my break both return focus to More.
 */
export function SatUnscheduledBreakDialog(props: SatUnscheduledBreakDialogProps) {
  return (
    <SatCenterModal
      open={props.open}
      title={SAT_COPY.unscheduledBreak.confirmTitle}
      closeLabel={SAT_COPY.unscheduledBreak.cancel}
      onClose={props.onCancel}
      returnFocusSelector={props.returnFocusSelector}
      layer="breakConfirm"
      description="Confirm taking an unscheduled break"
    >
      <div className="px-5 py-5 sm:px-7">
        <p className="text-[15px] leading-7 text-[var(--sat-text)]">
          {SAT_COPY.unscheduledBreak.confirmBody}
        </p>
        <div className="mt-6 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={props.onCancel}
            className="sat-touch-target sat-pressable rounded-full border border-[var(--sat-text)] px-6 text-[14px] font-semibold text-[var(--sat-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-focus)]"
          >
            {SAT_COPY.unscheduledBreak.cancel}
          </button>
          <button
            type="button"
            onClick={props.onTakeBreak}
            className="sat-touch-target sat-pressable rounded-full bg-[var(--sat-accent)] px-6 text-[14px] font-semibold text-[var(--sat-accent-text)] hover:bg-[var(--sat-accent-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-focus)]"
          >
            {SAT_COPY.unscheduledBreak.takeBreak}
          </button>
        </div>
      </div>
    </SatCenterModal>
  );
}
