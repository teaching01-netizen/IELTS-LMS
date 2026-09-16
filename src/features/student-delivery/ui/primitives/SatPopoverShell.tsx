import { useEffect, useRef, type ReactNode, type RefObject } from "react";
import { AnimatePresence } from "motion/react";
import { X } from "lucide-react";
import { SAT_COPY } from "../../domain/satCopy";
import { useSatMediaQuery } from "../useSatMediaQuery";
import { SatPresenceSurface } from "../motion/SatPresenceSurface";

export const SAT_COMPACT_POPOVER_QUERY = "(max-width: 720px), (max-height: 560px)";

/** Focusable chrome: an outside press on one of these legitimately moves focus. */
const SAT_INTERACTIVE_SELECTOR =
  'button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

export interface SatPopoverShellProps {
  open: boolean;
  title: string;
  /**
   * Public id for the dialog root element. Triggers must point aria-controls
   * at THIS element (the role=dialog root), never at an inner scroll body —
   * and only while the dialog is mounted.
   */
  panelId?: string;
  /** Accessible name for the dialog (defaults to title). */
  ariaLabel?: string;
  triggerRef: RefObject<HTMLButtonElement | null>;
  onClose: () => void;
  /** Compact (modal) presentation anchor id for the close button. */
  closeLabel: string;
  /** Desktop anchored-panel positioning classes. */
  anchoredClassName: string;
  /** Compact modal-panel classes. */
  compactClassName: string;
  /** Backdrop z-index class for the compact modal presentation. */
  backdropClassName: string;
  children: ReactNode;
};

/**
 * One focus contract for every SAT overlay popover (Phase 0 foundation).
 *
 * Fixes the keyboard blocker where desktop popovers never moved focus, had
 * no close control, and stranded focus on outside-close:
 * - Focus moves INTO the panel on every open (desktop AND compact).
 * - Tab is contained while the compact modal presentation is open.
 * - Focus returns to the trigger on EVERY close path (Escape, outside,
 *   action button, unmount) — not just Escape.
 * - A real close control renders in both presentations.
 *
 * Compact viewports render a modal backdrop; wider viewports render an
 * anchored non-modal panel that still owns initial focus (focus-in without
 * a trap, matching a disclosure-dialog hybrid that stays keyboard-safe).
 */
export function SatPopoverShell(props: SatPopoverShellProps): React.JSX.Element | null {
  const compact = useSatMediaQuery(SAT_COMPACT_POPOVER_QUERY);
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = props.triggerRef;
  const titleId = useRef("sat-popover-" + Math.random().toString(36).slice(2)).current;
  const { open, onClose } = props;

  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => {
      panelRef.current?.querySelector<HTMLElement>("[data-sat-popover-close]")?.focus();
    });
    const returnFocus = (): void => {
      triggerRef.current?.focus();
    };
    const handleKeyDown = (event: KeyboardEvent): void => {
      // Yield when a higher-priority surface (e.g. the 5-minute warning,
      // Wave B R-16) already claimed this press in the capture phase.
      if (event.defaultPrevented) return;
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        returnFocus();
        return;
      }
      if (!compact || event.key !== "Tab" || !panelRef.current) return;
      const focusable = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), textarea:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    const handlePointerDown = (event: PointerEvent): void => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (panelRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      onClose();
      // Outside press on non-interactive chrome: the browser blurs the active
      // element to <body>, which strands a keyboard user. Presses on another
      // control keep their own focus; everything else returns to the trigger
      // (deferred past the native focus change, so it is not overwritten).
      const pressedInteractive =
        target instanceof HTMLElement && target.closest(SAT_INTERACTIVE_SELECTOR) !== null;
      if (pressedInteractive) return;
      const returnTarget = triggerRef.current;
      window.requestAnimationFrame(() => {
        if (returnTarget?.isConnected) returnTarget.focus();
      });
    };
    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("pointerdown", handlePointerDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [compact, open, onClose, triggerRef]);

  // Desktop (non-compact) panels are `fixed` against viewport offsets
  // under the header (see anchoredClassName callers + the index.css guard),
  // so they stay pinned regardless of which shell ancestor they mount under.
  const panel = (
    <SatPresenceSurface
      offsetY={compact ? 6 : 3}
      ref={panelRef}
      id={props.panelId}
      role="dialog"
      aria-modal={compact ? true : undefined}
      aria-label={props.ariaLabel ?? props.title}
      aria-labelledby={undefined}
      data-sat-popover-panel={compact ? "modal" : "anchored"}
      className={(compact ? props.compactClassName : props.anchoredClassName) + " sat-popover-anchored"}
    >
      <div className="flex min-h-11 items-center justify-between border-b border-[var(--sat-divider-soft)] px-5">
        <h2 id={titleId} className="text-[15px] font-semibold text-[var(--sat-text)]">
          {props.title}
        </h2>
        <button
          type="button"
          data-sat-popover-close
          onClick={() => {
            props.onClose();
            triggerRef.current?.focus();
          }}
          className="sat-touch-target sat-pressable grid place-items-center rounded-[6px] text-[var(--sat-text)] hover:bg-[var(--sat-surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-focus)]"
          aria-label={props.closeLabel}
        >
          <X className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>
      {props.children}
    </SatPresenceSurface>
  );

  return (
    <AnimatePresence initial={false}>
      {props.open ? (
        compact ? (
          <SatPresenceSurface
            motionKind="backdrop"
            className={props.backdropClassName}
            onPointerDown={(event) => {
              if (event.target === event.currentTarget) props.onClose();
            }}
          >
            {panel}
          </SatPresenceSurface>
        ) : (
          panel
        )
      ) : null}
    </AnimatePresence>
  );
}

export { SAT_COPY };
