import { useState } from "react";
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useSatReferenceStageSize } from "../useSatReferenceViewportWidth";

const observers: StageObserver[] = [];
class StageObserver {
  observe = vi.fn();
  disconnect = vi.fn();
  constructor(public callback: ResizeObserverCallback) { observers.push(this); }
  tick() { this.callback([], this as unknown as ResizeObserver); }
}
let width = 900;
let height = 470;
function Panel({ open, presentation = "floating" }: { open: boolean; presentation?: string }) {
  const [node, attachNode] = useState<HTMLDivElement | null>(null);
  const stage = useSatReferenceStageSize(node, { w: 920, h: 516 });
  return <>
    <output data-testid="size">{stage.w}x{stage.h}:{String(stage.measured)}</output>
    {open ? <div key={presentation} ref={attachNode} /> : null}
  </>;
}
beforeEach(() => {
  observers.length = 0;
  width = 900;
  height = 470;
  vi.stubGlobal("ResizeObserver", StageObserver);
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(() => width);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(() => height);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("measures after closed → open, follows resize, and remeasures on reopen", () => {
  const { rerender, unmount } = render(<Panel open={false} />);
  expect(screen.getByTestId("size")).toHaveTextContent("920x516:false");
  expect(observers).toHaveLength(0);
  rerender(<Panel open />);
  expect(screen.getByTestId("size")).toHaveTextContent("900x470:true");
  expect(observers[0].observe).toHaveBeenCalledTimes(1);
  width = 740; height = 400;
  act(() => observers[0].tick());
  expect(screen.getByTestId("size")).toHaveTextContent("740x400:true");
  rerender(<Panel open={false} />);
  expect(observers[0].disconnect).toHaveBeenCalledTimes(1);
  width = 800; height = 420;
  act(() => observers[0].tick());
  expect(screen.getByTestId("size")).toHaveTextContent("740x400:true");
  rerender(<Panel open />);
  expect(screen.getByTestId("size")).toHaveTextContent("800x420:true");
  expect(observers).toHaveLength(2);
  unmount();
  expect(observers[1].disconnect).toHaveBeenCalledTimes(1);
});

it("replaces the observer when floating and compact presentations replace the stage", () => {
  const { rerender } = render(<Panel open />);
  width = 390; height = 550;
  rerender(<Panel open presentation="compact" />);
  expect(observers[0].disconnect).toHaveBeenCalledTimes(1);
  expect(observers).toHaveLength(2);
  expect(screen.getByTestId("size")).toHaveTextContent("390x550:true");
});
