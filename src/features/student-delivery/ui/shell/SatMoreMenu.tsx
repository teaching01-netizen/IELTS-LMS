import { useEffect, useRef } from "react";
import { CircleQuestionMark, Coffee, Keyboard, ScanLine } from "lucide-react";
import { SAT_COPY } from "../../domain/satCopy";
import { SAT_OVERLAY_Z, satOverlayZClass } from "../primitives/satOverlayZ";
import { useSatMediaQuery } from "../useSatMediaQuery";
import { SatExamOverlayPortal } from "../zoom/SatExamZoomContext";

export interface SatMoreMenuProps {
  open: boolean;
  blocked: boolean;
  lineReaderOn: boolean;
  lineReaderAvailable: boolean;
  breakAvailable: boolean;
  onSelectHelp: () => void;
  onSelectShortcuts: () => void;
  onToggleLineReader: () => void;
  onSelectBreak: () => void;
  onClose: () => void;
  returnFocusSelector?: string | undefined;
}

/**
 * Bluebook More utility center (Phase 1).
 *
 * Deliberately tiny trigger, subordinate to the exam. Secondary tools live
 * here instead of competing with the question: Help, Keyboard Shortcuts,
 * Line Reader, Unscheduled Break. (Display lives on the top bar only — one
 * entry per tool.) Opening the menu never touches answers or the timer.
 * While blocked (proctor pause) Help/Shortcuts stay reachable read-only;
 * Line Reader and Break rows disable with reason.
 */
export function SatMoreMenu(props: SatMoreMenuProps) {
  const compact = useSatMediaQuery("(max-width: 720px), (max-height: 560px)");
  const panelRef = useRef<HTMLDivElement>(null);
  const firstItemRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!props.open) return;
    const frame = window.requestAnimationFrame(() => firstItemRef.current?.focus());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) {
        event.preventDefault();
        props.onClose();
        return;
      }
      // Desktop (anchored, non-modal) panels never trap Tab — focus must
      // leave the menu, mirroring SatPopoverShell compact-only containment.
      if (!compact || event.key !== "Tab" || !panelRef.current) return;
      const items = Array.from(
        panelRef.current.querySelectorAll<HTMLButtonElement>("button:not([disabled])"),
      );
      if (items.length === 0) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (panelRef.current?.contains(target)) return;
      // The More trigger re-toggles; don't double-close on its pointerdown.
      if (target instanceof HTMLElement && target.closest('[data-sat-focus="topbar-more"]')) return;
      props.onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown, true);
      if (props.returnFocusSelector) {
        document.querySelector<HTMLElement>(props.returnFocusSelector)?.focus();
      } else {
        document.querySelector<HTMLElement>('[data-sat-focus="topbar-more"]')?.focus();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onClose identity churns; open + compact are the subscription keys.
  }, [props.open, compact]);

  if (!props.open) return null;

  const lineReaderDisabled = props.blocked || !props.lineReaderAvailable;
  const breakDisabled = props.blocked || !props.breakAvailable;

  const rowClass =
    "sat-touch-target sat-pressable flex w-full items-center gap-3 rounded-[6px] px-3 text-left text-[14px] font-medium text-[var(--sat-text)] hover:bg-[var(--sat-surface-hover)] disabled:cursor-not-allowed disabled:text-[var(--sat-disabled-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-focus)]";

  // Desktop dropdown: fixed-position, pinned under the top-right More
  // trigger (right gutter + header height). Fixed — not absolute — so the
  // panel position never depends on which grid ancestor it mounts under;
  // it cannot drop to the shell bottom next to the Next button.
  const panel = (
    <div
      ref={panelRef}
      role="menu"
      aria-label={SAT_COPY.more.triggerLabel}
      data-sat-popover-panel={compact ? "modal" : "anchored"}
      className={
        compact
          ? "sat-ui w-full max-w-[520px] rounded-t-[14px] border border-b-0 border-[var(--sat-divider)] bg-[var(--sat-surface)] p-2 shadow-[0_-18px_60px_rgba(0,0,0,0.22)]"
          : `sat-ui sat-popover-anchored fixed right-[calc(1rem+var(--student-safe-right))] top-[calc(var(--student-safe-top)+98px)] ${satOverlayZClass("moreMenu")} w-[280px] rounded-[8px] border border-[var(--sat-divider-soft)] bg-[var(--sat-surface)] p-2 shadow-[var(--sat-shadow-floating)]`
      }
    >
      <button ref={firstItemRef} type="button" role="menuitem" onClick={() => { props.onSelectHelp(); }} className={rowClass}>
        <CircleQuestionMark className="h-4 w-4 shrink-0" aria-hidden="true" />
        {SAT_COPY.more.help}
      </button>
      <button type="button" role="menuitem" onClick={() => { props.onSelectShortcuts(); }} className={rowClass}>
        <Keyboard className="h-4 w-4 shrink-0" aria-hidden="true" />
        {SAT_COPY.more.shortcuts}
      </button>
      <button
        type="button"
        role="menuitemcheckbox"
        aria-checked={props.lineReaderOn}
        disabled={lineReaderDisabled}
        title={props.blocked ? SAT_COPY.blocking.pausedBody : undefined}
        onClick={() => { props.onToggleLineReader(); }}
        className={rowClass}
      >
        <ScanLine className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="flex-1">{SAT_COPY.more.lineReader}</span>
        {props.lineReaderOn ? <span aria-hidden="true">\u2713</span> : null}
      </button>
      {props.breakAvailable ? (
        <button
          type="button"
          role="menuitem"
          disabled={breakDisabled}
          title={props.blocked ? SAT_COPY.blocking.pausedBody : undefined}
          onClick={() => { props.onSelectBreak(); }}
          className={rowClass}
        >
          <Coffee className="h-4 w-4 shrink-0" aria-hidden="true" />
          {SAT_COPY.more.unscheduledBreak}
        </button>
      ) : null}
    </div>
  );

  if (compact) {
    return (
      <SatExamOverlayPortal>
      <div
        className="fixed inset-0 flex items-end justify-center bg-black/20"
        style={{ zIndex: SAT_OVERLAY_Z.moreMenu }}
        onPointerDown={(event) => {
          if (event.target === event.currentTarget) props.onClose();
        }}
      >
        {panel}
      </div>
      </SatExamOverlayPortal>
    );
  }
  return <SatExamOverlayPortal>{panel}</SatExamOverlayPortal>;
}
