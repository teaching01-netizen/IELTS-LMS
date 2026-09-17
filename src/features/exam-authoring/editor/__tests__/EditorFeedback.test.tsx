import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorFeedback } from "../EditorFeedback";
import {
  FEEDBACK_INFO_MS,
  FEEDBACK_UNDO_MS,
  buildActionFeedback,
  buildPasteFeedback,
} from "../editorFeedbackCopy";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("editor feedback copy", () => {
  it("keeps the paste vocabulary it replaced", () => {
    expect(
      buildPasteFeedback(
        { visible: true, imageCount: 0, mathCount: 2, needsAltText: false },
        { onUndo: vi.fn() },
        "f1"
      )?.message
    ).toBe("2 equations formatted");
    const rejected = buildPasteFeedback(
      {
        visible: true,
        imageCount: 0,
        mathCount: 0,
        needsAltText: false,
        rejectedImageCount: 1,
        canUndo: false,
      },
      { onUndo: vi.fn() },
      "f2"
    );
    expect(rejected?.message).toBe("1 visual was not imported.");
    expect(rejected?.actions).toEqual([]);
    expect(
      buildPasteFeedback(
        { visible: true, imageCount: 1, mathCount: 0, needsAltText: true },
        { onUndo: vi.fn(), onAddAltText: vi.fn() },
        "f3"
      )?.actions.map((action) => action.label)
    ).toEqual(["Add alt text", "Undo paste"]);
  });

  it("withholds Undo when there is nothing to take back", () => {
    const rejected = buildPasteFeedback(
      { visible: true, imageCount: 0, mathCount: 0, needsAltText: false, rejectedImageCount: 2, canUndo: false },
      { onUndo: vi.fn() },
      "f1"
    );
    expect(rejected?.undoable).toBe(false);
    expect(buildActionFeedback({ message: "Image deleted", undoable: true }, "f2", vi.fn()).undoable).toBe(true);
  });
});

describe("the acknowledgement surface", () => {
  it("says what happened and offers the way back", () => {
    const undo = vi.fn();
    render(
      <EditorFeedback
        feedback={buildActionFeedback({ message: "Image deleted", undoable: true }, "f1", undo)}
        onDismiss={vi.fn()}
      />
    );
    expect(screen.getByRole("status")).toHaveTextContent("Image deleted");
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(undo).toHaveBeenCalledTimes(1);
  });

  it("holds an undoable action for six seconds and a plain one for four", () => {
    const onDismiss = vi.fn();
    const { rerender } = render(
      <EditorFeedback
        feedback={buildActionFeedback({ message: "Image deleted", undoable: true }, "f1", vi.fn())}
        onDismiss={onDismiss}
      />
    );
    act(() => {
      vi.advanceTimersByTime(FEEDBACK_UNDO_MS - 1);
    });
    expect(onDismiss).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(onDismiss).toHaveBeenCalledTimes(1);

    rerender(
      <EditorFeedback
        feedback={buildActionFeedback({ message: "Pasted formatted content" }, "f2", vi.fn())}
        onDismiss={onDismiss}
      />
    );
    act(() => {
      vi.advanceTimersByTime(FEEDBACK_INFO_MS - 1);
    });
    expect(onDismiss).toHaveBeenCalledTimes(1);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(onDismiss).toHaveBeenCalledTimes(2);
  });

  it("stops counting down while the author is reading it", () => {
    const onDismiss = vi.fn();
    render(
      <EditorFeedback
        feedback={buildActionFeedback({ message: "Image deleted", undoable: true }, "f1", vi.fn())}
        onDismiss={onDismiss}
      />
    );
    fireEvent.mouseEnter(screen.getByRole("status"));
    act(() => {
      vi.advanceTimersByTime(FEEDBACK_UNDO_MS * 3);
    });
    expect(onDismiss).not.toHaveBeenCalled();
    fireEvent.mouseLeave(screen.getByRole("status"));
    act(() => {
      vi.advanceTimersByTime(FEEDBACK_UNDO_MS);
    });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("renders nothing when there is nothing to say", () => {
    render(<EditorFeedback feedback={null} onDismiss={vi.fn()} />);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("runs the actions it was given, in order", () => {
    const onAddAltText = vi.fn();
    render(
      <EditorFeedback
        feedback={buildPasteFeedback(
          { visible: true, imageCount: 1, mathCount: 0, needsAltText: true },
          { onUndo: vi.fn(), onAddAltText },
          "f1"
        )}
        onDismiss={vi.fn()}
      />
    );
    expect(screen.getByRole("status")).toHaveTextContent("add alt text");
    fireEvent.click(screen.getByRole("button", { name: "Add alt text" }));
    expect(onAddAltText).toHaveBeenCalledTimes(1);
  });
});
