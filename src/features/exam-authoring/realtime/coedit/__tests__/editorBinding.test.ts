import { afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { Awareness } from "y-protocols/awareness";
import {
  createScopedCaretProvider,
  isCollaborativeTransaction,
  renderCaretLabel,
  renderCaretSelection,
} from "../editorBinding";

afterEach(() => {
  vi.useRealTimers();
});

/**
 * The decision the composer cannot make for itself: the transport is what marks
 * a transaction as coming from a collaborator, and undo/redo carries the same
 * mark while remaining an author action.
 */
describe("collaborative transaction classification", () => {
  const transactionWith = (meta: unknown) => ({ getMeta: () => meta });

  it("treats a change-origin transaction as a collaborator's edit", () => {
    expect(isCollaborativeTransaction(transactionWith({ isChangeOrigin: true }))).toBe(true);
  });

  it("keeps undo and redo as author actions", () => {
    expect(
      isCollaborativeTransaction({ getMeta: () => ({ isChangeOrigin: true, isUndoRedoOperation: true }) }),
    ).toBe(false);
  });

  it("treats an unmarked transaction as an author action", () => {
    for (const meta of [undefined, null, {}, { isUndoRedoOperation: true }, { isChangeOrigin: false }]) {
      expect(isCollaborativeTransaction(transactionWith(meta)), JSON.stringify(meta)).toBe(false);
    }
  });
});

describe("remote caret label", () => {
  it("labels the caret with the server-derived name", () => {
    const caret = renderCaretLabel({ name: "Alice Author", color: "#2563eb" });
    const label = caret.querySelector("[data-coedit-caret-label]");
    expect(caret.getAttribute("data-coedit-caret")).toBe("true");
    expect(label?.textContent).toBe("Alice Author");
    expect(label?.getAttribute("data-coedit-caret-label")).toBe("Alice Author");
  });

  it("never renders an empty or missing name as a blank label", () => {
    for (const name of [undefined, "", "   "]) {
      const caret = renderCaretLabel({ name, color: "#2563eb" });
      expect(caret.querySelector("[data-coedit-caret-label]")?.textContent).toBe("Collaborator");
    }
  });

  it("falls back to a visible colour when the server sends none", () => {
    for (const color of [undefined, "", 42 as unknown as string]) {
      const caret = renderCaretLabel({ name: "Bob", color });
      expect(caret.style.borderLeftColor).toBe("rgb(37, 99, 235)");
    }
  });

  it("keeps the caret decorative while allowing hover to reveal its label", () => {
    const caret = renderCaretLabel({ name: "Carol", color: "#db2777" });
    const label = caret.querySelector("[data-coedit-caret-label]") as HTMLElement;
    // A screen reader has one subject here: the prompt. The caret must not add
    // a second, let alone intercept a selection gesture.
    expect(caret.getAttribute("aria-hidden")).toBe("true");
    expect(caret.style.pointerEvents).toBe("none");
    expect(label.style.pointerEvents).toBe("auto");
    expect(label.style.userSelect).toBe("none");
    expect(label.getAttribute("role")).toBe("presentation");
    expect(label.getAttribute("aria-hidden")).toBe("true");
    expect(label.tabIndex).toBe(-1);
  });

  it("fades the label out after 1.8 seconds and shows it again on movement", () => {
    vi.useFakeTimers();
    const first = renderCaretLabel({ id: "actor-1", name: "Dan", color: "#0891b2" });
    const firstLabel = first.querySelector("[data-coedit-caret-label]") as HTMLElement;
    expect(firstLabel.style.opacity).toBe("1");
    vi.advanceTimersByTime(1_800);
    expect(firstLabel.style.opacity).toBe("0");
    const moved = renderCaretLabel({ id: "actor-1", name: "Dan", color: "#0891b2" });
    expect((moved.querySelector("[data-coedit-caret-label]") as HTMLElement).style.opacity).toBe("1");
  });

  it("renders without movement when reduced motion is requested", () => {
    const originalMatchMedia = window.matchMedia;
    window.matchMedia = (() => ({ matches: true })) as typeof window.matchMedia;
    const caret = renderCaretLabel({ name: "Dan", color: "#0891b2" });
    const label = caret.querySelector("[data-coedit-caret-label]") as HTMLElement;
    expect(caret.style.transition).toBe("none");
    expect(label.style.transition).toBe("none");
    window.matchMedia = originalMatchMedia;
  });

  it("uses the shared palette and a twelve-percent selection tint", () => {
    expect(renderCaretSelection({ color: "#2563EB" })).toEqual({
      class: "sat-coedit-selection",
      style: "background-color: #2563EB1f;",
    });
    expect(renderCaretSelection({ color: "not-a-color" }).style).toBe(
      "background-color: #2563EB1f;",
    );
  });

  it("scopes workspace carets to the rich-text field that owns them", () => {
    const awareness = new Awareness(new Y.Doc());
    awareness.setLocalState({
      user: { id: "actor-a", name: "Alice", color: "#2563EB" },
      cursor: { anchor: "prompt" },
      "cursor:rich:question/q1/choice/c1": { anchor: "choice" },
    });

    const prompt = createScopedCaretProvider(awareness, "prompt").awareness;
    const choice = createScopedCaretProvider(awareness, "rich:question/q1/choice/c1").awareness;

    expect(prompt.getLocalState()?.cursor).toEqual({ anchor: "prompt" });
    expect(prompt.getLocalState()).not.toHaveProperty("cursor:rich:question/q1/choice/c1");
    expect(choice.getLocalState()?.cursor).toEqual({ anchor: "choice" });
    expect(choice.getLocalState()).not.toHaveProperty("cursor:rich:question/q1/choice/c1");

    choice.setLocalStateField("cursor", { anchor: "choice-2" });
    expect(awareness.getLocalState()).toMatchObject({
      cursor: { anchor: "prompt" },
      "cursor:rich:question/q1/choice/c1": { anchor: "choice-2" },
    });
  });
});
