import { useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { Dialog } from 'radix-ui';
import { SatRoomSurface } from './room/SatRoomSurface';

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
            <div className="-mr-2 -mt-2 mb-1 flex justify-end">
              <button
                ref={closeButtonRef}
                type="button"
                className="sat-btn sat-btn--quiet sat-btn--icon sat-press"
                aria-label="Close student inspector"
                onClick={() => onOpenChange(false)}
              >
                <X size={18} aria-hidden="true" />
              </button>
            </div>
            {children}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    );
  }

  return (
    <SatRoomSurface as="aside" className="sat-room__inspector overflow-hidden" aria-label="Selected student inspector" data-inspector-open={open}>
      <div className="sat-room__inspector-panel">{children}</div>
    </SatRoomSurface>
  );
}
