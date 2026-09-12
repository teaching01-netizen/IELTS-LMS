import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { StructuredContent } from "../api/assessmentContracts";
import { RichStructuredContentRenderer } from "../RichStructuredContentRenderer";
import type { SatImageEnlargeProps } from "../api/structuredContentEnlarge";

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

describe("StaticStructuredImage enlarge", () => {
  it("renders no enlarge affordance without a slot (consumer opts in)", () => {
    render(<RichStructuredContentRenderer content={content} />);
    expect(screen.queryByRole("button", { name: /Enlarge image/ })).not.toBeInTheDocument();
  });

  it("invokes the slot with per-image state and focus-back selector", async () => {
    const user = userEvent.setup();
    const seen: SatImageEnlargeProps[] = [];
    const { rerender } = render(
      <RichStructuredContentRenderer
        content={content}
        enlarge={{
          renderEnlarge: (props) => {
            seen.push(props);
            return (
              <button type="button" id={props.enlargeId} onClick={props.onOpen}>
                Enlarge image: {props.label}
              </button>
            );
          },
        }}
      />
    );
    const enlarge = screen.getByRole("button", { name: /Enlarge image: Graph of f/ });
    expect(seen[0]?.src).toBe("https://example.com/graph.png");
    expect(seen[0]?.open).toBe(false);
    await user.click(enlarge);
    rerender(
      <RichStructuredContentRenderer
        content={content}
        enlarge={{
          renderEnlarge: (props) => {
            seen.push(props);
            return <span data-testid="slot-open">{String(props.open)}</span>;
          },
        }}
      />
    );
    expect(screen.getByTestId("slot-open")).toHaveTextContent("true");
  });
});
