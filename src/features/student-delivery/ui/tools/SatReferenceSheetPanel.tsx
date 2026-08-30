import { SatReferenceSheet } from "./reference/SatReferenceSheet";
import { SatToolWindow } from "./SatToolWindow";

export interface SatReferenceSheetPanelProps {
  open: boolean;
  disabled?: boolean;
  onClose: () => void;
}

export function SatReferenceSheetPanel({
  open,
  disabled = false,
  onClose,
}: SatReferenceSheetPanelProps) {
  return (
    <SatToolWindow
      title="Reference Sheet"
      open={open}
      onClose={onClose}
      collapsible
      interactionDisabled={disabled}
    >
      <div className="h-full overflow-y-auto bg-[var(--sat-surface)]">
        <SatReferenceSheet />
      </div>
    </SatToolWindow>
  );
}
