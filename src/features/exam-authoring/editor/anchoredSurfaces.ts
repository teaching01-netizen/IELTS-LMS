import type { Editor } from "@tiptap/react";
import { resolveObjectBubble } from "./composerContext";

/**
 * Whether floating, hover-anchored surfaces belong in this environment.
 *
 * Touch devices already own text selection: a bubble competes with the native
 * selection handles and loses. There the persistent toolbar stays the way to
 * format — it is always the fallback, never the second choice. An environment
 * that cannot answer the question (jsdom in tests, ancient engines) is not
 * treated as touch: absence of evidence must not silently disable a feature.
 */
export function supportsHoverAnchoredBubbles(target?: Window): boolean {
  const scope = target ?? (typeof window === "undefined" ? undefined : window);
  const matchMedia = scope?.matchMedia?.bind(scope);
  if (!matchMedia) return true;
  return !matchMedia("(pointer: coarse)").matches;
}

/**
 * Whether the editor currently owns a live ProseMirror view.
 *
 * Tiptap returns a proxy for `editor.view` that throws on any property it
 * cannot stub once the view is gone, and a bubble plugin re-runs its update on
 * a timer — so a surface can be asked to show *after* unmount. `isDestroyed`
 * answers this exactly ("`editorView?.isDestroyed ?? true`"): a view that does
 * not exist is destroyed by definition. Note it deliberately does not consult
 * `isInitialized`, which stays false for a tick after a synchronous mount.
 */
export function hasLiveEditorView(editor: Editor): boolean {
  return !editor.isDestroyed;
}

/**
 * The element a floating surface is appended to, or null when the editor has no
 * view left to belong to. The caller supplies the fallback, so this stays a
 * lookup rather than a hidden dependency on the document.
 */
export function bubbleAppendTarget(editor: Editor): HTMLElement | null {
  if (!hasLiveEditorView(editor)) return null;
  return editor.view.dom.parentElement;
}

/** The shape floating-ui positions against; kept structural so no extra import is needed. */
export interface AnchoredSurfaceRect {
  getBoundingClientRect: () => DOMRect;
}

/**
 * Anchors an object surface to the object itself.
 *
 * The node view's DOM box is the thing the author sees and clicked, so the
 * controls appear attached to it — "I clicked this, these are for this" — and
 * stay attached while the document scrolls or reflows.
 */
export function objectAnchorFor(editor: Editor): AnchoredSurfaceRect | null {
  if (!hasLiveEditorView(editor)) return null;
  const context = resolveObjectBubble(editor.state);
  if (!context) return null;
  const dom = editor.view.nodeDOM(context.pos);
  if (!(dom instanceof HTMLElement)) return null;
  return { getBoundingClientRect: () => dom.getBoundingClientRect() };
}
