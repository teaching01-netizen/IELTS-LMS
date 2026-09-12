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
  onChange: (ratio: number) => void;
}

export function SatReadingSplitHandle({
  containerRef,
  ratio,
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

  // Bluebook hard divider: 2px track painted with the split-divider token.
  const passagePercent = Math.round(ratio * 100);
  return (
    <button
      type="button"
      role="slider"
      aria-orientation="horizontal"
      aria-label="Passage and question width"
      aria-valuemin={38}
      aria-valuemax={62}
      aria-valuenow={passagePercent}
      aria-valuetext={`Passage ${passagePercent} percent, question ${100 - passagePercent} percent`}
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
    </button>
  );
}
