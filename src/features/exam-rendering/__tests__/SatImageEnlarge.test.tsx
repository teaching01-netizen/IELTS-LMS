import { describe, expect, it, vi } from "vitest";
import { createEvent, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { StructuredContent } from "../api/assessmentContracts";
import { RichStructuredContentRenderer } from "../RichStructuredContentRenderer";
import {
  SAT_IMAGE_ENLARGE_FIT_VIEW,
  type SatImageEnlargeProps,
  type SatImageEnlargeView,
  type SatImageGestureInput,
  type SatImageGestureIntent,
} from "../api/structuredContentEnlarge";

vi.mock("../../exam-authoring/api/assessmentMediaApi", () => ({
  getAssessmentMediaAsset: vi.fn(),
}));

const content: StructuredContent = {
  version: 2,
  nodes: [],
  document: {
    type: "doc",
    content: [
      {
        type: "image",
        attrs: { src: "https://example.com/graph.png", alt: "Graph of f", caption: "Figure 1" },
      },
    ],
  },
} as unknown as StructuredContent;

/**
 * jsdom has no layout: give the frame and the image the boxes and the position
 * the maths needs, so the frame reports real numbers instead of zeroes.
 */
function layOut(
  container: HTMLElement,
  box: { viewport: [number, number]; image: [number, number] },
  position: { left: number; top: number } = { left: 100, top: 50 },
) {
  const image = container.querySelector("img");
  if (!image) throw new Error("no image");
  const frame = image.parentElement;
  if (!frame) throw new Error("no frame");
  frame.getBoundingClientRect = () =>
    ({
      left: position.left,
      top: position.top,
      width: box.viewport[0],
      height: box.viewport[1],
      right: position.left + box.viewport[0],
      bottom: position.top + box.viewport[1],
      x: position.left,
      y: position.top,
      toJSON: () => ({}),
    }) as DOMRect;
  for (const [element, size] of [
    [frame, box.viewport],
    [image, box.image],
  ] as const) {
    Object.defineProperty(element, "clientWidth", { value: size[0], configurable: true });
    Object.defineProperty(element, "clientHeight", { value: size[1], configurable: true });
    Object.defineProperty(element, "offsetWidth", { value: size[0], configurable: true });
    Object.defineProperty(element, "offsetHeight", { value: size[1], configurable: true });
  }
  Object.defineProperty(image, "naturalWidth", { value: 400, configurable: true });
  Object.defineProperty(image, "naturalHeight", { value: 200, configurable: true });
  return { frame, image };
}

describe("StaticStructuredImage figure chrome", () => {
  it("renders a plain, untransformed visual without a slot (consumer opts in)", () => {
    const { container } = render(<RichStructuredContentRenderer content={content} />);
    expect(screen.queryByRole("toolbar")).not.toBeInTheDocument();
    const image = container.querySelector("img");
    expect(image).not.toHaveStyle({ transform: expect.anything() });
  });

  it("draws the consumer's strip above the framed visual, with the caption still below", () => {
    const { container } = render(
      <RichStructuredContentRenderer
        content={content}
        enlarge={{
          renderEnlarge: (props: SatImageEnlargeProps) => (
            <div role="toolbar" aria-label={"Figure controls: " + props.label} id={props.enlargeId}>
              {props.label}
            </div>
          ),
        }}
      />,
    );
    const figure = container.querySelector("figure");
    const toolbar = screen.getByRole("toolbar");
    const image = container.querySelector("img");
    const caption = screen.getByText("Figure 1");
    if (!figure || !image) throw new Error("missing frame parts");
    // The strip commands the figure, so it belongs inside the same object and
    // above the thing it magnifies.
    expect(figure.contains(toolbar)).toBe(true);
    expect(toolbar.compareDocumentPosition(image) & Node.DOCUMENT_POSITION_FOLLOWING).toBeGreaterThan(0);
    expect(image.compareDocumentPosition(caption) & Node.DOCUMENT_POSITION_FOLLOWING).toBeGreaterThan(0);
  });

  it("measures the frame and hands the geometry to the slot", async () => {
    const seen: SatImageEnlargeProps[] = [];
    const { container } = render(
      <RichStructuredContentRenderer
        content={content}
        enlarge={{
          renderEnlarge: (props) => {
            seen.push(props);
            return (
              <div role="toolbar">{`${props.geometry.viewport.width}x${props.geometry.viewport.height}|${props.geometry.image.width}x${props.geometry.image.height}|${props.geometry.natural.width}x${props.geometry.natural.height}`}</div>
            );
          },
        }}
      />,
    );
    const { image } = layOut(container, { viewport: [300, 200], image: [300, 200] });
    fireEvent.load(image);
    expect(await screen.findByText("300x200|300x200|400x200")).toBeInTheDocument();
  });

  it("applies the consumer's view to the image, and nothing at all at 100%", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <RichStructuredContentRenderer
        content={content}
        enlarge={{
          renderEnlarge: (props: SatImageEnlargeProps) => (
            <div role="toolbar">
              <button
                type="button"
                onClick={() => props.onViewChange({ zoom: 1.5, offsetX: 12, offsetY: -8 })}
              >
                zoom
              </button>
              <button type="button" onClick={() => props.onViewChange(SAT_IMAGE_ENLARGE_FIT_VIEW)}>
                reset
              </button>
            </div>
          ),
        }}
      />,
    );
    const { image } = layOut(container, { viewport: [200, 200], image: [200, 200] });
    fireEvent.load(image);
    expect(image.getAttribute("style") ?? "").not.toContain("transform");
    await user.click(screen.getByRole("button", { name: "zoom" }));
    expect(image).toHaveStyle({ transform: "translate(12px, -8px) scale(1.5)" });
    await user.click(screen.getByRole("button", { name: "reset" }));
    expect(image.getAttribute("style") ?? "").not.toContain("transform");
  });

  it("reports a drag as a pan intent, and the release as a settle, once the consumer supplies a rule", async () => {
    const views: SatImageEnlargeView[] = [];
    const intents: SatImageGestureIntent[] = [];
    const resolveGesture = vi.fn((input: SatImageGestureInput) => {
      intents.push(input.intent);
      if (input.intent.kind === "pan") {
        return {
          zoom: input.view.zoom,
          offsetX: input.view.offsetX + input.intent.dx,
          offsetY: input.view.offsetY + input.intent.dy,
        };
      }
      return input.view;
    });
    const { container } = render(
      <RichStructuredContentRenderer
        content={content}
        enlarge={{
          renderEnlarge: (props: SatImageEnlargeProps) => {
            views.push(props.view);
            return (
              <div role="toolbar">
                <button
                  type="button"
                  onClick={() => props.onViewChange({ zoom: 2, offsetX: 0, offsetY: 0 })}
                >
                  zoom
                </button>
                <span>{props.view.zoom}</span>
              </div>
            );
          },
          resolveGesture,
        }}
      />,
    );
    const { frame, image } = layOut(container, { viewport: [200, 200], image: [200, 200] });
    fireEvent.load(image);
    // Unzoomed: the figure is not a drag surface, so the passage still scrolls
    // under a finger.
    expect(frame.className).not.toContain("touch-none");
    fireEvent.pointerDown(frame, { pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(frame, { pointerId: 1, clientX: 130, clientY: 90 });
    expect(resolveGesture).not.toHaveBeenCalled();

    await userEvent.setup().click(screen.getByRole("button", { name: "zoom" }));
    fireEvent.pointerDown(frame, { pointerId: 1, clientX: 100, clientY: 100 });
    // The gesture silences the zoom transition while the pointer is down, so the
    // pan stays 1:1 with the finger.
    expect(frame).toHaveAttribute("data-sat-image-dragging", "true");
    fireEvent.pointerMove(frame, { pointerId: 1, clientX: 130, clientY: 90 });
    expect(resolveGesture).toHaveBeenCalledTimes(1);
    expect(resolveGesture.mock.calls[0]?.[0]).toMatchObject({
      intent: { kind: "pan", dx: 30, dy: -10 },
      view: { zoom: 2 },
    });
    expect(views.at(-1)).toEqual({ zoom: 2, offsetX: 30, offsetY: -10 });

    fireEvent.pointerUp(frame, { pointerId: 1 });
    expect(intents.at(-1)).toEqual({ kind: "pan-end" });
    expect(frame).not.toHaveAttribute("data-sat-image-dragging");
  });

  it("zooms where the student double-clicks, at any magnification", async () => {
    const intents: SatImageGestureIntent[] = [];
    const resolveGesture = vi.fn((input: SatImageGestureInput) => {
      intents.push(input.intent);
      return input.intent.kind === "zoom-at-point"
        ? { zoom: 1.25, offsetX: 0, offsetY: 0 }
        : input.view;
    });
    const { container } = render(
      <RichStructuredContentRenderer
        content={content}
        enlarge={{
          renderEnlarge: () => <div role="toolbar" aria-label="Figure controls" />,
          resolveGesture,
        }}
      />,
    );
    const { frame, image } = layOut(container, { viewport: [200, 100], image: [200, 100] });
    fireEvent.load(image);
    // Point is reported from the centre of the frame, so the consumer never has
    // to know where the figure sits on the page.
    fireEvent.doubleClick(frame, { clientX: 180, clientY: 40 });
    expect(intents[0]).toEqual({ kind: "zoom-at-point", point: { x: -20, y: -60 }, direction: 1 });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("keeps a keyboard path to the parts of a magnified figure the window hides", async () => {
    const intents: SatImageGestureIntent[] = [];
    const resolveGesture = vi.fn((input: SatImageGestureInput) => {
      intents.push(input.intent);
      return input.view;
    });
    const { container } = render(
      <RichStructuredContentRenderer
        content={content}
        enlarge={{
          renderEnlarge: (props: SatImageEnlargeProps) => (
            <div role="toolbar">
              <button
                type="button"
                onClick={() => props.onViewChange({ zoom: 1.5, offsetX: 0, offsetY: 0 })}
              >
                zoom
              </button>
            </div>
          ),
          resolveGesture,
        }}
      />,
    );
    const { frame, image } = layOut(container, { viewport: [200, 200], image: [200, 200] });
    fireEvent.load(image);
    // At rest the figure is content: no tab stop, nothing to move.
    expect(frame).not.toHaveAttribute("tabindex");
    expect(frame).not.toHaveAttribute("role");

    await userEvent.setup().click(screen.getByRole("button", { name: "zoom" }));
    expect(frame).toHaveAttribute("tabindex", "0");
    expect(frame).toHaveAttribute("role", "group");
    expect(frame).toHaveAttribute("aria-label", "Graph of f");
    // Arrows reveal what the enlarged window pushed out of sight, in the
    // direction the student presses.
    fireEvent.keyDown(frame, { key: "ArrowRight" });
    expect(intents.at(-1)).toEqual({ kind: "pan", dx: -40, dy: 0 });
    fireEvent.keyDown(frame, { key: "ArrowUp" });
    expect(intents.at(-1)).toEqual({ kind: "pan", dx: 0, dy: 40 });
    const before = intents.length;
    fireEvent.keyDown(frame, { key: "Enter" });
    expect(intents).toHaveLength(before);
  });

  it("leaves the browser's own menu alone until the figure has something to inspect", async () => {
    const resolveGesture = vi.fn((input: SatImageGestureInput) => input.view);
    const { container } = render(
      <RichStructuredContentRenderer
        content={content}
        enlarge={{
          renderEnlarge: (props: SatImageEnlargeProps) => (
            <div role="toolbar">
              <button
                type="button"
                onClick={() => props.onViewChange({ zoom: 2, offsetX: 0, offsetY: 0 })}
              >
                zoom
              </button>
            </div>
          ),
          resolveGesture,
        }}
      />,
    );
    const { frame, image } = layOut(container, { viewport: [200, 200], image: [200, 200] });
    fireEvent.load(image);
    const atRest = createEvent.contextMenu(frame);
    fireEvent(frame, atRest);
    expect(atRest.defaultPrevented).toBe(false);

    await userEvent.setup().click(screen.getByRole("button", { name: "zoom" }));
    const whileZoomed = createEvent.contextMenu(frame);
    fireEvent(frame, whileZoomed);
    expect(whileZoomed.defaultPrevented).toBe(true);
  });

  it("suspends the embedded image visually while fullscreen is open and restores it when closed", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <RichStructuredContentRenderer
        content={content}
        enlarge={{
          renderEnlarge: (props: SatImageEnlargeProps) => (
            <div role="toolbar">
              <button type="button" onClick={props.open ? props.onClose : props.onOpen}>
                {props.open ? "close" : "open"}
              </button>
            </div>
          ),
        }}
      />,
    );
    const image = container.querySelector("img");
    if (!image) throw new Error("no image");

    expect(image.className).not.toContain("invisible");
    expect(image).not.toHaveAttribute("aria-hidden");

    await user.click(screen.getByRole("button", { name: "open" }));

    expect(container.querySelector("img")).toBe(image);
    expect(image.className).toContain("invisible");
    expect(image).toHaveAttribute("aria-hidden", "true");

    await user.click(screen.getByRole("button", { name: "close" }));

    expect(container.querySelector("img")).toBe(image);
    expect(image.className).not.toContain("invisible");
    expect(image).not.toHaveAttribute("aria-hidden");
  });
});
