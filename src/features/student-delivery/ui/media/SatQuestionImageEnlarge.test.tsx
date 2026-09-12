import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SatQuestionImageEnlarge } from "./SatQuestionImageEnlarge";

describe("SatQuestionImageEnlarge", () => {
  it("opens the viewer from enlarge and closes with focus back", async () => {
    const user = userEvent.setup();
    let open = false;
    const { rerender } = render(
      <SatQuestionImageEnlarge
        label="Graph of f"
        enlargeId="sat-enlarge-test"
        src="https://example.com/graph.png"
        open={open}
        onOpen={() => { open = true; }}
        onClose={() => { open = false; }}
        returnFocusSelector="#sat-enlarge-test"
      />
    );
    await user.click(screen.getByRole("button", { name: /Enlarge image: Graph of f/ }));
    expect(open).toBe(true);
    rerender(
      <SatQuestionImageEnlarge
        label="Graph of f"
        enlargeId="sat-enlarge-test"
        src="https://example.com/graph.png"
        open={open}
        onOpen={() => { open = true; }}
        onClose={() => { open = false; }}
        returnFocusSelector="#sat-enlarge-test"
      />
    );
    expect(screen.getByRole("dialog", { name: "Image viewer" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Close image viewer" }));
    expect(open).toBe(false);
    rerender(
      <SatQuestionImageEnlarge
        label="Graph of f"
        enlargeId="sat-enlarge-test"
        src="https://example.com/graph.png"
        open={open}
        onOpen={() => { open = true; }}
        onClose={() => { open = false; }}
        returnFocusSelector="#sat-enlarge-test"
      />
    );
    expect(screen.queryByRole("dialog", { name: "Image viewer" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Enlarge image/ })).toHaveFocus();
  });
});
