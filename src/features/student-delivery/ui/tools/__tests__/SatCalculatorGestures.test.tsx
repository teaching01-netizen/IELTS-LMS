import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { SatFloatingTool } from "../SatFloatingTool";
import { SatExamZoomPlane } from "../../zoom/SatExamZoomContext";
import {
  loadSatToolGeometry,
  satToolGeometryKey,
} from "../../../infrastructure/satToolGeometryStore";

const geometryKey = satToolGeometryKey("gesture", "attempt", "module", "calculator:portrait-v2");
const defaultGeometry = { x: 20, y: 60, w: 210, h: 250 };
const safeArea = { top: 48, right: 16, bottom: 35, left: 16 };
const minimum = { w: 200, h: 100 };
const maximum = { w: 310, h: 300 };
let frames: Map<number, FrameRequestCallback>;
let frameId: number;
const onClose = vi.fn();
function TestTool({
  open = true,
  disabled = false,
  scale = 2,
}: {
  open?: boolean;
  disabled?: boolean;
  scale?: number;
}) {
  return (
    <SatExamZoomPlane scale={scale} viewportClassName="">
      <SatFloatingTool
        title="Calculator"
        open={open}
        disabled={disabled}
        keepAlive
        resizable
        geometryKey={geometryKey}
        defaultGeometry={defaultGeometry}
        geometryScale={scale}
        safeArea={safeArea}
        minSize={minimum}
        maxSize={maximum}
        headerControls={
          <button type="button" role="radio">
            Scientific
          </button>
        }
        onClose={onClose}
      >
        calculator
      </SatFloatingTool>
    </SatExamZoomPlane>
  );
}
function pointer(node: HTMLElement, type: string, x: number, y: number, pointerType = "mouse") {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y });
  Object.assign(event, { pointerId: 1, isPrimary: true, pointerType });
  fireEvent(node, event);
}
function flush() {
  act(() => {
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach((cb) => cb(0));
  });
}
const panel = () => screen.getByRole("dialog", { name: "Calculator" });
const grip = () => screen.getByRole("button", { name: /Move Calculator/ });

beforeEach(() => {
  localStorage.clear();
  onClose.mockClear();
  frameId = 0;
  frames = new Map();
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
    frames.set(++frameId, cb);
    return frameId;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => {
    frames.delete(id);
  });
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }))
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Calculator gestures", () => {
  it("drags from the visible grip, batches moves, and persists once on release at Display 200%", () => {
    const storage = vi.spyOn(window.localStorage, "setItem");
    render(<TestTool />);
    pointer(grip(), "pointerdown", 80, 140);
    pointer(grip(), "pointermove", 160, 140);
    pointer(grip(), "pointermove", 200, 160);
    expect(panel().style.left).toBe("20px");
    flush();
    expect(panel().style.left).toBe("80px");
    expect(panel().style.top).toBe("70px");
    expect(storage.mock.calls.filter(([key]) => key === geometryKey)).toHaveLength(0);
    pointer(grip(), "pointerup", 200, 160);
    expect(storage.mock.calls.filter(([key]) => key === geometryKey)).toHaveLength(1);
    expect(loadSatToolGeometry(geometryKey)).toMatchObject({ x: 160, y: 140, w: 420, h: 500 });
    expect(document.documentElement).not.toHaveClass("sat-tool-noselect");
  });

  it.each(["pointercancel", "lostpointercapture", "Escape", "blur"])(
    "restores the starting rectangle after %s without saving",
    (interruption) => {
      render(<TestTool />);
      pointer(grip(), "pointerdown", 80, 140);
      pointer(grip(), "pointermove", 200, 160);
      flush();
      expect(panel().style.left).toBe("80px");
      if (interruption === "Escape") fireEvent.keyDown(document, { key: "Escape" });
      else if (interruption === "blur") fireEvent(window, new Event("blur"));
      else pointer(grip(), interruption, 200, 160);
      expect(panel().style.left).toBe("20px");
      expect(loadSatToolGeometry(geometryKey)).toBeNull();
      expect(document.documentElement).not.toHaveClass("sat-tool-noselect");
      expect(onClose).not.toHaveBeenCalled();
    }
  );

  it("cancels pending frames on close, disable and unmount", () => {
    const { rerender, unmount } = render(<TestTool />);
    pointer(grip(), "pointerdown", 80, 140);
    pointer(grip(), "pointermove", 200, 160);
    rerender(<TestTool open={false} />);
    flush();
    expect(loadSatToolGeometry(geometryKey)).toBeNull();
    expect(document.documentElement).not.toHaveClass("sat-tool-noselect");
    rerender(<TestTool />);
    pointer(grip(), "pointerdown", 80, 140);
    pointer(grip(), "pointermove", 200, 160);
    flush();
    rerender(<TestTool disabled />);
    expect(panel().style.left).toBe("20px");
    rerender(<TestTool />);
    pointer(grip(), "pointerdown", 80, 140);
    pointer(grip(), "pointermove", 200, 160);
    unmount();
    flush();
    expect(document.documentElement).not.toHaveClass("sat-tool-noselect");
    expect(loadSatToolGeometry(geometryKey)).toBeNull();
  });

  it("excludes mode and Close buttons from dragging", () => {
    render(<TestTool />);
    for (const control of [
      screen.getByRole("radio"),
      screen.getByRole("button", { name: "Close Calculator" }),
    ]) {
      pointer(control, "pointerdown", 80, 140);
      pointer(control, "pointermove", 200, 160);
      flush();
      expect(panel().style.left).toBe("20px");
      expect(document.documentElement).not.toHaveClass("sat-tool-noselect");
    }
  });

  it("saves resize only after release and keeps physical dimensions across Display zoom", () => {
    const { rerender } = render(<TestTool />);
    const resize = screen.getByRole("separator", { name: /Resize Calculator/ });
    pointer(resize, "pointerdown", 460, 620);
    pointer(resize, "pointermove", 500, 620);
    flush();
    expect(panel().style.width).toBe("230px");
    expect(loadSatToolGeometry(geometryKey)).toBeNull();
    pointer(resize, "pointerup", 500, 620);
    expect(loadSatToolGeometry(geometryKey)?.w).toBe(460);
    rerender(<TestTool scale={1} />);
    expect(panel().style.width).toBe("460px");
  });

  it("marks touch interaction without dropping accessible labels", () => {
    render(<TestTool />);
    pointer(grip(), "pointerdown", 80, 140, "touch");
    expect(panel()).toHaveAttribute("data-sat-touch-interaction", "true");
    expect(grip()).toHaveAccessibleName(/Move Calculator/);
    pointer(grip(), "pointercancel", 80, 140, "touch");
  });
});
