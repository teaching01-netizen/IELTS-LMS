import React from 'react';
import type { TouchSelectionRect } from './touchSelectionRange';

/**
 * Paints a selection the app owns.
 *
 * There is no browser selection to render, by design: the whole point of
 * `useStudentTouchTextSelection` is that the platform never learns one exists,
 * because that is what stops it raising its Copy / Look Up / Share menu over the
 * passage. But a student dragging across text still needs to see what they have
 * chosen, so the chosen rectangles are painted here instead.
 *
 * Decoration, and nothing else: hidden from assistive tech (the annotation
 * toolbar is where the outcome is announced, and it already is a labelled
 * surface) and never hit-testable, so the finger dragging over it keeps reaching
 * the prose underneath. The rectangles are fixed-position viewport boxes, which
 * is the coordinate space `Range.getClientRects()` reports in.
 */
export function StudentTouchSelectionOverlay({
  rects,
}: {
  rects: readonly TouchSelectionRect[];
}) {
  if (rects.length === 0) return null;

  return (
    <div
      aria-hidden="true"
      data-student-touch-selection="true"
      className="pointer-events-none fixed inset-0 z-[60]"
    >
      {rects.map((rect, index) => (
        <span
          key={`${rect.top}:${rect.left}:${index}`}
          data-student-touch-selection-line="true"
          className="absolute rounded-[2px]"
          style={{
            left: rect.left,
            top: rect.top,
            width: rect.width,
            height: rect.height,
            backgroundColor: 'var(--student-touch-selection-color, rgba(37, 99, 235, 0.3))',
          }}
        />
      ))}
    </div>
  );
}
