export const EXAM_VIEWPORT_CONTENT = "width=device-width, initial-scale=1, viewport-fit=cover";

/**
 * Manages the exam viewport meta without disabling native browser/pinch zoom.
 *
 * This is intentionally a *no-op* for zoom: it must NOT emit `maximum-scale`
 * or `user-scalable=no`, and it must NOT prevent multi-touch, gesture, or
 * pinch events. Native page zoom is preserved for accessibility. Viewport
 * *height* is owned by `useStudentExamViewport` (which publishes
 * `--student-exam-height` on the shell) and the document page lock
 * (`html/body.student-exam-active`) is owned by `useStudentExamPageLock`.
 */
export function installExamPageZoomGuard(targetDocument: Document): () => void {
  let viewport = targetDocument.querySelector<HTMLMetaElement>('meta[name="viewport"]');
  const createdViewport = viewport === null;

  if (!viewport) {
    viewport = targetDocument.createElement("meta");
    viewport.name = "viewport";
    targetDocument.head.appendChild(viewport);
  }

  const originalContent = viewport.getAttribute("content");
  viewport.setAttribute("content", EXAM_VIEWPORT_CONTENT);

  let cleanedUp = false;
  return () => {
    if (cleanedUp) {
      return;
    }
    cleanedUp = true;

    if (createdViewport) {
      viewport.remove();
    } else if (originalContent === null) {
      viewport.removeAttribute("content");
    } else {
      viewport.setAttribute("content", originalContent);
    }
  };
}
