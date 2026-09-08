import { Check, CircleAlert, Cloud, LoaderCircle } from "lucide-react";
import type { QuestionSaveStatus } from "../../hooks/useQuestionAutosave";

export const SAVE_CLUSTER_LABELS: Record<QuestionSaveStatus, string> = {
  saved: "Saved",
  unsaved: "Editing",
  saving: "Saving…",
  offline: "Offline · saved on this device",
  error: "Not saved — Retry",
};

export interface SaveClusterProps {
  status: QuestionSaveStatus;
  lastSavedAt: Date | null;
  onRetry?: (() => void) | undefined;
}

/**
 * Single save truth (plan Phase 7): one vocabulary for QuestionSaveStatus,
 * one component rendered in the header slot AND the footer from the same
 * autosave object. Error is a Retry button; everything else is read-only
 * status text with a polite live region.
 */
export function SaveCluster({ status, lastSavedAt, onRetry }: SaveClusterProps) {
  const label = SAVE_CLUSTER_LABELS[status];
  const Icon =
    status === "saving"
      ? LoaderCircle
      : status === "error"
        ? CircleAlert
        : status === "saved"
          ? Check
          : Cloud;
  const tone =
    status === "error"
      ? "text-destructive"
      : status === "offline"
        ? "text-amber-800"
        : status === "saved"
          ? "text-green-800"
          : "text-muted-foreground";
  const title =
    status === "offline"
      ? "Offline. Changes are stored on this device and will retry when you reconnect."
      : lastSavedAt
        ? `Last saved ${lastSavedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
        : label;

  const face = (
    <span className={`flex items-center gap-1.5 text-xs font-semibold ${tone}`}>
      <Icon size={14} aria-hidden="true" strokeWidth={2.3} />
      <span>{label}</span>
    </span>
  );

  if (status === "error") {
    return (
      <button
        type="button"
        title={title}
        aria-label={`${title}. Retry save`}
        onClick={onRetry}
        className="flex min-h-9 items-center justify-center gap-1.5 rounded-md px-2.5 hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span role="status">{face}</span>
      </button>
    );
  }
  return (
    <span title={title} aria-label={title} role="status" className="flex min-h-9 items-center justify-center gap-1.5 rounded-md px-2.5">
      {face}
    </span>
  );
}
