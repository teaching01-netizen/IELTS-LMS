import type { Extensions } from "@tiptap/core";
import { Collaboration } from "@tiptap/extension-collaboration";
import { CollaborationCaret } from "@tiptap/extension-collaboration-caret";
import type { Awareness } from "y-protocols/awareness";
import { ySyncPluginKey } from "y-prosemirror";
import type { PromptCoeditingSession } from "./contracts";
import type { PromptCoeditProvider } from "./provider";

/**
 * Binds a rich-text field to a named XML fragment in the shared Y.Doc. With no
 * `field` this is the v1 `prompt` binding; the workspace passes each field's
 * own root.
 *
 * Only this package knows about Yjs/Hocuspocus: the composer receives an
 * opaque `Extensions` array and remains transport-agnostic.
 *
 * History note: the composer disables StarterKit's undo/redo in collaborative
 * mode (see richTextSchema `history: false`). Yjs owns history once
 * Collaboration is bound; two independent history stacks corrupt each other's
 * undo, which is exactly the class of bug the "Frontend ownership"
 * requirement targets (docs/sat-authoring-coedit.md).
 */
export function collaborationExtensions(input: {
  session: PromptCoeditingSession;
  provider: PromptCoeditProvider;
  field?: string;
}): Extensions {
  const { session, provider } = input;
  const field = input.field ?? session.field;
  return [
    Collaboration.configure({
      document: session.ydoc,
      field,
    }),
    CollaborationCaret.configure({
      // A workspace room contains many rich-text bindings. Each binding gets
      // its own cursor key so a caret in a prompt cannot be interpreted as a
      // caret in a choice, rationale, or another editor. The legacy v1 prompt
      // room keeps the original `cursor` key for migration compatibility.
      provider: createScopedCaretProvider(provider.awarenessProvider.awareness, field),
      user: {
        id: session.self.actorId,
        name: session.self.displayName,
        color: session.self.color,
      },
      render: (user) => renderCaretLabel(user),
      selectionRender: (user) => renderCaretSelection(user),
    }),
  ];
}

/** The one transaction detail this package needs from a rich-text editor. */
export interface CollaborativeTransactionLike {
  getMeta(key: unknown): unknown;
}

/**
 * Whether a transaction is a collaborator's update rather than an author action.
 *
 * y-prosemirror marks every transaction its observer produces as change-origin.
 * Undo/redo is marked the same way, but remains an author action that must be
 * persisted, so only the non-undo branch counts as remote.
 *
 * The composer needs this answer and cannot produce it: deciding it means
 * knowing how the CRDT binding marks its transactions, which is the same
 * knowledge as importing `y-prosemirror`. Asking it here keeps the composer
 * asking about transactions instead of about Yjs, and the
 * `coedit-transport-boundary` architecture rule forbids the import outside this
 * package precisely so it cannot drift back.
 */
export function isCollaborativeTransaction(
  transaction: CollaborativeTransactionLike,
): boolean {
  const meta = transaction.getMeta(ySyncPluginKey) as
    | { isChangeOrigin?: boolean; isUndoRedoOperation?: boolean }
    | undefined;
  return Boolean(meta?.isChangeOrigin && !meta?.isUndoRedoOperation);
}

interface ScopedAwareness {
  readonly clientID: number;
  readonly states: Map<number, Record<string, unknown>>;
  getStates(): Map<number, Record<string, unknown>>;
  getLocalState(): Record<string, unknown> | null;
  setLocalStateField(field: string, value: unknown): void;
  on(event: string, listener: (...args: unknown[]) => void): void;
  off(event: string, listener: (...args: unknown[]) => void): void;
}

interface ScopedCaretProvider {
  awareness: ScopedAwareness;
}

/**
 * Projects one field's cursor from the shared awareness object.
 *
 * Tiptap's caret plugin assumes a single `cursor` property. The underlying
 * Hocuspocus awareness object is shared by every editor in the workspace, so
 * this adapter presents the selected field as that property while preserving
 * the other shared presence fields (`user`, `target`, and `selection`).
 */
