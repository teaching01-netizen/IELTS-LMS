import { useEffect, useId, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { AlertDialog as AlertDialogPrimitive, Dialog as DialogPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";

/** Focus an opener after Radix has finished unmounting an overlay. React may
 * briefly disconnect and recreate a surrounding control during that commit. */
export function restoreAuthoringFocus(element: HTMLElement | null): void {
  if (!element) return;
  const focus = () => {
    if (element.isConnected) element.focus();
  };
  focus();
  if (document.activeElement !== element && typeof window !== "undefined") {
    if (typeof window.requestAnimationFrame === "function") {
      window.requestAnimationFrame(focus);
    } else {
      window.setTimeout(focus, 0);
    }
  }
}

export interface AuthoringDialogProps {
  open: boolean;
  title: string;
  /**
   * Accessible name for the dialog, when the visible title is not a usable
   * name (a headerless palette) or names something else than the region does.
   */
  ariaLabel?: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
  showHeader?: boolean;
  showCloseButton?: boolean;
  closeDisabled?: boolean;
  dismissOnBackdrop?: boolean;
}

/**
 * Controlled authoring dialog built on Radix Dialog. The title is always
 * present in the accessibility tree, even when a caller supplies custom
 * chrome for a larger import surface.
 */
export function AuthoringDialog({
  open,
  title,
  ariaLabel,
  description,
  onClose,
  children,
  className,
  contentClassName,
  showHeader = true,
  showCloseButton = true,
  closeDisabled = false,
  dismissOnBackdrop = true,
}: AuthoringDialogProps) {
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const accessibleLabelId = useId();
  const accessibleNameProps = ariaLabel ? { "aria-labelledby": accessibleLabelId } : {};
  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !closeDisabled) onClose();
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="authoring-dialog-overlay" />
        <DialogPrimitive.Content
          className={cn(
            "sat-product authoring-dialog-content w-[calc(100vw-2rem)] max-w-[32rem]",
            contentClassName
          )}
          aria-label={ariaLabel}
          {...accessibleNameProps}
          onOpenAutoFocus={(event) => {
            if (!restoreFocusRef.current && document.activeElement instanceof HTMLElement) {
              restoreFocusRef.current = document.activeElement;
            }
            const content = event.currentTarget;
            if (!(content instanceof HTMLElement)) return;
            const initialFocus = content.querySelector<HTMLElement>(
              "[data-dialog-initial-focus]"
            );
            if (initialFocus) {
              event.preventDefault();
              initialFocus.focus();
            }
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            const opener = restoreFocusRef.current;
            restoreFocusRef.current = null;
            restoreAuthoringFocus(opener);
          }}
          onPointerDownOutside={(event) => {
            if (closeDisabled || !dismissOnBackdrop) event.preventDefault();
          }}
          onEscapeKeyDown={(event) => {
            if (closeDisabled) event.preventDefault();
          }}
        >
          {ariaLabel ? <span id={accessibleLabelId} className="sr-only">{ariaLabel}</span> : null}
          {showHeader ? (
            <header className={cn("authoring-dialog-header", className)}>
              <div className="min-w-0 flex-1">
                <DialogPrimitive.Title className="authoring-dialog-title">
                  {title}
                </DialogPrimitive.Title>
                <DialogPrimitive.Description
                  className={cn("authoring-dialog-description", !description && "sr-only")}
                >
                  {description ?? `${title} dialog`}
                </DialogPrimitive.Description>
              </div>
              {showCloseButton ? (
                <DialogPrimitive.Close asChild>
                  <button
                    type="button"
                    disabled={closeDisabled}
                    className="authoring-icon-button"
                    aria-label={`Close ${title}`}
                  >
                    <X size={16} aria-hidden="true" />
                  </button>
                </DialogPrimitive.Close>
              ) : null}
            </header>
          ) : (
            <>
              <DialogPrimitive.Title className="sr-only">{title}</DialogPrimitive.Title>
              <DialogPrimitive.Description className="sr-only">
                {description ?? `${title} dialog`}
              </DialogPrimitive.Description>
            </>
          )}
          {children}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export interface AuthoringConfirmDialogProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
  destructive?: boolean;
  busy?: boolean;
}

export function AuthoringConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  onCancel,
  onConfirm,
  destructive = false,
  busy = false,
}: AuthoringConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  return (
    <AlertDialogPrimitive.Root
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !busy) onCancel();
      }}
    >
      <AlertDialogPrimitive.Portal>
        <AlertDialogPrimitive.Overlay className="authoring-dialog-overlay" />
        <AlertDialogPrimitive.Content
          className="sat-product authoring-confirm-dialog"
          onOpenAutoFocus={(event) => {
            if (!restoreFocusRef.current && document.activeElement instanceof HTMLElement) {
              restoreFocusRef.current = document.activeElement;
            }
            event.preventDefault();
            cancelRef.current?.focus();
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            const opener = restoreFocusRef.current;
            restoreFocusRef.current = null;
            restoreAuthoringFocus(opener);
          }}
          onEscapeKeyDown={(event) => {
            if (busy) event.preventDefault();
          }}
        >
          <AlertDialogPrimitive.Title className="authoring-dialog-title">
            {title}
          </AlertDialogPrimitive.Title>
          <AlertDialogPrimitive.Description className="authoring-dialog-description mt-2">
            {description}
          </AlertDialogPrimitive.Description>
          <div className="mt-5 flex justify-end gap-2">
            <AlertDialogPrimitive.Cancel asChild>
              <button
                ref={cancelRef}
                type="button"
                disabled={busy}
                className="authoring-button authoring-button--quiet"
              >
                Cancel
              </button>
            </AlertDialogPrimitive.Cancel>
            <AlertDialogPrimitive.Action asChild>
              <button
                type="button"
                disabled={busy}
                onClick={(event) => {
                  // AlertDialog.Action is a Dialog.Close. Keep the alert open
                  // while an async destructive operation is pending; callers
                  // close it only after the operation has succeeded.
                  event.preventDefault();
                  onConfirm();
                }}
                className={cn(
                  "authoring-button",
                  destructive ? "authoring-button--danger" : "authoring-button--primary"
                )}
              >
                {busy ? "Working…" : confirmLabel}
              </button>
            </AlertDialogPrimitive.Action>
          </div>
        </AlertDialogPrimitive.Content>
      </AlertDialogPrimitive.Portal>
    </AlertDialogPrimitive.Root>
  );
}

export function AuthoringButton({
  className,
  variant = "quiet",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "quiet" | "danger" | "secondary";
}) {
  return (
    <button
      {...props}
      className={cn("authoring-button", `authoring-button--${variant}`, className)}
    />
  );
}

export function AuthoringIconButton({
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button {...props} className={cn("authoring-icon-button", className)} />;
}

export function AuthoringDisclosure({
  label,
  hint,
  children,
  defaultOpen = false,
  className,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  defaultOpen?: boolean;
  className?: string;
}) {
  const disclosureRef = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    if (defaultOpen && disclosureRef.current) disclosureRef.current.open = true;
  }, [defaultOpen]);

  return (
    <details ref={disclosureRef} className={cn("authoring-disclosure", className)}>
      <summary>
        <span>{label}</span>
        {hint ? <span className="authoring-disclosure__hint">{hint}</span> : null}
      </summary>
      <div className="authoring-disclosure__content">{children}</div>
    </details>
  );
}
