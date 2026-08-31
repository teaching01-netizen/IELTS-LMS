import { useEffect, useRef } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Sparkles } from "lucide-react";
import { authoringMotion } from "./authoringMotion";

export interface SampleExamLoadDialogProps {
  open: boolean;
  busy: boolean;
  existingQuestionCount: number;
  onCancel: () => void;
  onConfirm: () => void;
}

export function SampleExamLoadDialog({
  open,
  busy,
  existingQuestionCount,
  onCancel,
  onConfirm,
}: SampleExamLoadDialogProps) {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const previousActiveRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!open) return;
    previousActiveRef.current = document.activeElement as HTMLElement | null;
    const frame = requestAnimationFrame(() => cancelRef.current?.focus());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) {
        event.preventDefault();
        onCancel();
        return;
      }
      if (event.key !== "Tab") return;
      const controls = Array.from(
        surfaceRef.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'
        ) ?? []
      );
      const first = controls[0];
      const last = controls.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKeyDown);
      previousActiveRef.current?.focus();
    };
  }, [busy, onCancel, open]);

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/28 p-5 backdrop-blur-[3px]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={authoringMotion.surface}
          role="dialog"
          aria-modal="true"
          aria-label="Load sample SAT"
        >
          <motion.div
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.99 }}
            transition={authoringMotion.settle}
            className="au-elevation-sheet w-full max-w-md rounded-[20px] border border-black/[0.08] bg-white p-5"
          >
            <div className="flex items-start gap-3">
              <span
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px] bg-au-accent-tint text-au-accent"
                aria-hidden="true"
              >
                <Sparkles size={17} />
              </span>
              <div>
                <h2 className="text-[15px] font-semibold tracking-[-0.018em] text-slate-950">
                  Load complete sample SAT?
                </h2>
                <p className="mt-1 text-[12px] leading-5 text-slate-500">
                  This loads 147 original SAT-style questions: 81 Reading & Writing and 66 Math,
                  including both adaptive branches and exactly two pretest items per module.
                </p>
              </div>
            </div>
            <div className="mt-4 rounded-[12px] bg-au-warning-tint px-3.5 py-3 text-[12px] leading-5 text-au-warning-text">
              {existingQuestionCount > 0
                ? `${existingQuestionCount} current draft question${existingQuestionCount === 1 ? "" : "s"} will be replaced. `
                : ""}
              Published versions are untouched. The operation is transactional: it either loads the
              entire sample or changes nothing.
            </div>
            <p className="mt-3 text-[11px] leading-5 text-slate-400">
              Sample items are original practice content, not copied College Board questions.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                ref={cancelRef}
                type="button"
                disabled={busy}
                onClick={onCancel}
                className="authoring-interactive min-h-10 rounded-[11px] px-4 text-[12px] font-semibold text-slate-600 hover:bg-black/[0.05] disabled:opacity-40"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={onConfirm}
                className="authoring-interactive min-h-10 rounded-[11px] bg-au-accent px-4 text-[12px] font-semibold text-white hover:bg-au-accent-hover active:bg-au-accent-active disabled:opacity-45"
              >
                {busy ? "Loading sample…" : "Load 147 questions"}
              </button>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
