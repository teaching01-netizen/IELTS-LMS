import { useEffect } from "react";
import { AnimatePresence, motion } from "motion/react";
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
          initial={{ opacity: 0, width: 0 }}
          animate={{ opacity: 1, width: 480 }}
          exit={{ opacity: 0, width: 0 }}
          transition={authoringMotion.surface}
          className="shrink-0 overflow-hidden border-l border-black/[0.06] bg-[#f5f5f7]"
          aria-label="Student question preview"
        >
          <div className="flex h-full w-[480px] flex-col">
            <header className="flex shrink-0 items-center justify-between border-b border-black/[0.06] bg-white/90 px-4 py-3 backdrop-blur-xl">
              <div>
                <p className="text-[12px] font-semibold text-slate-800">Student preview</p>
                <p className="mt-0.5 text-[9px] text-slate-400">
                  Live delivery renderer · updates as you author
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="flex h-8 w-8 items-center justify-center rounded-full text-slate-500 hover:bg-black/[0.05]"
                aria-label="Close preview"
              >
                <X size={15} />
              </button>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              <div className="overflow-hidden rounded-[18px] border border-black/[0.06] bg-white shadow-sm">
                <ExamQuestionRenderer question={question} disabled />
              </div>
            </div>
          </div>
        </motion.aside>
      ) : null}
    </AnimatePresence>
  );
}
