import type { ReactNode } from "react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/src/components/ui/sheet";

export interface SpineQueueSheetProps {
  open: boolean;
  issuesMode: boolean;
  onOpenChange: (open: boolean) => void;
  onCaptureOpener: () => void;
  onRestoreOpener: () => void;
  children: ReactNode;
}

/**
 * Spine queue sheet (plan Phase 9.1): compact-viewport home for the question
 * queue / module issues pane. Focus capture/restore callbacks stay owned by
 * the workspace so opener restoration never forks from the legacy sheets.
 */
export function SpineQueueSheet({
  open,
  issuesMode,
  onOpenChange,
  onCaptureOpener,
  onRestoreOpener,
  children,
}: SpineQueueSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="left"
        onOpenAutoFocus={onCaptureOpener}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          onRestoreOpener();
        }}
        className="flex w-[min(92vw,380px)] max-w-[380px] flex-col gap-0 border-r p-0"
      >
        <SheetHeader className="sr-only">
          <SheetTitle>{issuesMode ? "Authoring issues" : "Question navigator"}</SheetTitle>
          <SheetDescription>
            {issuesMode
              ? "Review validation issues in the current SAT draft."
              : "Choose a SAT question to edit."}
          </SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
      </SheetContent>
    </Sheet>
  );
}
