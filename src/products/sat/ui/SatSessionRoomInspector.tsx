import { useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { Dialog } from 'radix-ui';

/**
 * The selected-student inspector. Docked beside the run sheet when the room is
 * wide enough for three readable panes; otherwise an accessible side sheet
 * opened from the roster, which returns focus to the row that opened it.
 * Selection lives in the route, so a layout change never loses the student.
 */
export function SatSessionRoomInspector({
  open,
  docked,
  onOpenChange,
  restoreFocusTarget,
  children,
}: {
  open: boolean;
  docked: boolean;
  onOpenChange: (open: boolean) => void;
  restoreFocusTarget: () => HTMLElement | null;
  children: ReactNode;
}) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const content = (
    <>
      <button
        ref={closeButtonRef}
        type="button"
        className="sat-room__inspector-close"
        aria-label="Close student inspector"
        onClick={() => onOpenChange(false)}
      >
        <X size={17} aria-hidden="true" />
      </button>
      {children}
    </>
  );

  if (!docked) {
    return (
      <Dialog.Root open={open} onOpenChange={onOpenChange}>
        <Dialog.Portal>
          <Dialog.Overlay className="sat-room__inspector-dialog-overlay" />
          <Dialog.Content
            className="sat-room__inspector-dialog sat-product sat-staff-root"
            aria-label="Selected student inspector"
            aria-modal="true"
            data-inspector-open="true"
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              closeButtonRef.current?.focus();
            }}
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              const trigger = restoreFocusTarget();
              if (trigger?.isConnected) trigger.focus();
              else document.querySelector<HTMLElement>('.sat-room__roster [role="listbox"]')?.focus();
            }}
          >
            <Dialog.Title className="sr-only">Selected student inspector</Dialog.Title>
            <Dialog.Description className="sr-only">Inspect the selected student's room, timing, and attention details.</Dialog.Description>
            {content}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    );
  }

  return (
    <aside className="sat-room__inspector" aria-label="Selected student inspector" data-inspector-open={open}>
      <div className="sat-room__inspector-panel">{content}</div>
    </aside>
  );
}
