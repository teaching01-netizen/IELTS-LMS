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
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/25 p-5 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={authoringMotion.surface}
          role="dialog"
          aria-modal="true"
          aria-label="Load sample SAT"
        >
          <motion.div
            initial={{ opacity: 0, y: 10, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.99 }}
            transition={authoringMotion.surface}
            className="w-full max-w-md rounded-[22px] border border-black/10 bg-white p-5 shadow-[0_24px_80px_rgba(0,0,0,0.22)]"
          >
            <div className="flex items-start gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#0071e3]/10 text-[#0071e3]">
                <Sparkles size={17} />
              </span>
              <div>
                <h2 className="text-[15px] font-semibold text-slate-950">
                  Load complete sample SAT?
                </h2>
                <p className="mt-1 text-[11px] leading-5 text-slate-500">
                  This loads 147 original SAT-style questions: 81 Reading & Writing and 66 Math,
                  including both adaptive branches and exactly two pretest items per module.
                </p>
              </div>
            </div>
            <div className="mt-4 rounded-xl bg-amber-50 px-3.5 py-3 text-[11px] leading-5 text-amber-900">
              {existingQuestionCount > 0
                ? `${existingQuestionCount} current draft question${existingQuestionCount === 1 ? "" : "s"} will be replaced. `
                : ""}
              Published versions are untouched. The operation is transactional: it either loads the
              entire sample or changes nothing.
            </div>
            <p className="mt-3 text-[10px] leading-5 text-slate-400">
              Sample items are original practice content, not copied College Board questions.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                ref={cancelRef}
                type="button"
                disabled={busy}
                onClick={onCancel}
                className="h-10 rounded-full px-4 text-[11px] font-semibold text-slate-600 hover:bg-black/[0.05] disabled:opacity-40"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={onConfirm}
                className="h-10 rounded-full bg-[#0071e3] px-4 text-[11px] font-semibold text-white hover:bg-[#0077ed] disabled:opacity-45"
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
