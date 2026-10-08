import { useState } from "react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/src/components/ui/sheet";
import { useExamQuery } from "../../api/examQueries";
import { requestAuthoringDraftOnEntry } from "../../application/authoringEntryIntent";
import { AuthoringConfirmDialog } from "../authoringPrimitives";
import { DeliverySettingsPanel } from "./DeliverySettingsPanel";

export interface ExamSettingsSheetProps {
  examId: string;
  open: boolean;
  onClose: () => void;
  /** Leaving for the full Questions workspace (only offered for a published-only exam). */
  onEditExam?: () => void;
}

/**
 * Exam settings edited IN PLACE: opens over whichever exam surface the author
 * is on (Questions, Responses, Student access), so changing timing never costs
 * the author their position, their scroll or their unsaved question text.
 * Closing with unsaved timing edits asks first.
 */
export function ExamSettingsSheet({ examId, open, onClose, onEditExam }: ExamSettingsSheetProps) {
  const examQuery = useExamQuery(examId);
  const [dirtyCount, setDirtyCount] = useState(0);
  const [confirmClose, setConfirmClose] = useState(false);

  const requestClose = () => {
    if (dirtyCount > 0) setConfirmClose(true);
    else onClose();
  };

  return (
    <>
      <Sheet open={open} onOpenChange={(next) => !next && requestClose()}>
        <SheetContent
          side="right"
          className="sat-product flex w-[min(96vw,720px)] max-w-[720px] flex-col gap-0 p-0 sm:max-w-[720px]"
          // Landing in a number field would select its value and invite an accidental edit; focus the dialog itself.
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            (event.currentTarget as HTMLElement).focus();
          }}
        >
          <SheetHeader className="border-b border-border px-6 py-4 text-left">
            <SheetTitle>Exam settings</SheetTitle>
            <SheetDescription>
              Module timing, breaks and adaptive routing. Each section saves on its own, and “Saved” appears only after
              the server confirms it.
            </SheetDescription>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-y-auto p-6">
            {examQuery.data ? (
              <DeliverySettingsPanel
                exam={examQuery.data}
                onDirtyCountChange={setDirtyCount}
                onEditExam={() => {
                  requestAuthoringDraftOnEntry(examId);
                  (onEditExam ?? onClose)();
                }}
              />
            ) : examQuery.error ? (
              <div role="alert" className="rounded-xl bg-destructive/10 p-4 text-sm text-destructive">
                The exam could not be loaded.{" "}
                <button type="button" className="min-h-11 font-semibold underline" onClick={() => void examQuery.refetch()}>
                  Try again
                </button>
              </div>
            ) : (
              <p role="status" className="text-sm text-muted-foreground">
                Loading settings…
              </p>
            )}
          </div>
          <div className="flex items-center justify-between gap-3 border-t border-border bg-card px-6 py-3">
            <p role="status" className="text-sm text-muted-foreground">
              {dirtyCount > 0 ? `${dirtyCount} ${dirtyCount === 1 ? "section has" : "sections have"} unsaved changes` : "All changes saved"}
            </p>
            <button
              type="button"
              onClick={requestClose}
              className="inline-flex min-h-11 items-center rounded-xl bg-muted px-4 text-sm font-semibold text-foreground hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Done
            </button>
          </div>
        </SheetContent>
      </Sheet>
      <AuthoringConfirmDialog
        open={confirmClose}
        title="Close with unsaved changes?"
        description="Your timing changes have not been saved. Closing now discards them."
        confirmLabel="Discard changes"
        destructive
        onCancel={() => setConfirmClose(false)}
        onConfirm={() => {
          setConfirmClose(false);
          setDirtyCount(0);
          onClose();
        }}
      />
    </>
  );
}
