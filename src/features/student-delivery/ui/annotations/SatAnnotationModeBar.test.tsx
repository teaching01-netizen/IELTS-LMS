import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createSatReadingPreferences } from "../../domain/satReadingPreferences";
import { emptySatAnnotations } from "../../domain/satResponses";
import { SatAnnotatedContent } from "./SatAnnotatedContent";
import { SatAnnotationModeContext } from "./SatAnnotationModeContext";

const content = { version: 1 as const, nodes: [{ type: "paragraph" as const, id: "p", text: "A tree grows." }] };

function renderMode(mode: "none" | "highlight" | "underline" | "erase") {
  return render(
    <SatAnnotationModeContext.Provider value={mode}>
      <SatAnnotatedContent content={content} annotations={emptySatAnnotations()} region="stimulus" enabled onChange={vi.fn()} />
    </SatAnnotationModeContext.Provider>,
  );
}

describe("SatAnnotatedContent mode bar", () => {
  it("keeps highlight mode silent: sr-only status, no visible Done control", () => {
    renderMode("highlight");
    // Screen-reader status preserved for AT; no visible bar, no Done button
    // (highlight exits via the top-bar Highlight toggle or Escape).
    expect(screen.getByTestId("sat-annotation-mode-bar-stimulus")).toHaveTextContent("Highlighting");
    expect(screen.queryByRole("button", { name: "Done" })).not.toBeInTheDocument();
  });

  it("renders an erase-armed region with non-color cues", () => {
    const { container } = render(
    <SatAnnotationModeContext.Provider value="erase">
      <SatAnnotatedContent
        content={content}
        annotations={{ version: 2, annotations: [], legacyQuestionNote: "" }}
        region="stimulus"
        enabled
        onChange={vi.fn()}
      />
    </SatAnnotationModeContext.Provider>,
    );
    const region = container.querySelector("[data-sat-annotation-region]")!;
    expect(region).toHaveAttribute("data-sat-erase-armed", "true");
    expect(screen.getByTestId("sat-annotation-mode-bar-stimulus")).toHaveTextContent("Eraser on");
  });

  it("announces the 200-annotation cap instead of dropping input silently", () => {
    const { container } = render(
      <SatAnnotationModeContext.Provider value="underline">
        <SatAnnotatedContent
          content={content}
          annotations={{
            version: 2,
            annotations: Array.from({ length: 200 }, (_, index) => ({
              id: "a" + index,
              kind: "highlight" as const,
              anchor: { nodeId: "stimulus:p", startOffset: 0, endOffset: 1, exact: "A", prefix: "", suffix: "" },
              createdAt: "2026-01-01T00:00:00Z",
              updatedAt: "2026-01-01T00:00:00Z",
            })),
            legacyQuestionNote: "",
          }}
          region="stimulus"
          enabled
          onChange={vi.fn()}
        />
      </SatAnnotationModeContext.Provider>,
    );
    const leaf = container.querySelector("[data-content-text-node] span span")!.firstChild!;
    const range = document.createRange();
    range.setStart(leaf, 0);
    range.setEnd(leaf, 1);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    fireEvent.pointerUp(container.querySelector("[data-sat-annotation-region]")!);
    expect(screen.getByTestId("sat-annotation-limit-stimulus")).toHaveTextContent(/Note limit reached/);
  });

  it("stays silent with no mode bar when no mode is armed", () => {
    renderMode("none");
    expect(screen.queryByTestId("sat-annotation-mode-bar-stimulus")).not.toBeInTheDocument();
  });
});
