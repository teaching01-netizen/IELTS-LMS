import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useRef } from "react";
import { X } from "lucide-react";
import type { QuestionRevision } from "../contracts/assessment";
import { ExamQuestionRenderer } from "../../exam-rendering/api/ExamQuestionRenderer";
import { authoringMotion } from "./authoringMotion";
import { Dialog as DialogPrimitive } from "radix-ui";
import { restoreAuthoringFocus } from "./authoringPrimitives";

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
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  return (
    <DialogPrimitive.Root
      modal={false}
      open={open && Boolean(question)}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
    >
      <AnimatePresence initial={false}>
        {open && question ? (
          <DialogPrimitive.Content
            asChild
            onOpenAutoFocus={() => {
              if (document.activeElement instanceof HTMLElement) {
                restoreFocusRef.current = document.activeElement;
              }
            }}
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              const opener = restoreFocusRef.current;
              restoreFocusRef.current = null;
              restoreAuthoringFocus(opener);
            }}
          >
            <motion.aside
              role="complementary"
              aria-label="Student question preview"
              initial={{ opacity: reduceMotion ? 1 : 0, x: reduceMotion ? 0 : 16 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: reduceMotion ? 1 : 0, x: reduceMotion ? 0 : 16 }}
              transition={reduceMotion ? { duration: 0 } : authoringMotion.surface}
              className="authoring-question-preview shrink-0 overflow-hidden border-l border-au-separator bg-au-canvas"
            >
              <div className="authoring-question-preview__inner flex h-full w-full min-w-0 flex-col">
                <DialogPrimitive.Title className="sr-only">Student question preview</DialogPrimitive.Title>
                <DialogPrimitive.Description className="sr-only">Live preview of the question as students will see it.</DialogPrimitive.Description>
                <header className="flex shrink-0 items-center justify-between border-b border-au-separator bg-au-surface px-4 py-3 authoring-glass">
                  <div>
                    <p className="text-[12px] font-semibold text-slate-800">Student preview</p>
                    <p className="mt-0.5 text-[11px] text-slate-400">
                      Live delivery renderer · updates as you author
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={onClose}
                    className="authoring-interactive flex h-8 w-8 items-center justify-center rounded-full text-slate-500 hover:bg-au-fill"
                    aria-label="Close preview"
                  >
                    <X size={15} aria-hidden="true" />
                  </button>
                </header>
                <div className="min-h-0 flex-1 overflow-y-auto p-3">
                  <div className="au-elevation-card overflow-hidden rounded-[16px] border border-au-separator bg-au-surface">
                    <ExamQuestionRenderer question={question} disabled />
                  </div>
                </div>
              </div>
            </motion.aside>
          </DialogPrimitive.Content>
        ) : null}
      </AnimatePresence>
    </DialogPrimitive.Root>
  );
}
