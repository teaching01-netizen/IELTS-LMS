/**
 * The two DOM things a note needs from a mark: show it, and hand focus back to
 * it. Both live here so "a note is attached to that span" has one implementation
 * rather than a querySelector in every caller.
 */

/**
 * Put focus back on the mark a note was written about.
 *
 * Marks are reachable and activatable by keyboard, so this is the honest return
 * target when a note closes: the student lands on the text they were working on,
 * not at the top of the document.
 */
export function focusSatAnnotationMark(annotationId: string): boolean {
  if (typeof document === 'undefined') return false;
  return focusAndReport(document.querySelector<HTMLElement>(markSelector(annotationId)));
}

/**
 * Put focus back on the row for the question's own note.
 *
 * Writing about the question opens a second kind of note editor; closing it must
 * return the student to what they were doing just as closing a marked note does,
 * rather than dumping focus at the top of the document or on a control they were
 * not using.
 */
export function focusSatQuestionNoteRow(): boolean {
  if (typeof document === 'undefined') return false;
  return focusAndReport(document.querySelector<HTMLElement>('[data-sat-note-card="question"]'));
}

/**
 * Focus a return target and report whether it actually took the focus.
 *
 * Reporting the *outcome* rather than the attempt is what lets the caller fall
 * back to a control that can take focus: an element that exists but is not
 * focusable would otherwise leave the caret on <body>, which is the failure this
 * whole helper exists to prevent.
 */
function focusAndReport(target: HTMLElement | null): boolean {
  if (!target) return false;
  target.focus();
  return document.activeElement === target;
}

function markSelector(annotationId: string): string {
  return `[data-sat-annotation-id="${escapeAttributeValue(annotationId)}"]`;
}

/**
 * Bring one marked span into view inside the passage pane.
 *
 * Clicking a note is a promise: "show me the text this belongs to". Keeping that
 * promise means scrolling the passage — and only the passage. The nearest
 * `data-student-exam-scroll-owner` is that pane; a bare `scrollIntoView` would
 * also move the shell and the question column, which is disorienting in an exam.
 */
export function scrollSatAnnotationIntoView(annotationId: string): boolean {
  if (typeof document === 'undefined') return false;
  const target = document.querySelector<HTMLElement>(markSelector(annotationId));
  if (!target) return false;
  const container = target.closest<HTMLElement>('[data-student-exam-scroll-owner]');
  if (!container) {
    target.scrollIntoView({ block: 'center' });
    return true;
  }
  const targetRect = target.getBoundingClientRect();
  const containerRect = container.getBoundingClientRect();
  const offset = targetRect.top - containerRect.top - (container.clientHeight - targetRect.height) / 2;
  const top = Math.max(0, container.scrollTop + offset);
  // No flash, no pulse: a gentle recentring, and nothing at all when the
  // student has asked the system for less motion.
  if (prefersReducedMotion()) container.scrollTop = top;
  else container.scrollTo({ top, behavior: 'smooth' });
  return true;
}

function escapeAttributeValue(value: string): string {
  const cssEscape = (globalThis.CSS as typeof CSS | undefined)?.escape;
  return cssEscape ? cssEscape(value) : value.replace(/["\\]/g, '\\$&');
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}
