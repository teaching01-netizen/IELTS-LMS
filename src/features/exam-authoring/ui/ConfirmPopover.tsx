import { useEffect, useRef } from "react";
import { AnimatePresence, motion } from "motion/react";
import { AlertTriangle } from "lucide-react";
import { authoringMotion } from "./authoringMotion";

export interface ConfirmPopoverProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export function ConfirmPopover({
  open,
  title,
  description,
  confirmLabel,
  busy = false,
  onCancel,
  onConfirm,
}: ConfirmPopoverProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => cancelRef.current?.focus());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [onCancel, open]);

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          initial={{ opacity: 0, y: 6, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 4, scale: 0.99 }}
          transition={authoringMotion.spring}
          style={{ transformOrigin: "bottom right" }}
          className="au-elevation-menu absolute bottom-full right-0 z-50 mb-2 w-64 rounded-[14px] border border-black/[0.08] bg-white p-3.5"
          role="alertdialog"
          aria-modal="false"
          aria-label={title}
        >
          <div className="flex items-start gap-2.5">
            <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-au-danger-tint text-au-danger">
              <AlertTriangle size={14} aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <p className="text-[12px] font-semibold text-slate-900">{title}</p>
              <p className="mt-1 text-[11px] leading-5 text-slate-500">{description}</p>
            </div>
          </div>
          <div className="mt-3 flex justify-end gap-1.5">
            <motion.button
              ref={cancelRef}
              type="button"
              whileTap={authoringMotion.press}
              transition={authoringMotion.fast}
              onClick={onCancel}
              disabled={busy}
              className="authoring-interactive min-h-9 rounded-[10px] px-3 text-[12px] font-semibold text-slate-600 hover:bg-black/[0.05] disabled:opacity-40"
            >
              Cancel
            </motion.button>
            <motion.button
              type="button"
              whileTap={authoringMotion.press}
              transition={authoringMotion.fast}
              onClick={onConfirm}
              disabled={busy}
              className="authoring-interactive min-h-9 rounded-[10px] bg-au-danger px-3 text-[12px] font-semibold text-white hover:bg-au-danger-text disabled:opacity-50"
            >
              {busy ? "Deleting…" : confirmLabel}
            </motion.button>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
