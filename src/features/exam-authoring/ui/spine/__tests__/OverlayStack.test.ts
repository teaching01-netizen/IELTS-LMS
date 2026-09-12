import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useOverlayStack } from "../useOverlayStack";

describe("useOverlayStack — max one modal plus one sheet", () => {
  it("refuses a second dialog while one is open and keeps the first", () => {
    const { result } = renderHook(() => useOverlayStack());
    let first = false;
    let second = true;
    act(() => {
      first = result.current.requestOpen("shortcuts", "dialog");
    });
    act(() => {
      second = result.current.requestOpen("confirm-delete", "dialog");
    });
    expect(first).toBe(true);
    expect(second).toBe(false);
    expect(result.current.openDialog).toBe("shortcuts");
  });

  it("allows one sheet alongside one dialog", () => {
    const { result } = renderHook(() => useOverlayStack());
    let dialog = false;
    let sheet = false;
    act(() => {
      dialog = result.current.requestOpen("shortcuts", "dialog");
    });
    act(() => {
      sheet = result.current.requestOpen("preview", "sheet");
    });
    expect(dialog).toBe(true);
    expect(sheet).toBe(true);
  });

  it("refuses a second sheet while one is open", () => {
    const { result } = renderHook(() => useOverlayStack());
    let first = false;
    let second = true;
    act(() => {
      first = result.current.requestOpen("preview", "sheet");
    });
    act(() => {
      second = result.current.requestOpen("queue", "sheet");
    });
    expect(first).toBe(true);
    expect(second).toBe(false);
    expect(result.current.openSheet).toBe("preview");
  });

  it("reopens after close", () => {
    const { result } = renderHook(() => useOverlayStack());
    act(() => {
      result.current.requestOpen("shortcuts", "dialog");
    });
    act(() => {
      result.current.close("shortcuts");
    });
    let reopened = false;
    act(() => {
      reopened = result.current.requestOpen("confirm-delete", "dialog");
    });
    expect(reopened).toBe(true);
    expect(result.current.openDialog).toBe("confirm-delete");
  });
});
