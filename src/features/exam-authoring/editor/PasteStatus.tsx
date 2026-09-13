import { useEffect } from "react";

export interface PasteStatusState {
  visible: boolean;
  source: string | null;
  imageCount: number;
  mathCount: number;
  needsAltText: boolean;
  canUndo?: boolean;
  rejectedImageCount?: number;
}

export interface PasteStatusProps {
  status: PasteStatusState;
  onUndo: () => void;
  onDismiss: () => void;
}

export function PasteStatus({ status, onUndo, onDismiss }: PasteStatusProps) {
  useEffect(() => {
    if (!status.visible) return;
    const timer = window.setTimeout(onDismiss, 4000);
    return () => window.clearTimeout(timer);
  }, [status.visible, onDismiss]);
  if (!status.visible) return null;
  const rejectedCopy =
    (status.rejectedImageCount ?? 0) > 0
      ? " " +
        status.rejectedImageCount +
        " visual" +
        (status.rejectedImageCount === 1 ? " was" : "s were") +
        " not imported."
      : "";
  const copy =
    status.imageCount > 0
      ? "Pasted " +
        status.imageCount +
        " visual" +
        (status.imageCount === 1 ? "" : "s") +
        " \u2014 add alt text in the image dialog" +
        rejectedCopy
      : (status.rejectedImageCount ?? 0) > 0
        ? rejectedCopy.trim()
        : status.mathCount > 0
          ? status.mathCount + " equation" + (status.mathCount === 1 ? "" : "s") + " formatted"
          : "Pasted formatted content";
  return (
    <div role="status" aria-live="polite" className="sat-rich-editor__paste-status">
      <span>{copy}</span>
      {status.canUndo !== false ? (
        <button
          type="button"
          aria-label="Undo paste"
          onClick={onUndo}
          onMouseDown={(e) => e.preventDefault()}
        >
          Undo
        </button>
      ) : null}
    </div>
  );
}
