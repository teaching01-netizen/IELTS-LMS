import { AuthoringConfirmDialog } from "./authoringPrimitives";

export interface ConfirmPopoverProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

/**
 * @deprecated Use `AuthoringConfirmDialog` directly (destructive confirm).
 * Compatibility alias kept for the legacy workspace branch.
 * TODO(spine P10): remove this alias with the legacy panes.
 */
export function ConfirmPopover(props: ConfirmPopoverProps) {
  return <AuthoringConfirmDialog {...props} destructive />;
}