export function createScopedCaretProvider(
  awareness: Awareness | null,
  field: string,
): ScopedCaretProvider {
  if (!awareness) {
    throw new Error("Collaboration caret awareness is unavailable.");
  }

  const cursorKey = cursorStateKey(field);
  const project = (state: Record<string, unknown> | null | undefined): Record<string, unknown> => {
    if (!state) return {};
    const projected = { ...state };
    for (const key of Object.keys(projected)) {
      if (isFieldCursorKey(key)) delete projected[key];
    }
    const cursor = state[cursorKey];
    if (cursor !== undefined) projected["cursor"] = cursor;
    return projected;
  };

  const scopedAwareness: ScopedAwareness = {
    get clientID() {
      return awareness.clientID;
    },
    get states() {
      return scopedStates(awareness, project);
    },
    getStates() {
      return scopedStates(awareness, project);
    },
    getLocalState() {
      const local = awareness.getLocalState();
      return local === null ? null : project(local);
    },
    setLocalStateField(fieldName, value) {
      awareness.setLocalStateField(fieldName === "cursor" ? cursorKey : fieldName, value);
    },
    on(event, listener) {
      awareness.on(event, listener as (...args: any[]) => any);
    },
    off(event, listener) {
      awareness.off(event, listener as (...args: any[]) => any);
    },
  };

  return { awareness: scopedAwareness };
}

function scopedStates(
  awareness: Awareness,
  project: (state: Record<string, unknown> | null | undefined) => Record<string, unknown>,
): Map<number, Record<string, unknown>> {
  const states = new Map<number, Record<string, unknown>>();
  awareness.getStates().forEach((state, clientId) => {
    states.set(clientId, project(state as Record<string, unknown> | null | undefined));
  });
  return states;
}

function cursorStateKey(field: string): string {
  const normalized = field.trim();
  return normalized === "prompt" ? "cursor" : `cursor:${normalized}`;
}

function isFieldCursorKey(key: string): boolean {
  return key === "cursor" || key.startsWith("cursor:");
}

interface CaretUser {
  id?: string | number;
  name?: string;
  color?: string;
}

const CARET_LABEL_DURATION_MS = 1_800;

/**
 * Caret label renderer.
 *
 * Labels are decorative and transient. They can be hovered to reveal again,
 * but never enter the keyboard focus order or the editor's selection path.
 *
 * Reduced motion: the caret and label are rendered with NO entrance animation.
 * Collaborators who ask for reduced motion still get an unambiguous caret, they
 * just do not get a moving one.
 */
export function renderCaretLabel(user: CaretUser): HTMLElement {
  const color = typeof user.color === "string" && user.color ? user.color : "#2563EB";
  const name = typeof user.name === "string" && user.name.trim() ? user.name.trim() : "Collaborator";
  const reducedMotion =
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const caret = document.createElement("span");
  caret.className = "sat-coedit-caret";
  caret.setAttribute("data-coedit-caret", "true");
  caret.setAttribute("aria-hidden", "true");
  caret.style.position = "relative";
  caret.style.borderLeft = `2px solid ${color}`;
  caret.style.borderRight = "none";
  caret.style.marginLeft = "-1px";
  caret.style.marginRight = "-1px";
  caret.style.pointerEvents = "none";
  caret.style.wordBreak = "normal";
  caret.style.transition = reducedMotion ? "none" : "opacity 120ms ease";

  const label = document.createElement("span");
  label.className = "sat-coedit-caret__label";
  label.textContent = name;
  label.setAttribute("role", "presentation");
  label.style.position = "absolute";
  label.style.top = "-1.4em";
  label.style.left = "-2px";
  label.style.backgroundColor = color;
  label.style.color = "#ffffff";
  label.style.fontSize = "11px";
  label.style.fontWeight = "600";
  label.style.lineHeight = "1.4";
  label.style.padding = "0 4px";
  label.style.borderRadius = "4px";
  label.style.whiteSpace = "nowrap";
  label.style.userSelect = "none";
  label.style.pointerEvents = "auto";
  label.style.opacity = "1";
  label.style.transition = reducedMotion ? "none" : "opacity 160ms ease";
  label.style.marginLeft = "0";
  label.style.cursor = "default";
  label.tabIndex = -1;
  label.setAttribute("aria-hidden", "true");
  label.dataset["caretHidden"] = "false";
  label.setAttribute("data-coedit-caret-label", name);

  caret.appendChild(label);
  globalThis.setTimeout(() => {
    label.style.opacity = "0";
    label.dataset["caretHidden"] = "true";
  }, CARET_LABEL_DURATION_MS);
  return caret;
}

/** Shared, non-semantic selection tint for every client. */
export function renderCaretSelection(user: CaretUser): {
  class: string;
  style: string;
} {
  const color = typeof user.color === "string" && /^#[0-9a-f]{6}$/i.test(user.color)
    ? user.color
    : "#2563EB";
  return {
    class: "sat-coedit-selection",
    // 0x1f is approximately 12% alpha for a hex colour.
    style: `background-color: ${color}1f;`,
  };
}
