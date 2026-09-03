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
 * Compatibility name for the authoring confirmation API. Destructive actions
 * now use the shared Radix alert dialog so focus, Escape, and scroll locking
 * are consistent with the rest of the workspace.
 */
export function ConfirmPopover(props: ConfirmPopoverProps) {
  return <AuthoringConfirmDialog {...props} destructive />;
}
