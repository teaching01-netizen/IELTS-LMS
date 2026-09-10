import type { RefObject } from "react";
import type { StructuredContent } from "../../../exam-authoring/api/assessmentContracts";
import { StructuredContentRenderer } from "../../../exam-rendering/api/structuredContent";
import { SatPopoverShell } from "../primitives/SatPopoverShell";

export interface SatDirectionsPopoverProps {
  id: string;
  open: boolean;
  title: string;
  instructions: StructuredContent | null;
  triggerRef: RefObject<HTMLButtonElement | null>;
  onClose: () => void;
}

/**
 * Module directions reference popover (focus contract via SatPopoverShell).
 *
 * The trigger labels this "Directions" (module reference), distinct from the
 * pre-module Directions gate screen — same noun, different context: this
 * popover never starts a timer.
 */
export function SatDirectionsPopover(props: SatDirectionsPopoverProps) {
  return (
    <SatPopoverShell
      open={props.open}
      title="Directions"
      ariaLabel="Directions"
      triggerRef={props.triggerRef}
      onClose={props.onClose}
      closeLabel="Close directions"
      anchoredClassName="sat-ui sat-popover-anchored fixed left-[calc(1rem+var(--student-safe-left))] top-[calc(var(--student-safe-top)+98px)] z-[62] w-[min(440px,calc(100vw-32px))] overflow-hidden rounded-[8px] border border-[var(--sat-divider-soft)] bg-[var(--sat-surface)] shadow-[var(--sat-shadow-floating)]"
      compactClassName="sat-ui flex max-h-[calc(100dvh-32px-var(--student-safe-top)-var(--student-safe-bottom))] w-full max-w-[680px] flex-col overflow-hidden rounded-[10px] border border-[var(--sat-divider)] bg-[var(--sat-surface)] shadow-[var(--sat-shadow-floating)]"
      backdropClassName="sat-dialog-backdrop fixed inset-0 z-[79] grid place-items-center bg-black/20"
    >
      <div
        id={props.id}
        className="min-h-0 max-h-[56dvh] overflow-y-auto px-5 py-4 text-[15px] leading-7 text-[var(--sat-text)]"
      >
        {props.instructions ? (
          <StructuredContentRenderer content={props.instructions} />
        ) : (
          <p>
            Read each question carefully and choose the best answer. You may return to questions in
            this module until you submit it.
          </p>
        )}
      </div>
    </SatPopoverShell>
  );
}
