import { useEffect, useRef, type RefObject } from "react";
import { X } from "lucide-react";
import { AnimatePresence } from "motion/react";
import type { StructuredContent } from "../../../exam-authoring/api/assessmentContracts";
import { StructuredContentRenderer } from "../../../exam-rendering/api/structuredContent";
import { useSatMediaQuery } from "../useSatMediaQuery";
import { SatPresenceSurface } from "../motion/SatPresenceSurface";

const COMPACT_POPOVER_QUERY = "(max-width: 720px), (max-height: 560px)";

export interface SatDirectionsPopoverProps {
  id: string;
  open: boolean;
  title: string;
  instructions: StructuredContent | null;
  triggerRef: RefObject<HTMLButtonElement | null>;
  onClose: () => void;
}

export function SatDirectionsPopover(props: SatDirectionsPopoverProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const compact = useSatMediaQuery(COMPACT_POPOVER_QUERY);
  const titleId = `${props.id}-title`;

  useEffect(() => {
    if (!props.open) return;
    const frame = window.requestAnimationFrame(() => {
      if (compact)
        panelRef.current?.querySelector<HTMLElement>("[data-sat-directions-close]")?.focus();
    });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      props.onClose();
      props.triggerRef.current?.focus();
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (panelRef.current?.contains(target) || props.triggerRef.current?.contains(target)) return;
      props.onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [compact, props.open, props.onClose, props.triggerRef]);

  const panel = (
    <SatPresenceSurface
      offsetY={compact ? 6 : 3}
      ref={panelRef}
      id={props.id}
      role="dialog"
      aria-modal={compact ? true : undefined}
      aria-labelledby={titleId}
      tabIndex={compact ? -1 : 0}
      className={
        compact
          ? "sat-ui flex max-h-[calc(100dvh-32px-var(--student-safe-top)-var(--student-safe-bottom))] w-full max-w-[680px] flex-col overflow-hidden rounded-[10px] border border-[var(--sat-divider)] bg-[var(--sat-surface)] shadow-[0_24px_70px_rgba(0,0,0,0.24)]"
          : "sat-ui absolute left-0 top-[calc(100%+8px)] z-[62] w-[min(440px,calc(100vw-32px))] overflow-hidden rounded-[8px] border border-[var(--sat-divider-soft)] bg-[var(--sat-surface)] shadow-[0_18px_50px_rgba(0,0,0,0.16)]"
      }
    >
      <div className="flex min-h-11 items-center justify-between border-b border-[var(--sat-divider-soft)] px-5">
        <h2 id={titleId} className="text-[15px] font-semibold text-[var(--sat-text)]">
          Directions
        </h2>
        {compact ? (
          <button
            type="button"
            data-sat-directions-close
            onClick={() => {
              props.onClose();
              props.triggerRef.current?.focus();
            }}
            className="sat-touch-target sat-pressable grid place-items-center rounded-[6px] text-[var(--sat-text)] hover:bg-[var(--sat-surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-focus)]"
            aria-label="Close directions"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        ) : null}
      </div>
      <div className="min-h-0 max-h-[56dvh] overflow-y-auto px-5 py-4 text-[15px] leading-7 text-[var(--sat-text)]">
        {props.instructions ? (
          <StructuredContentRenderer content={props.instructions} />
        ) : (
          <p>
            Read each question carefully and choose the best answer. You may return to questions in
            this module until you submit it.
          </p>
        )}
      </div>
    </SatPresenceSurface>
  );

  return (
    <AnimatePresence initial={false}>
      {props.open ? (
        compact ? (
          <SatPresenceSurface
            motionKind="backdrop"
            className="sat-dialog-backdrop fixed inset-0 z-[79] grid place-items-center bg-black/20"
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
