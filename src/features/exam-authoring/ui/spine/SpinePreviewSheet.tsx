import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/src/components/ui/sheet";
import type { QuestionRevision } from "../../contracts/assessment";
import type { QuestionSaveStatus } from "../../hooks/useQuestionAutosave";
import { ExamQuestionRenderer } from "../../../exam-rendering/api/ExamQuestionRenderer";

export interface SpinePreviewSheetProps {
  open: boolean;
  question: QuestionRevision | null;
  /** Current save state: drives the unsaved-vs-saved revision label. */
  saveStatus?: QuestionSaveStatus;
  onOpenChange: (open: boolean) => void;
  onCaptureOpener: () => void;
  onRestoreOpener: () => void;
}

/**
 * Spine student preview sheet (plan Phase 9.1): the same delivery renderer
 * (`ExamQuestionRenderer`, `--sat-*` parity) surfaced in the spine branch.
 * The legacy inline `QuestionQuickPreview` panel cannot dock into the
 * single-column spine, so preview is a right sheet here with identical
 * focus capture/restore semantics.
 */
export function SpinePreviewSheet({
  open,
  question,
  saveStatus = "saved",
  onOpenChange,
  onCaptureOpener,
  onRestoreOpener,
}: SpinePreviewSheetProps) {
  return (
    <Sheet open={open && Boolean(question)} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        onOpenAutoFocus={onCaptureOpener}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          onRestoreOpener();
        }}
        className="flex w-[min(94vw,560px)] max-w-[560px] flex-col gap-0 p-0"
      >
        <SheetHeader className="border-b border-border px-4 py-3 text-left">
          <SheetTitle className="text-xs font-semibold">Student preview</SheetTitle>
          <SheetDescription className="text-[11px]">
            {saveStatus === "saved"
              ? "Saved draft revision · matches the full SAT preview"
              : "Local unsaved edits included · save to update the full SAT preview"}
          </SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {question ? (
            <div className="overflow-hidden rounded-lg border border-border bg-card">
              <ExamQuestionRenderer question={question} disabled />
            </div>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
