/**
 * The authoring entry gesture: "the author picked this exam to work on".
 *
 * WHY THIS EXISTS
 * ---------------
 * The shell READ is deliberately GET-only and never creates a draft
 * (`authoringShellLifecycle`), so a published exam — publishing clears
 * `current_draft_version_id` — answers NO_DRAFT. That is the right answer for a
 * refresh inside the workspace, but it is the wrong answer for a deliberate
 * click in the Exam Library: the author asked to edit that exam and landed on a
 * "No editable draft" wall, one "Open draft" click short of the editor.
 *
 * So the two arrivals must be distinguishable, and the only honest difference
 * between them is the GESTURE, not the URL: a click carries intent, a reload
 * does not. This module carries that intent across the navigation boundary.
 *
 * WHY NOT `location.state`
 * ------------------------
 * React Router's location state is `history.state`, which the browser restores
 * across a reload: a gesture left there would re-fire on F5 and turn a refresh
 * into a draft-CREATING write — exactly the invariant this work exists to keep.
 * The slot below lives in module memory, so it survives a navigation and dies
 * with the document. A reload, a restored session, a new tab, or a back/forward
 * landing all arrive with no gesture and therefore stay reads.
 *
 * WHY IT EXPIRES
 * --------------
 * The gesture means "just now", and a navigation is the only thing that can
 * follow it. Bounding it by a short window keeps a gesture from a minute ago
 * from arming an unrelated later arrival (say, returning to the builder from the
 * release page). Past the window the workspace shows the ordinary NO_DRAFT
 * surface with its explicit CTA — the safe fallback.
 */

/** How long a navigation gesture stays armed, in milliseconds. */
export const AUTHORING_ENTRY_INTENT_TTL_MS = 30_000;

interface AuthoringEntryIntent {
  examId: string;
  requestedAt: number;
}

/**
 * One slot, not a set: the gesture describes the navigation that is happening,
 * and two navigations cannot be happening at once. A second request replaces
 * the first, which is what the history does too — the last click wins.
 */
let intent: AuthoringEntryIntent | null = null;

/**
 * Arm the gesture for one exam. Callers are navigation gestures only: the Exam
 * Library row, and the release page's two ways back into the editor ("Back to
 * builder" and a clicked blocker) — never a read, never an effect that could run
 * on mount.
 */
export function requestAuthoringDraftOnEntry(examId: string, now: number = Date.now()): void {
  intent = { examId, requestedAt: now };
}

/**
 * Is this exam's gesture armed and still fresh? A pure READ: the workspace calls
 * it during render so the commit that discovers NO_DRAFT can already show
 * progress, and a double render (StrictMode) cannot spend the gesture.
 */
export function peekAuthoringDraftOnEntry(examId: string, now: number = Date.now()): boolean {
  return (
    intent !== null &&
    intent.examId === examId &&
    now - intent.requestedAt <= AUTHORING_ENTRY_INTENT_TTL_MS
  );
}

/**
 * Spend the gesture for this exam, returning whether it was actually armed.
 *
 * The workspace consumes it on the first lifecycle answer of a navigation,
 * whatever that answer is, so an intent that cannot act (the exam already has a
 * draft, the role cannot write, the read failed) cannot stay armed for a later
 * arrival. A false answer means "no gesture here" and clears nothing.
 */
export function consumeAuthoringDraftOnEntry(examId: string, now: number = Date.now()): boolean {
  if (intent === null || intent.examId !== examId) return false;
  const armed = peekAuthoringDraftOnEntry(examId, now);
  intent = null;
  return armed;
}
