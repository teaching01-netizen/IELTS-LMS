import { useRef, useState, type PointerEvent as ReactPointerEvent, type KeyboardEvent } from "react";
import { cn } from "@/lib/utils";

export interface AuthoringPaneResizerProps {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  step?: number;
  /** Multiplies horizontal pointer/keyboard movement. Use -1 for a right rail. */
  direction?: 1 | -1;
  className?: string;
  disabled?: boolean;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function AuthoringPaneResizer({
  label,
  value,
  min,
  max,
  onChange,
  step = 16,
  direction = 1,
  className,
  disabled = false,
}: AuthoringPaneResizerProps) {
  const dragRef = useRef<{ startX: number; startValue: number; pointerId: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  const setFromPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || event.pointerId !== drag.pointerId) return;
    onChange(clamp(drag.startValue + (event.clientX - drag.startX) * direction, min, max));
  };

  const finishPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (disabled || event.button !== 0) return;
    dragRef.current = { startX: event.clientX, startValue: value, pointerId: event.pointerId };
    setDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    const horizontalDelta = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (horizontalDelta) {
      event.preventDefault();
      onChange(clamp(value + horizontalDelta * step * direction, min, max));
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      onChange(min);
    } else if (event.key === "End") {
      event.preventDefault();
      onChange(max);
    }
  };

  return (
    // `separator` is keyboard-focusable and exposes the ARIA range contract,
    // but jsx-a11y does not infer that interaction model from the role.
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <div
      role="separator"
      aria-label={label}
      aria-orientation="vertical"
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-valuetext={`${value}px`}
      tabIndex={disabled ? -1 : 0}
      data-authoring-pane-resizer="true"
      data-dragging={dragging ? "true" : undefined}
      className={cn("authoring-pane-resizer", disabled && "authoring-pane-resizer--disabled", className)}
      onPointerDown={handlePointerDown}
      onPointerMove={setFromPointer}
      onPointerUp={finishPointer}
      onPointerCancel={finishPointer}
      onKeyDown={handleKeyDown}
    >
      <span aria-hidden="true" className="authoring-pane-resizer__grip" />
    </div>
  );
}
