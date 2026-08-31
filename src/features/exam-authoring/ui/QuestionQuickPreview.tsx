import { useEffect } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { X } from "lucide-react";
import type { QuestionRevision } from "../contracts/assessment";
import { ExamQuestionRenderer } from "../../exam-rendering/api/ExamQuestionRenderer";
import { authoringMotion } from "./authoringMotion";

export function QuestionQuickPreview({
  open,
  question,
  onClose,
}: {
  open: boolean;
  question: QuestionRevision | null;
  onClose: () => void;
}) {
  const reduceMotion = useReducedMotion();
  useEffect(() => {
    if (!open) return;
    const listener = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [onClose, open]);

  return (
    <AnimatePresence initial={false}>
      {open && question ? (
        <motion.aside
          initial={{ opacity: reduceMotion ? 1 : 0, width: reduceMotion ? 480 : 0 }}
          animate={{ opacity: 1, width: 480 }}
          exit={{ opacity: reduceMotion ? 0 : 1, width: 0 }}
          transition={authoringMotion.surface}
          className="shrink-0 overflow-hidden border-l border-au-separator bg-au-canvas"
          aria-label="Student question preview"
        >
          <div className="flex h-full w-[480px] flex-col">
            <header className="flex shrink-0 items-center justify-between border-b border-black/[0.055] bg-white/90 px-4 py-3 backdrop-blur-xl">
              <div>
                <p className="text-[12px] font-semibold text-slate-800">Student preview</p>
                <p className="mt-0.5 text-[11px] text-slate-400">
                  Live delivery renderer · updates as you author
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="authoring-interactive flex h-8 w-8 items-center justify-center rounded-full text-slate-500 hover:bg-black/[0.05]"
                aria-label="Close preview"
              >
                <X size={15} aria-hidden="true" />
              </button>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              <div className="overflow-hidden rounded-[16px] border border-au-separator bg-white shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
                <ExamQuestionRenderer question={question} disabled />
              </div>
            </div>
          </div>
        </motion.aside>
      ) : null}
    </AnimatePresence>
  );
}
