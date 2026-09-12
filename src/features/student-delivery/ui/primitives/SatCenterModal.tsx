import { useContext, useEffect, useRef, type ReactNode, type RefObject } from "react";
import { Dialog } from "radix-ui";
import { X } from "lucide-react";
import { satOverlayZClass, type SatOverlayLayer } from "./satOverlayZ";
import { SatContrastContext } from "../reading/SatContrastContext";

export interface SatCenterModalProps {
  open: boolean;
  title: string;
  closeLabel: string;
  onClose: () => void;
  /** Focus target on close. Preferred over document.activeElement capture when the opener is stable. */
  returnFocusSelector?: string | undefined;
  triggerRef?: RefObject<HTMLElement | null> | undefined;
  /** Wider dialog for Help-style content. Defaults to 560px max. */
  wide?: boolean | undefined;
  /** Help-grade dialogs render a 28px title; default dialogs keep 17px. */
  titleSize?: "dialog" | "help" | undefined;
  /** Optional visually-hidden description for screen readers. */
  description?: string | undefined;
  /** Overlay layer from the z-contract. Defaults to helpModal. */
  layer?: SatOverlayLayer | undefined;
  /** Raw class escape hatch. Prefer `layer`. */
  overlayClassName?: string | undefined;
  contentClassName?: string | undefined;
  children: ReactNode;
}

/**
 * One centered-modal shell for SAT exam dialogs (Phase 0 foundation).
 *
 * Wraps Radix Dialog with the SAT focus contract: focus moves into the panel
 * on open, Escape closes, focus returns to the opener on every close path.
 * The dialog stays centered with internal scroll at every viewport size.
 * Timer keeps running and answers stay untouched — this component never
 * touches exam state, it only presents children.
 */
export function SatCenterModal(props: SatCenterModalProps) {
  const contrast = useContext(SatContrastContext);
  const closeRef = useRef<HTMLButtonElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const layer = props.layer ?? "helpModal";
  const layerClass = satOverlayZClass(layer);

  useEffect(() => {
    if (props.open) {
      openerRef.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      const frame = window.requestAnimationFrame(() => closeRef.current?.focus());
      return () => window.cancelAnimationFrame(frame);
    }
    return undefined;
  }, [props.open]);

  const focusBack = () => {
    if (props.returnFocusSelector) {
      document.querySelector<HTMLElement>(props.returnFocusSelector)?.focus();
      return;
    }
    if (props.triggerRef?.current?.isConnected) {
      props.triggerRef.current.focus();
      return;
    }
    if (openerRef.current?.isConnected) openerRef.current.focus();
  };

  const handleOpenChange = (open: boolean) => {
    if (!open) props.onClose();
  };

  return (
    <Dialog.Root open={props.open} onOpenChange={handleOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay
          className={
            props.overlayClassName ??
            `sat-dialog-backdrop fixed inset-0 ${layerClass} bg-[var(--sat-scrim)]`
          }
        />
        <Dialog.Content
          data-sat-contrast={contrast}
          aria-label={props.title}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            focusBack();
          }}
          className={
            props.contentClassName ??
            `sat-ui fixed left-1/2 top-1/2 ${layerClass} flex max-h-[min(740px,calc(100vh-80px))] ${props.wide ? "w-[min(650px,calc(100vw-32px))]" : "w-[min(560px,calc(100vw-32px))]"} -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-[10px] border border-[var(--sat-divider)] bg-[var(--sat-modal-bg)] text-[var(--sat-text)] shadow-[var(--sat-shadow-modal)]`
          }
        >
          <div className="flex min-h-14 shrink-0 items-center justify-between gap-3 border-b border-[var(--sat-divider-soft)] px-7">
            <Dialog.Title className={`truncate font-semibold ${props.titleSize === "help" ? "text-[28px] font-medium" : "text-[17px]"}`}>
              {props.title}
            </Dialog.Title>
            <button
              ref={closeRef}
              type="button"
              onClick={props.onClose}
              aria-label={props.closeLabel}
              data-sat-modal-close
              className="sat-touch-target sat-pressable grid shrink-0 place-items-center rounded-[6px] text-[var(--sat-text)] hover:bg-[var(--sat-surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-focus)]"
            >
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>
          {/* No id: radix-ui 1.4.3 treats an identified Description as
              author-managed and warns unless Content forwards
              aria-describedby (which it swallows). Unidentified, it
              auto-links and the warning stays silent (verified by probe). */}
          <Dialog.Description className="sr-only">
            {props.description ?? `${props.title} dialog`}
          </Dialog.Description>
          <div className="min-h-0 flex-1 overflow-y-auto">{props.children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
