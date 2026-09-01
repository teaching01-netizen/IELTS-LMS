import { useEffect, useId, useRef, useState } from "react";
import { Bookmark, MapPin, X } from "lucide-react";
import { AnimatePresence } from "motion/react";
import type { SatQuestionNavigationItem } from "../../domain/satSelectors";
import { SatPresenceSurface } from "../motion/SatPresenceSurface";

export interface SatQuestionNavigatorProps {
  id?: string;
  open: boolean;
  sectionLabel: string;
  items: readonly SatQuestionNavigationItem[];
  returnFocusId?: string;
  onSelectQuestion: (index: number) => void;
  onReviewModule: () => void;
  onClose: () => void;
}

const COMPACT_NAVIGATOR_QUERY = "(max-width: 639px), (max-height: 560px)";

function compactNavigator(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia(COMPACT_NAVIGATOR_QUERY).matches
    : false;
}

export function SatQuestionNavigator(props: SatQuestionNavigatorProps) {
  const { open, onClose, returnFocusId } = props;
  const dialogRef = useRef<HTMLDivElement>(null);
  const generatedId = useId();
  const titleId = useId();
  const navigatorId = props.id ?? generatedId;
  const [compact, setCompact] = useState(compactNavigator);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const media = window.matchMedia(COMPACT_NAVIGATOR_QUERY);
    const update = () => setCompact(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (!open) return;
    const opener = returnFocusId
      ? document.getElementById(returnFocusId)
      : document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const frame = window.requestAnimationFrame(() => {
      dialogRef.current
        ?.querySelector<HTMLElement>("[data-sat-navigator-current], [data-sat-navigator-close]")
        ?.focus();
    });
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
    };
    const handlePointerDown = (event: PointerEvent) => {
      if (!dialogRef.current) return;
      const target = event.target;
      if (!(target instanceof Node) || dialogRef.current.contains(target)) return;
      if (opener instanceof HTMLElement && opener.contains(target)) return;
      onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("pointerdown", handlePointerDown, true);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("pointerdown", handlePointerDown, true);
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, [compact, onClose, open, returnFocusId]);

  const panel = (
    <div
      ref={dialogRef}
      id={navigatorId}
      role="dialog"
      aria-labelledby={titleId}
      data-sat-navigator-presentation={compact ? "compact" : "anchored"}
      className={`${compact ? "relative max-h-[min(70dvh,560px)] w-[min(620px,calc(100vw-16px))] rounded-[12px] border" : "relative max-h-[min(54dvh,460px)] w-[min(620px,calc(100vw-32px))] rounded-[10px] border"} overflow-y-auto border-[var(--sat-divider)] bg-[var(--sat-surface)] px-4 py-4 shadow-[0_18px_48px_rgba(0,0,0,0.20)] sm:px-7 sm:py-5`}
    >
      <div className="flex items-start justify-between gap-4 border-b border-[var(--sat-divider)] pb-3">
        <h2 id={titleId} className="text-[18px] font-semibold text-[var(--sat-text)]">
          {props.sectionLabel} Questions
        </h2>
        <button
          type="button"
          onClick={props.onClose}
          data-sat-navigator-close
          className="sat-touch-target sat-pressable grid place-items-center rounded-[6px] text-[var(--sat-text)] hover:bg-[var(--sat-surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-focus)]"
          aria-label="Close question navigator"
        >
          <X className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 border-b border-[var(--sat-divider-soft)] py-3 text-[13px] text-[var(--sat-text)]">
        <span className="inline-flex items-center gap-1.5">
          <MapPin className="h-4 w-4" aria-hidden="true" /> Current
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span
            className="h-4 w-4 border border-dashed border-[var(--sat-text)]"
            aria-hidden="true"
          />{" "}
          Unanswered
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Bookmark
            className="h-4 w-4 fill-[var(--sat-review)] text-[var(--sat-review)]"
            aria-hidden="true"
          />{" "}
          For Review
        </span>
      </div>
      <div className="grid grid-cols-5 justify-center gap-2 py-4 min-[360px]:grid-cols-6 sm:grid-cols-9 sm:gap-3">
        {props.items.map((item) => {
          const answered = item.status === "answered";
          const current = item.current;
          const stateClass = current
            ? "border-[var(--sat-accent)] bg-[var(--sat-surface)] text-[var(--sat-accent-strong)] ring-2 ring-[var(--sat-accent)]"
            : answered
              ? "border-[var(--sat-accent)] bg-[var(--sat-accent)] text-[var(--sat-accent-text)]"
              : "border-dashed border-[var(--sat-text)] bg-[var(--sat-surface)] text-[var(--sat-accent-strong)]";
          return (
            <button
              type="button"
              key={item.id}
              data-sat-navigator-current={current ? true : undefined}
              onClick={() => {
                props.onSelectQuestion(item.index);
                props.onClose();
              }}
              aria-current={current ? "step" : undefined}
              aria-label={`Question ${item.number}${answered ? ", answered" : ", unanswered"}${item.markedForReview ? ", marked for review" : ""}${current ? ", current question" : ""}`}
              className={`sat-pressable relative h-11 min-w-11 border text-[14px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-focus)] focus-visible:ring-offset-2 ${stateClass}`}
            >
              {item.number}
              {item.markedForReview ? (
                <Bookmark
                  className="absolute -right-1 -top-2 h-4 w-4 fill-[var(--sat-review)] text-[var(--sat-review)]"
                  aria-hidden="true"
                />
              ) : null}
            </button>
          );
        })}
      </div>

      <div className="flex justify-center border-t border-[var(--sat-divider-soft)] pt-3">
        <button
          type="button"
          onClick={() => {
            props.onReviewModule();
            props.onClose();
          }}
          className="sat-touch-target sat-pressable rounded-full border border-[var(--sat-accent)] px-5 text-[14px] font-semibold text-[var(--sat-accent-strong)] hover:bg-[var(--sat-accent-soft)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-focus)]"
        >
          Go to Review Page
        </button>
      </div>
    </div>
  );

  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-[calc(76px+var(--student-safe-bottom))] z-[80] flex justify-center px-2 sm:px-4"
      data-sat-navigator-anchor="footer"
    >
      <AnimatePresence initial={false}>
        {open ? (
          <SatPresenceSurface offsetY={4} className="pointer-events-auto relative">
            {panel}
            <span
              className="pointer-events-none absolute -bottom-[9px] left-1/2 h-[18px] w-[18px] -translate-x-1/2 rotate-45 border-b border-r border-[var(--sat-divider)] bg-[var(--sat-surface)]"
              aria-hidden="true"
            />
          </SatPresenceSurface>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
