import React from 'react';
import type { SelectionRect } from '../domain/selectionTypes';
import '../styles/selection.css';

/**
 * Paints the lines of a selection the exam owns.
 *
 * There is no browser selection to render, by design: the platform must never
 * learn one exists, because that is what stops it raising its Copy / Look Up /
 * Share menu over the passage. The student still has to see what they chose, so
 * the measured lines are painted here.
 *
 * Decoration only: hidden from assistive tech (the handle controls below carry
 * the semantics) and never hit-testable, so the finger dragging over it keeps
 * reaching the prose underneath. Each line is positioned by TRANSFORM, which is
 * what lets a scroll or a reflow repaint without invalidating layout.
 *
 * DELIBERATELY UNANIMATED, and not an oversight. These rectangles are the
 * student's own finger, drawn: they arrive a frame after the input that made
 * them and they must disappear the moment it does. A fade would either trail the
 * drag (the ink arriving after the finger moved on) or, on the settled selection,
 * dim the text a student has already chosen. Motion belongs to the chrome that
 * ATTACHES to a selection — a grip appearing, a magnifier opening — never to the
 * selection itself.
 */
export function SelectionHighlight({ rects }: { rects: readonly SelectionRect[] }) {
  if (rects.length === 0) return null;

  return (
    <div
      aria-hidden="true"
      data-student-selection-highlight="true"
      className="selection-v2 selection-v2-highlight"
      // Hit-testing policy as a property of the component, not only a stylesheet
      // rule: decoration that could swallow the finger dragging over it is the
      // one failure this overlay cannot recover from.
      style={{ pointerEvents: 'none' }}
    >
      {rects.map((rect, index) => (
        <span
          key={`${rect.top}:${rect.left}:${index}`}
          data-student-selection-line="true"
          className="selection-v2-line"
          style={{
            width: rect.width,
            height: rect.height,
            transform: `translate3d(${rect.left}px, ${rect.top}px, 0)`,
          }}
        />
      ))}
    </div>
  );
}
