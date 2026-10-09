import { type ReactNode, useEffect, useId, useRef } from 'react';
import { X } from 'lucide-react';
import { AlertDialog, Dialog } from 'radix-ui';

/**
 * Platform alert contract for the Digital SAT staff workspace: a centered
 * modal alert with title, explanation, Cancel, and one definitive action.
 *
 * Real browsers get the native Radix AlertDialog primitive (focus trap, scroll
 * lock, Escape to cancel). Environments without window.matchMedia get a static
 * equivalent with the same DOM contract. Backdrop tap never dismisses — an
 * alert demands an explicit answer.
 */
type SatConfirmDialogProps = {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  destructive?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

/**
 * Returns true when a creation form holds user-typed content worth confirming before discard. Whitespace-only counts as pristine.
 */
export function isSatCreationDirty(fields: { title: string; cohort?: string; exam?: string; start?: string; end?: string }): boolean {
  return fields.title.trim() !== "" || (fields.cohort ?? "").trim() !== "" || (fields.exam ?? "").trim() !== "" || (fields.start ?? "").trim() !== "" || (fields.end ?? "").trim() !== "";
}

// `sat-staff-root` marks portaled overlays as staff surfaces: they render
// outside SatRoot's DOM subtree but follow the same staff contract.
const OVERLAY_CLASS = 'sat-dialog-overlay sat-product sat-staff-root';
const CONFIRM_CLASS = 'sat-dialog sat-dialog-center sat-product sat-staff-root w-[calc(100vw-40px)] max-w-[420px] p-6';
const FORM_CLASS = 'sat-dialog sat-dialog-center sat-product sat-staff-root w-[calc(100vw-40px)] max-w-[520px] overflow-hidden';

const CANCEL_BUTTON_CLASS = 'sat-btn sat-btn--quiet sat-press';
const CONFIRM_BUTTON_CLASS = 'sat-btn sat-btn--primary sat-press';
const DESTRUCTIVE_BUTTON_CLASS = 'sat-btn sat-btn--danger sat-press';

function StaticConfirmDialog({
  title,
  description,
  confirmLabel,
  destructive,
  onCancel,
  onConfirm,
}: Omit<SatConfirmDialogProps, 'open'>) {
  // Focus the safe choice (Cancel), never the destructive confirm action.
  // useId-scoped ids: two stacked alerts never share one labelledby target.
  const cancelRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    cancelRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onCancel]);

  return (
    <div className={OVERLAY_CLASS} style={{ zIndex: 110 }}>
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        className={CONFIRM_CLASS}
      >
        <h2 id={titleId} className="text-[18px] font-semibold tracking-[-0.025em] text-[var(--sat-staff-text-primary,#1d1d1f)]">{title}</h2>
        <p id={descriptionId} className="mt-2 text-[14px] leading-5 text-[var(--sat-staff-text-secondary,#515154)]">{description}</p>
        <div className="mt-5 flex justify-end gap-2">
          <button ref={cancelRef} type="button" className={CANCEL_BUTTON_CLASS} onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className={destructive ? DESTRUCTIVE_BUTTON_CLASS : CONFIRM_BUTTON_CLASS}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export function SatConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  destructive = false,
  onCancel,
  onConfirm,
}: SatConfirmDialogProps) {
  if (!open) return null;
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return (
      <StaticConfirmDialog
        title={title}
        description={description}
        confirmLabel={confirmLabel}
        destructive={destructive}
        onCancel={onCancel}
        onConfirm={onConfirm}
      />
    );
  }
  return (
    <AlertDialog.Root open={open} onOpenChange={(next) => { if (!next) onCancel(); }}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className={OVERLAY_CLASS} />
        <AlertDialog.Content className={CONFIRM_CLASS}>
          <AlertDialog.Title className="text-[18px] font-semibold tracking-[-0.025em] text-[var(--sat-staff-text-primary,#1d1d1f)]">{title}</AlertDialog.Title>
          <AlertDialog.Description className="mt-2 text-[14px] leading-5 text-[var(--sat-staff-text-secondary,#515154)]">{description}</AlertDialog.Description>
          <div className="mt-5 flex justify-end gap-2">
            <AlertDialog.Cancel asChild>
              <button type="button" className={CANCEL_BUTTON_CLASS}>Cancel</button>
            </AlertDialog.Cancel>
            <AlertDialog.Action asChild>
              <button
                type="button"
                className={destructive ? DESTRUCTIVE_BUTTON_CLASS : CONFIRM_BUTTON_CLASS}
                onClick={onConfirm}
              >
                {confirmLabel}
              </button>
            </AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}

/**
 * Form sheet contract: a centered modal card on desktop that docks to the
 * bottom edge as a sheet on compact widths. Real browsers get the native Radix
 * Dialog primitive; constrained environments get a static equivalent.
 */
type SatFormDialogProps = {
  open: boolean;
  eyebrow: string;
  title: string;
  onClose: () => void;
  children: ReactNode;
};

const CLOSE_BUTTON_CLASS = 'sat-btn sat-btn--quiet sat-btn--icon sat-press -mr-2 -mt-2 rounded-full';

function StaticFormDialog({ eyebrow, title, onClose, children }: Omit<SatFormDialogProps, 'open'>) {
  // useId-scoped title id: two stacked form sheets never collide.
  const titleId = useId();
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div className={OVERLAY_CLASS}>
      <div role="dialog" aria-modal="true" aria-labelledby={titleId} className={FORM_CLASS}>
        <div className="flex items-center justify-between px-5 pb-2 pt-4">
          <div>
            <p className="text-[14px] font-semibold uppercase tracking-[0.12em] text-[var(--sat-staff-text-tertiary,#6e6e73)]">{eyebrow}</p>
            <h2 id={titleId} className="mt-1 text-[18px] font-semibold tracking-[-0.025em] text-[var(--sat-staff-text-primary,#1d1d1f)]">{title}</h2>
          </div>
          <button type="button" onClick={onClose} className={CLOSE_BUTTON_CLASS} aria-label="Close">
            <X size={16} aria-hidden="true" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function SatFormDialog({ open, eyebrow, title, onClose, children }: SatFormDialogProps) {
  if (!open) return null;
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return <StaticFormDialog eyebrow={eyebrow} title={title} onClose={onClose}>{children}</StaticFormDialog>;
  }
  return (
    <Dialog.Root open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className={OVERLAY_CLASS} />
        <Dialog.Content className={FORM_CLASS}>
          <div className="flex items-center justify-between px-5 pb-2 pt-4">
            <div>
              <p className="text-[14px] font-semibold uppercase tracking-[0.12em] text-[var(--sat-staff-text-tertiary,#6e6e73)]">{eyebrow}</p>
              <Dialog.Title asChild>
                <h2 className="mt-1 text-[18px] font-semibold tracking-[-0.025em] text-[var(--sat-staff-text-primary,#1d1d1f)]">{title}</h2>
              </Dialog.Title>
            </div>
            <Dialog.Close asChild>
              <button type="button" className={CLOSE_BUTTON_CLASS} aria-label="Close">
                <X size={16} aria-hidden="true" />
              </button>
            </Dialog.Close>
          </div>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
