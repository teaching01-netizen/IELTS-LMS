import { useEffect, useRef, type ReactNode, type RefObject } from "react";
import { AnimatePresence } from "motion/react";
import { X } from "lucide-react";
import { SAT_COPY } from "../../domain/satCopy";
import { useSatMediaQuery } from "../useSatMediaQuery";
import { SatPresenceSurface } from "../motion/SatPresenceSurface";
import { SatExamOverlayPortal } from "../zoom/SatExamZoomContext";

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
  /**
   * Ask for the compact (sheet) presentation regardless of the viewport.
   *
   * One caller needs this: Display, whose anchored panel covers a fixed 320px of
   * the question pane. When the measured reading layout says what is left of the
   * question would no longer be readable, the panel presents itself as a sheet
   * even on a wide screen. It is a request to ADD compactness, never to remove
   * it — the viewport rule below still applies on its own.
   */
  forceCompact?: boolean | undefined;
  /**
   * Classes for the panel's scrollable body. Panels with a fixed header and a
   * scrolling middle (Display) pass their own flex/overflow classes here, so the
   * Close control cannot scroll out of reach on a short screen.
   */
  bodyClassName?: string | undefined;
  children: ReactNode;
}

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
 *
 * Presentation, though, is not the same thing as identity. A panel can change
 * presentation while it is open — a student raising Text size in Display can
 * walk it from anchored to sheet — and that must move only its classes, its
 * backdrop and its aria-modal: the dialog node itself stays, so the field the
 * student was in keeps focus, keeps its scroll position, and keeps its caret.
 * The open lifecycle (initial focus, Escape, outside press, Tab trap) therefore
 * depends on `open` alone, and reads the current presentation through a ref.
 */
export function SatPopoverShell(props: SatPopoverShellProps): React.JSX.Element | null {
  const viewportCompact = useSatMediaQuery(SAT_COMPACT_POPOVER_QUERY);
  const compact = viewportCompact || props.forceCompact === true;
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = props.triggerRef;
  const titleId = useRef("sat-popover-" + Math.random().toString(36).slice(2)).current;
  const { open, onClose } = props;
  // Read by the open lifecycle, never depended on by it: changing the text size
  // must not move focus back to Close mid-adjustment.
  const compactRef = useRef(compact);
  compactRef.current = compact;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

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
        onCloseRef.current();
        returnFocus();
        return;
      }
      if (!compactRef.current || event.key !== "Tab" || !panelRef.current) return;
      const panel = panelRef.current;
      const focusable = Array.from(
        panel.querySelectorAll<HTMLElement>(
          'button:not([disabled]), textarea:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;
      // A sheet that declares itself modal must hold focus even when focus
      // starts outside it. WebKit does not focus a control on mouse press — the
      // press blurs to <body> — so a student who clicks a button in the panel
      // can arrive here with nothing focused, and the wrap-around rules below
      // would never match. Pull the Tab back into the panel instead.
      if (!panel.contains(document.activeElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
        return;
      }
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
      onCloseRef.current();
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
  }, [open, triggerRef]);

  // Desktop (non-compact) panels are `fixed` against viewport offsets
  // under the header (see anchoredClassName callers + the index.css guard),
  // so they stay pinned regardless of which shell ancestor they mount under.
  // The panel is the stable node: only its classes change between presentations.
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
      {props.bodyClassName ? (
        <div className={props.bodyClassName} data-sat-popover-body="true">
          {props.children}
        </div>
      ) : (
        props.children
      )}
    </SatPresenceSurface>
  );

  return (
    <SatExamOverlayPortal>
    <AnimatePresence initial={false}>
      {props.open ? (
        /**
         * The presentation layer. It is the animated presence child in BOTH
         * presentations, so switching between them never reparents the panel:
         * the compact layer is a backdrop, and the anchored layer is
         * `display: contents` (see index.css) — a pass-through that paints
         * nothing, traps no pointer, and establishes no containing block, which
         * is what keeps the anchored panel's `fixed` offsets resolving against
         * the exam plane exactly as they did before.
         */
        <SatPresenceSurface
          key="sat-popover-layer"
          motionKind="backdrop"
          data-sat-popover-layer={compact ? "modal" : "anchored"}
          className={compact ? props.backdropClassName : "sat-popover-layer"}
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) props.onClose();
          }}
        >
          {panel}
        </SatPresenceSurface>
      ) : null}
    </AnimatePresence>
    </SatExamOverlayPortal>
  );
}

export { SAT_COPY };
