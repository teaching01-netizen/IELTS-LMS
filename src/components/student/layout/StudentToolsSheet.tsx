import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';

interface StudentToolsSheetProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly children: ReactNode;
}

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function getFocusableElements(dialog: HTMLDialogElement): HTMLElement[] {
  return Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (element) =>
      !element.hidden &&
      element.getAttribute('aria-hidden') !== 'true' &&
      getComputedStyle(element).display !== 'none' &&
      getComputedStyle(element).visibility !== 'hidden',
  );
}

export function StudentToolsSheet({ open, onClose, children }: StudentToolsSheetProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const onCloseRef = useRef(onClose);
  const previousActiveElementRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!open || !dialog) {
      return;
    }

    previousActiveElementRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    if (!dialog.open) {
      if (typeof dialog.showModal === 'function') {
        dialog.showModal();
      } else {
        dialog.setAttribute('open', '');
      }
    }

    const focusFirstElement = () => {
      getFocusableElements(dialog)[0]?.focus();
    };
    queueMicrotask(focusFirstElement);

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();

        return;
      }

      if (event.key !== 'Tab') {
        return;
      }

      const focusableElements = getFocusableElements(dialog);
      if (focusableElements.length === 0) {
        event.preventDefault();
        return;
      }

      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];
      if (!firstElement || !lastElement) {
        return;
      }
      if (!event.shiftKey && document.activeElement === lastElement) {
        event.preventDefault();
        firstElement.focus();
      } else if (event.shiftKey && document.activeElement === firstElement) {
        event.preventDefault();
        lastElement.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      if (dialog.open) {
        if (typeof dialog.close === 'function') {
          dialog.close();
        } else {
          dialog.removeAttribute('open');
        }
      }
      previousActiveElementRef.current?.focus();
    };
  }, [open]);


  if (!open) {
    return null;
  }

  return (
    <dialog
      ref={dialogRef}
      // HIG presentation: a bottom sheet on phones, a centred form sheet on
      // iPad widths. `top-auto` matters: a modal <dialog> keeps the UA's
      // `top: 0`, which pinned the "bottom" sheet to the top edge.
      className="student-tools-sheet fixed inset-x-0 top-auto bottom-0 m-0 max-h-[min(calc(var(--student-vh,1vh)*80),40rem)] w-full max-w-none overflow-y-auto rounded-t-2xl border border-gray-200 bg-white p-4 pb-[max(1rem,var(--student-safe-bottom))] shadow-xl backdrop:bg-gray-900/50 min-[600px]:inset-0 min-[600px]:m-auto min-[600px]:h-fit min-[600px]:w-[min(30rem,calc(100vw-2rem))] min-[600px]:rounded-2xl min-[600px]:pb-4"
      aria-labelledby="student-tools-title"
      aria-modal="true"
      data-testid="student-tools-sheet"
      onCancel={(event) => {
        event.preventDefault();
        onCloseRef.current();
      }}
    >
      <div className="mb-3 flex items-center justify-between">
        <h2 id="student-tools-title" className="text-[length:var(--student-control-font-size)] font-bold text-gray-900">
          Exam tools
        </h2>
        <button
          type="button"
          className="student-touch-target flex items-center justify-center rounded-full bg-gray-100 text-gray-700 hover:bg-gray-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
          aria-label="Close exam tools"
          onClick={onClose}
        >
          <X size={20} aria-hidden="true" />
        </button>
      </div>
      <div className="grid gap-2">{children}</div>
    </dialog>
  );
}
