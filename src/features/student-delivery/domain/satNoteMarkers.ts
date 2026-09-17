import type { SatHighlightColor } from './satResponses';

/**
 * The margin dots: which marks in the passage carry a note, and where their dot
 * goes.
 *
 * The pane answers "what did I write"; this answers "where did I write it". A
 * student with four highlights and two notes could only find the notes by opening
 * the pane and reading quotes, which is a search rather than a glance. One dot
 * per phrase that has a note turns it back into a glance.
 *
 * Two properties matter and are the whole reason this is a rule rather than a
 * render detail:
 *
 * - Nothing is drawn into the sentence. A dot sits in the passage's margin, so
 *   annotated prose stays prose — the mark's own box is untouched. That is what
 *   the removed in-sentence note glyph got wrong, and it is why this file carries
 *   no text, no label, and no icon.
 * - One dot per line. Two notes on the same line are one line the student reads
 *   once; a stack of dots would say "two", which is a fact the pane already
 *   reports accurately and the margin does not need to.
 *
 * The dot is decoration: it names nothing, announces nothing, and is never a
 * target. Opening a note stays exactly where it was — on the marked words.
 */

/**
 * Vertical distance (px) within which two marks count as the same line.
 *
 * Lines are ~24–34px apart at the sizes this surface offers, so a threshold well
 * under that de-duplicates fragments of one line (a wrapped mark's first line and
 * a short mark beside it) without ever merging two lines a student reads as two.
 */
export const SAT_NOTE_MARKER_LINE_PX = 8;

export interface SatNoteMarkerInput {
  /** Annotation the dot belongs to (its mark's id). */
  id: string;
  /**
   * Vertical centre of the mark's FIRST line, in px from the content box's top
   * edge — the line the dot is level with, not the middle of a wrapped mark.
   */
  top: number;
  /** The mark's ink, so the dot and the highlight are the same colour. */
  color?: SatHighlightColor | undefined;
}

export interface SatNoteMarker {
  id: string;
  top: number;
  color?: SatHighlightColor | undefined;
}

/**
 * One dot per line, in document order.
 *
 * Callers hand over only marks that have a note (`satAnnotationHasNote`); the
 * order they arrive in decides which mark owns a shared line, so the dot stays
 * attached to the phrase nearest the start of the line rather than jumping
 * between notes on every save.
 */
export function clusterSatNoteMarkers(markers: readonly SatNoteMarkerInput[]): SatNoteMarker[] {
  const dots: SatNoteMarker[] = [];
  for (const marker of markers) {
    const top = Math.round(marker.top);
    if (dots.some((dot) => Math.abs(dot.top - top) < SAT_NOTE_MARKER_LINE_PX)) continue;
    dots.push({ id: marker.id, top, ...(marker.color ? { color: marker.color } : {}) });
  }
  return dots;
}

/**
 * True when two marker sets say the same thing.
 *
 * The dots are measured after layout and stored as state, so this is what keeps
 * a re-measure that changed nothing from re-rendering the passage — a resize
 * observer fires on every frame of a window drag, and re-rendering a question
 * under a finger is its own defect.
 */
export function satNoteMarkersEqual(
  a: readonly SatNoteMarker[],
  b: readonly SatNoteMarker[],
): boolean {
  if (a.length !== b.length) return false;
  return a.every((dot, index) => {
    const other = b[index];
    return other !== undefined && dot.id === other.id && dot.top === other.top && dot.color === other.color;
  });
}
