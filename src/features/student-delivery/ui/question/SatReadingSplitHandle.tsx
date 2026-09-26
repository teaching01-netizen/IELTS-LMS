import { useRef, type KeyboardEvent, type PointerEvent, type RefObject } from "react";
import {
  SAT_READING_SPLIT_MAX,
  SAT_READING_SPLIT_MIN,
  SAT_READING_SPLIT_STEP,
  clampSatReadingSplitRatio,
} from "../../domain/satReadingPreferences";

export interface SatReadingSplitHandleProps {
  containerRef: RefObject<HTMLDivElement | null>;
  ratio: number;
  leftPaneLabel?: string;
  onChange: (ratio: number) => void;
}

export function SatReadingSplitHandle({
  containerRef,
  ratio,
  leftPaneLabel = "Passage",
  onChange,
}: SatReadingSplitHandleProps) {
  const draggingPointer = useRef<number | null>(null);

  const updateFromClientX = (clientX: number) => {
    const bounds = containerRef.current?.getBoundingClientRect();
    if (!bounds || bounds.width <= 0) return;
    onChange(clampSatReadingSplitRatio((clientX - bounds.left) / bounds.width));
  };

  const handlePointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    draggingPointer.current = event.pointerId;
    event.currentTarget.setPointerCapture(event.pointerId);
    updateFromClientX(event.clientX);
  };

  const handlePointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    if (draggingPointer.current !== event.pointerId) return;
    updateFromClientX(event.clientX);
  };

  const handlePointerEnd = (event: PointerEvent<HTMLButtonElement>) => {
    if (draggingPointer.current !== event.pointerId) return;
    draggingPointer.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    if (event.key === "Home") {
      onChange(SAT_READING_SPLIT_MIN);
      return;
    }
    if (event.key === "End") {
      onChange(SAT_READING_SPLIT_MAX);
      return;
    }
    const delta = event.key === "ArrowLeft" ? -SAT_READING_SPLIT_STEP : SAT_READING_SPLIT_STEP;
    onChange(clampSatReadingSplitRatio(ratio + delta));
  };

  // Bluebook hard divider: 2px track painted with the split-divider token,
  // plus the grip that says the seam moves.
  const passagePercent = Math.round(ratio * 100);
  return (
    <button
      type="button"
      role="slider"
      aria-orientation="horizontal"
      aria-label={`${leftPaneLabel} and question width`}
      aria-valuemin={38}
      aria-valuemax={62}
      aria-valuenow={passagePercent}
      aria-valuetext={`${leftPaneLabel} ${passagePercent} percent, question ${100 - passagePercent} percent`}
      tabIndex={0}
      data-sat-reading-split-handle
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
      onKeyDown={handleKeyDown}
      className="group relative z-10 hidden h-full w-11 justify-self-center touch-none cursor-col-resize select-none items-stretch border-0 bg-transparent p-0 focus-visible:outline-none md:flex"
    >
      <span
        aria-hidden="true"
        className="pointer-events-none mx-auto w-0.5 bg-[var(--sat-split-divider)] transition-colors group-hover:bg-[var(--sat-accent)] group-active:bg-[var(--sat-accent)] group-focus-visible:bg-[var(--sat-focus)]"
      />
      {/* The grabber. A 2px hairline is a border; nothing about it says
          "moveable", and a cursor only speaks to a student who already
          suspected. This is the one thing that says it: the reference's dark
          grip, painted at the middle of the seam, present at rest rather than
          on hover — the student who does not know to hover is exactly the one
          who needs it. It sits inside the 44px target the divider already
          owns, and `pointer-events-none` keeps every drag starting on the
          button so the grip can never eat a gesture that lands on it.

          Drawn here rather than imported: it is a small pair of outward
          triangles, and the ink pair follows the same text/background tokens
          the question number cell uses, so high contrast keeps it legible. */}
      <span
        aria-hidden="true"
        data-sat-reading-split-grip="true"
        className="sat-state-transition pointer-events-none absolute left-1/2 top-1/2 grid h-9 w-5 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-[4px] bg-[var(--sat-text)] text-[var(--sat-background)] group-hover:bg-[var(--sat-accent)] group-hover:text-[var(--sat-accent-text)] group-active:bg-[var(--sat-accent)] group-active:text-[var(--sat-accent-text)] group-focus-visible:bg-[var(--sat-accent)] group-focus-visible:text-[var(--sat-accent-text)]"
      >
        <svg viewBox="0 0 10 8" fill="currentColor" className="h-2 w-2.5" aria-hidden="true">
          <path d="M0 4 3.5 1v6z" />
          <path d="M10 4 6.5 1v6z" />
        </svg>
      </span>
    </button>
  );
}
