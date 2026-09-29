import React from "react";
import { createEvent, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SelectionOverlay, type SelectionOverlaySelection } from "../react/SelectionOverlay";
import { IDLE_SELECTION } from "../domain/selectionTypes";

const rects = [
  { left: 10, top: 100, width: 100, height: 20 },
  { left: 10, top: 124, width: 40, height: 20 },
];

function resting(overrides: Partial<SelectionOverlaySelection> = {}): SelectionOverlaySelection {
  return {
    ...IDLE_SELECTION,
    id: "selection:1",
    phase: "selected",
    selected: true,
    selectionText: "alpha beta",
    rects,
    startHandle: { edge: "start", x: 10, y: 100, direction: "ltr", stem: "up" },
    endHandle: { edge: "end", x: 50, y: 144, direction: "ltr", stem: "down" },
    anchorRect: { left: 10, top: 100, width: 100, height: 44 },
    pointer: { pointerType: "touch", finger: { x: 30, y: 120 }, caret: null, snapRevision: 0 },
    adjusting: false,
    beginHandleAdjustment: vi.fn(),
    activateCurrentSelection: vi.fn(),
    dismiss: vi.fn(),
    // The gesture's own guards as the hook answers them for a control the
    // gesture would NOT handle (a toolbar, an input): dismissed, delivered.
    // A test whose press stands in for the prose overrides this with true.
    wouldBeginGesture: vi.fn(() => false),
    ignoreGesturePress: vi.fn(),
    wouldStartOwnedSelection: vi.fn(() => false),
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("painting a selection", () => {
  it("paints one line per measured rect and nothing at all when idle", () => {
    const { rerender } = render(<SelectionOverlay selection={resting()} />);

    expect(screen.getAllByText("", { selector: "[data-student-selection-line]" })).toHaveLength(2);
    expect(document.querySelector("[data-student-selection-highlight]")).toBeInTheDocument();

    rerender(<SelectionOverlay selection={resting({ ...IDLE_SELECTION })} />);
    expect(document.querySelector("[data-student-selection-highlight]")).toBeNull();
  });

  it("never lets a decoration intercept the finger", () => {
    render(<SelectionOverlay selection={resting()} />);

    expect(document.querySelector("[data-student-selection-highlight]")).toHaveStyle({
      pointerEvents: "none",
    });
    expect(document.querySelector("[data-selection-floating-layer]")).toHaveStyle({
      pointerEvents: "none",
    });
    expect(screen.getByRole("button", { name: "Adjust selection start" })).toHaveStyle({
      pointerEvents: "auto",
    });
  });

  it("moves a line by transform rather than by re-laying it out", () => {
    render(<SelectionOverlay selection={resting()} />);

    expect(screen.getAllByText("", { selector: "[data-student-selection-line]" })[0]).toHaveStyle({
      transform: "translate3d(10px, 100px, 0)",
    });
  });
});

describe("handles", () => {
  it("offers both endpoints as labelled controls, with the grabber pointing outward", () => {
    render(<SelectionOverlay selection={resting()} />);

    const start = screen.getByRole("button", { name: "Adjust selection start" });
    const end = screen.getByRole("button", { name: "Adjust selection end" });

    expect(start).toHaveAttribute("data-stem", "up");
    expect(end).toHaveAttribute("data-stem", "down");
    expect(start).toHaveAttribute("data-student-selection-handle", "start");
  });

  it("scales the visible grip without shrinking the 44px handle target", () => {
    render(<SelectionOverlay selection={resting()} visualScale={0.5} />);

    const start = screen.getByRole("button", { name: "Adjust selection start" });
    expect(start).toHaveClass("selection-v2-handle");
    expect(start.style.width).toBe("");
    expect(start.style.height).toBe("");
    expect(start.style.transform).toBe("translate3d(10px, 100px, 0) translate(-50%, -50%)");
    expect(start.querySelector(".selection-v2-grip-visual")).toHaveStyle({
      transform: "scale(0.5)",
    });
  });

  it("uses a product-owned physical viewport portal root when supplied", () => {
    const viewportRoot = document.createElement("div");
    document.body.append(viewportRoot);
    const view = render(<SelectionOverlay selection={resting()} portalContainer={viewportRoot} />);

    expect(viewportRoot.querySelector("[data-selection-floating-layer]")).toBeInTheDocument();
    view.unmount();
    viewportRoot.remove();
  });

  it("starts adjusting the edge that was grabbed, with the pointer it was grabbed by", () => {
    const selection = resting();
    render(<SelectionOverlay selection={selection} />);

    fireEvent.pointerDown(screen.getByRole("button", { name: "Adjust selection end" }), {
      pointerId: 7,
      clientX: 50,
      clientY: 144,
    });

    expect(selection.beginHandleAdjustment).toHaveBeenCalledWith(
      expect.objectContaining({ pointerId: 7, clientX: 50, clientY: 144 })
    );
  });

  /**
   * A 20px word on a 21px line: the END handle's 44px box is centred on the
   * line's bottom edge, so it reaches 1px ABOVE the line's top — over the START
   * handle's entire outward zone. On a real paint a press at (20, 101) is
   * delivered to the END control while belonging to the START, and a rule that
   * asks only the control it landed on refuses it and consumes the press as the
   * selection's body: the handle the student aimed at never moves.
   */
  function shortWord() {
    return resting({
      rects: [{ left: 10, top: 100, width: 20, height: 21 }],
      startHandle: { edge: "start", x: 10, y: 100, direction: "ltr", stem: "up" },
      endHandle: { edge: "end", x: 30, y: 121, direction: "ltr", stem: "down" },
    });
  }

  it("begins a drag for a press inside an endpoint zone, whatever control received it", () => {
    const selection = shortWord();
    render(<SelectionOverlay selection={selection} />);
    const end = screen.getByRole("button", { name: "Adjust selection end" });
    const sawPointerDown = vi.fn();
    document.addEventListener("pointerdown", sawPointerDown);
    try {
      const event = createEvent.pointerDown(end, { bubbles: true, clientX: 20, clientY: 101 });
      fireEvent(end, event);

      // One intent: a handle drag begins, from a press nothing below may act on.
      expect(selection.beginHandleAdjustment).toHaveBeenCalledTimes(1);
      // Captured on the control the finger landed on — where the moves will be
      // delivered — while the endpoint itself is decided by the paint.
      expect(selection.beginHandleAdjustment).toHaveBeenCalledWith(
        expect.objectContaining({ clientX: 20, clientY: 101, currentTarget: end })
      );
      expect(event.defaultPrevented).toBe(true);
      expect(sawPointerDown).not.toHaveBeenCalled();
      expect(selection.dismiss).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener("pointerdown", sawPointerDown);
    }
  });

  it("grabs that endpoint even when the press did not land on a handle control at all", () => {
    // (16, 99) is 1px above the line and inside the START handle's own box: a
    // valid grab that the paint could deliver to anything at all — a stray
    // overlay, the prose underneath. An overlay that reads only the element it
    // was handed calls this press OUTSIDE the selection, dismisses it, and the
    // handle never moves; the zone is the only thing that decides.
    const selection = shortWord();
    // The session answers "a drag began" — it is the one that arbitrates, and
    // this layer acts on its verdict rather than on a guess of its own.
    selection.beginHandleAdjustment = vi.fn(() => true);
    render(<SelectionOverlay selection={selection} />);
    const elsewhere = document.createElement("p");
    elsewhere.textContent = "alpha beta gamma";
    document.body.append(elsewhere);
    const sawPointerDown = vi.fn();
    document.addEventListener("pointerdown", sawPointerDown);
    try {
      const event = createEvent.pointerDown(elsewhere, { bubbles: true, clientX: 16, clientY: 99 });
      fireEvent(elsewhere, event);

      expect(selection.beginHandleAdjustment).toHaveBeenCalledWith(
        // Where the press landed, and the control the browser delivered it to —
        // none here, because it landed on the prose. WHICH endpoint that press
        // grabs is the session's answer, and so is the element the drag then
        // holds; a layer that resolved the endpoint here would be arbitrating a
        // press the owner already answered.
        expect.objectContaining({ clientX: 16, clientY: 99, currentTarget: null })
      );
      expect(event.defaultPrevented).toBe(true);
      expect(selection.dismiss).not.toHaveBeenCalled();
      expect(sawPointerDown).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener("pointerdown", sawPointerDown);
    }
  });

  it("keeps a press that lands on a control but in no zone inert, never a dismissal", () => {
    const selection = shortWord();
    render(<SelectionOverlay selection={selection} />);
    const end = screen.getByRole("button", { name: "Adjust selection end" });
    const sawPointerDown = vi.fn();
    document.addEventListener("pointerdown", sawPointerDown);
    try {
      // The lower half of the end control's box is over the selected text: the
      // body's intent, and the selection's own chrome may never dismiss it.
      const event = createEvent.pointerDown(end, { bubbles: true, clientX: 22, clientY: 112 });
      fireEvent(end, event);

      // The press is REPORTED — this layer asks the session and does not answer
      // for it — and the session refuses it, so nothing begins. What the refusal
      // buys is the two lines below: the press is the selection's own body, not a
      // dismissal, and not the prose's.
      expect(selection.beginHandleAdjustment).toHaveBeenCalledTimes(1);
      expect(selection.dismiss).not.toHaveBeenCalled();
      expect(event.defaultPrevented).toBe(true);
      expect(sawPointerDown).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener("pointerdown", sawPointerDown);
    }
  });
});

describe("a resting selection can be reactivated without changing its range", () => {
  it("reports a press on the selected body and consumes the same pointerdown", () => {
    const selection = resting();
    const outsideListener = vi.fn();
    render(<SelectionOverlay selection={selection} />);
    document.addEventListener("pointerdown", outsideListener);
    try {
      const event = createEvent.pointerDown(document.body, {
        bubbles: true,
        cancelable: true,
        clientX: 30,
        clientY: 110,
      });
      fireEvent(document.body, event);

      expect(selection.activateCurrentSelection).toHaveBeenCalledTimes(1);
      expect(selection.beginHandleAdjustment).not.toHaveBeenCalled();
      expect(selection.dismiss).not.toHaveBeenCalled();
      expect(event.defaultPrevented).toBe(true);
      expect(outsideListener).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener("pointerdown", outsideListener);
    }
  });

  it("keeps the body range and paint unchanged when its consumed press is dragged", () => {
    const selection = resting();
    const before = {
      text: selection.selectionText,
      rects: structuredClone(selection.rects),
      startHandle: structuredClone(selection.startHandle),
      endHandle: structuredClone(selection.endHandle),
    };
    render(<SelectionOverlay selection={selection} />);

    const down = createEvent.pointerDown(document.body, {
      bubbles: true,
      cancelable: true,
      pointerId: 14,
      pointerType: "touch",
      clientX: 30,
      clientY: 110,
    });
    fireEvent(document.body, down);
    fireEvent.pointerMove(document.body, {
      pointerId: 14,
      pointerType: "touch",
      clientX: 46,
      clientY: 116,
    });
    fireEvent.pointerUp(document.body, {
      pointerId: 14,
      pointerType: "touch",
      clientX: 46,
      clientY: 116,
    });

    expect(selection.activateCurrentSelection).toHaveBeenCalledTimes(1);
    expect(selection.beginHandleAdjustment).not.toHaveBeenCalled();
    expect(selection.dismiss).not.toHaveBeenCalled();
    expect({
      text: selection.selectionText,
      rects: selection.rects,
      startHandle: selection.startHandle,
      endHandle: selection.endHandle,
    }).toEqual(before);
  });
});

describe("outside dismissal with native text selection", () => {
  it("consumes the first outside mouse drag that would begin another text selection", () => {
    const selection = resting({ wouldStartOwnedSelection: vi.fn(() => true) });
    const prose = document.createElement("p");
    prose.textContent = "new selectable prose";
    document.body.append(prose);
    const pagePointerDown = vi.fn();
    document.addEventListener("pointerdown", pagePointerDown);
    try {
      render(<SelectionOverlay selection={selection} />);
      const event = createEvent.pointerDown(prose, {
        bubbles: true,
        cancelable: true,
        pointerId: 21,
        pointerType: "mouse",
        button: 0,
        clientX: 300,
        clientY: 300,
      });
      fireEvent(prose, event);

      expect(selection.dismiss).toHaveBeenCalledTimes(1);
      expect(selection.wouldStartOwnedSelection).toHaveBeenCalledWith(event);
      expect(event.defaultPrevented).toBe(true);
      expect(pagePointerDown).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener("pointerdown", pagePointerDown);
      prose.remove();
    }
  });
});

/**
 * The overlay paints and dismisses; it does not raise a menu. A product's
 * toolbar must also appear for the browser's own selection — a mouse drag, a
 * shift-arrow — which is exactly the state in which this overlay paints nothing,
 * so the menu is owned by whoever owns the toolbar (see `SelectionActionMenu`).
 * What the overlay does owe that menu is a press it can read as a command.
 */
describe("the boundary with the product menu", () => {
  it("paints no menu of its own", () => {
    render(<SelectionOverlay selection={resting()} />);

    expect(screen.queryByRole("toolbar")).toBeNull();
  });

  it("reads a press on a handle, or on the menu raised for this selection, as inside it", () => {
    const selection = resting();
    render(
      <>
        <SelectionOverlay selection={selection} />
        <div data-selection-action-menu="true">
          <button type="button">Highlight</button>
        </div>
      </>
    );

    fireEvent.pointerDown(screen.getByRole("button", { name: "Highlight" }));
    fireEvent.pointerDown(screen.getByRole("button", { name: "Adjust selection start" }));
    expect(selection.dismiss).not.toHaveBeenCalled();

    fireEvent.pointerDown(document.body);
    expect(selection.dismiss).toHaveBeenCalledTimes(1);
  });
});

describe("the loupe", () => {
  const source = () => {
    const element = document.createElement("p");
    element.textContent = "alpha beta";
    document.body.append(element);
    return { current: element };
  };

  it("appears while text is being claimed or an endpoint moved, and nowhere else", () => {
    const sourceRef = source();
    const { rerender } = render(<SelectionOverlay selection={resting()} loupe={{ sourceRef }} />);
    expect(screen.queryByText("", { selector: "[data-selection-loupe]" })).toBeNull();

    rerender(
      <SelectionOverlay
        selection={resting({ phase: "adjusting-end", adjusting: true })}
        loupe={{ sourceRef }}
      />
    );
    expect(document.querySelector("[data-selection-loupe]")).toBeInTheDocument();
    expect(document.querySelector("[data-selection-loupe-source]")).toHaveTextContent("alpha beta");

    rerender(<SelectionOverlay selection={resting({ pointer: null })} loupe={{ sourceRef }} />);
    expect(document.querySelector("[data-selection-loupe]")).toBeNull();

    rerender(
      <SelectionOverlay
        selection={resting({ phase: "adjusting-end", adjusting: true })}
        loupe={{ sourceRef, enabled: false }}
      />
    );
    expect(document.querySelector("[data-selection-loupe]")).toBeNull();
  });
});

describe("dismissal", () => {
  it("ends the selection on Escape", () => {
    const selection = resting();
    render(<SelectionOverlay selection={selection} />);

    fireEvent.keyDown(document, { key: "Escape" });

    expect(selection.dismiss).toHaveBeenCalledTimes(1);
  });

  it("dismisses contextual tools on the first Escape and the selection on the second", () => {
    const selection = resting();
    const onEscape = vi.fn().mockReturnValueOnce(true).mockReturnValueOnce(false);
    const onSelectionCleared = vi.fn();
    render(
      <SelectionOverlay
        selection={selection}
        onEscape={onEscape}
        onSelectionCleared={onSelectionCleared}
      />
    );

    fireEvent.keyDown(document, { key: "Escape" });
    expect(selection.dismiss).not.toHaveBeenCalled();
    expect(onSelectionCleared).not.toHaveBeenCalled();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(selection.dismiss).toHaveBeenCalledTimes(1);
    expect(onSelectionCleared).toHaveBeenCalledTimes(1);
  });

  it("ends the selection on a press outside it", () => {
    const selection = resting();
    render(<SelectionOverlay selection={selection} />);

    fireEvent.pointerDown(document.body);

    expect(selection.dismiss).toHaveBeenCalled();
  });

  it("listens for nothing while there is no selection", () => {
    const selection = resting({ ...IDLE_SELECTION });
    render(<SelectionOverlay selection={selection} />);

    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.pointerDown(document.body);

    expect(selection.dismiss).not.toHaveBeenCalled();
  });
});

/**
 * The interaction rule a resting selection lives by (docs/selectionui.md):
 * it can only be RESIZED by acquiring one of its two visible endpoint handles,
 * and a press inside the selected text must never move an endpoint, open the
 * loupe, dismiss the selection, or start a new gesture — one physical
 * pointerdown holds exactly one intent.
 *
 * The fixture's two 44×44 endpoint boxes overlap over the selected line (any
 * selection narrower than 44px does), which is the geometry that used to make
 * a press in the MIDDLE land on an invisible handle target.
 */
describe("a resting selection is resized only by acquiring a visible handle", () => {
  /** The centre of the first painted line: inside both handles' boxes. */
  const midpoint = { clientX: 60, clientY: 110 };

  /** A prose element to press on, standing in for the exam's own passage. */
  function prose(): HTMLElement {
    const element = document.createElement("p");
    element.textContent = "alpha beta gamma";
    document.body.append(element);
    return element;
  }

  it("acquires the handle only from the outward side of its line", () => {
    const selection = resting();
    render(<SelectionOverlay selection={selection} />);
    const start = screen.getByRole("button", { name: "Adjust selection start" });

    // Above the line: the start handle's own zone — a drag may begin here.
    fireEvent.pointerDown(start, { clientX: 10, clientY: 90 });
    expect(selection.beginHandleAdjustment).toHaveBeenCalledWith(
      expect.objectContaining({ clientX: 10, clientY: 90 })
    );
    expect(selection.dismiss).not.toHaveBeenCalled();
  });

  it("acquires neither handle from the midpoint, even when the press lands on a handle box", () => {
    const selection = resting();
    render(<SelectionOverlay selection={selection} />);
    const end = screen.getByRole("button", { name: "Adjust selection end" });
    const sawPointerDown = vi.fn();
    document.addEventListener("pointerdown", sawPointerDown);
    try {
      // The end handle's 44px box covers the midpoint of this short selection,
      // so without a directional acquisition rule this press grabs the end.
      const event = createEvent.pointerDown(end, { bubbles: true, ...midpoint });
      fireEvent(end, event);

      // Reported once and refused by the session: the midpoint acquires neither
      // endpoint, and the answer to that is the SELECTION's body rather than a
      // drag — decided by the owner, not by whether a control box covers it.
      expect(selection.beginHandleAdjustment).toHaveBeenCalledTimes(1);
      expect(selection.dismiss).not.toHaveBeenCalled();
      // Consumed: neither the prose below nor a later gesture may see it.
      expect(event.defaultPrevented).toBe(true);
      expect(sawPointerDown).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener("pointerdown", sawPointerDown);
    }
  });

  it("treats a press on the selected text itself as a no-drag zone: preserved, never dismissed", () => {
    const selection = resting();
    render(<SelectionOverlay selection={selection} />);
    const body = prose();
    const sawPointerDown = vi.fn();
    document.addEventListener("pointerdown", sawPointerDown);
    try {
      const event = createEvent.pointerDown(body, { bubbles: true, ...midpoint });
      fireEvent(body, event);

      expect(selection.dismiss).not.toHaveBeenCalled();
      expect(selection.activateCurrentSelection).toHaveBeenCalledTimes(1);
      expect(selection.beginHandleAdjustment).not.toHaveBeenCalled();
      expect(event.defaultPrevented).toBe(true);
      // stopPropagation in capture: the event never reaches the target, so the
      // prose's own pointerdown — the thing that would start a new selection —
      // cannot see this press at all.
      expect(sawPointerDown).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener("pointerdown", sawPointerDown);
    }
  });

  it("resolves an outside press the gesture would handle to dismiss() AND consume, at capture", () => {
    const selection = resting({ wouldBeginGesture: vi.fn(() => true) });
    render(<SelectionOverlay selection={selection} />);
    const body = prose();
    const sawPointerDown = vi.fn();
    document.addEventListener("pointerdown", sawPointerDown);
    try {
      const event = createEvent.pointerDown(body, { bubbles: true, clientX: 400, clientY: 400 });
      fireEvent(body, event);

      // The literal rule (docs/selectionui.md): dismissed in this capture pass,
      // and the pointerdown consumed — the prose's own handler never sees it,
      // so the same press ends the old selection and cannot also open a hidden
      // `selected → idle → pending` underneath it.
      expect(selection.dismiss).toHaveBeenCalledTimes(1);
      expect(event.defaultPrevented).toBe(true);
      expect(sawPointerDown).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener("pointerdown", sawPointerDown);
    }
  });

  it("dismisses but still delivers an outside press the gesture would never handle", () => {
    const selection = resting({ wouldBeginGesture: vi.fn(() => false) });
    render(<SelectionOverlay selection={selection} />);
    const body = prose();
    const received = vi.fn();
    body.addEventListener("pointerdown", received);

    const event = createEvent.pointerDown(body, { bubbles: true, clientX: 400, clientY: 400 });
    fireEvent(body, event);

    // Toolbars, answer fields, every other control: one dismissal here, and
    // the press still reaches its target — the gesture's handler cannot see
    // them anyway, so consuming would only break the rest of the page.
    expect(selection.dismiss).toHaveBeenCalledTimes(1);
    expect(received).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(false);
  });

  it("dismisses an outside action control without also starting a selection gesture", () => {
    const selection = resting({ wouldBeginGesture: vi.fn(() => true) });
    render(<SelectionOverlay selection={selection} />);
    const action = document.createElement("button");
    action.textContent = "Edit annotation";
    document.body.append(action);
    const received = vi.fn();
    action.addEventListener("pointerdown", received);

    const event = createEvent.pointerDown(action, { bubbles: true, cancelable: true });
    fireEvent(action, event);

    expect(selection.dismiss).toHaveBeenCalledTimes(1);
    expect(selection.ignoreGesturePress).toHaveBeenCalledWith(event);
    expect(received).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(false);
    action.remove();
  });
});
