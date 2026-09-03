import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AuthoringPaneResizer } from "../AuthoringPaneResizer";

describe("AuthoringPaneResizer", () => {
  it("exposes separator semantics and changes the pane with keyboard increments", () => {
    const onChange = vi.fn();

    render(
      <AuthoringPaneResizer
        label="Question list width"
        value={320}
        min={280}
        max={480}
        step={20}
        onChange={onChange}
      />,
    );

    const separator = screen.getByRole("separator", { name: "Question list width" });
    expect(separator).toHaveAttribute("aria-orientation", "vertical");
    expect(separator).toHaveAttribute("aria-valuemin", "280");
    expect(separator).toHaveAttribute("aria-valuemax", "480");
    expect(separator).toHaveAttribute("aria-valuenow", "320");

    fireEvent.keyDown(separator, { key: "ArrowRight" });
    expect(onChange).toHaveBeenLastCalledWith(340);

    fireEvent.keyDown(separator, { key: "Home" });
    expect(onChange).toHaveBeenLastCalledWith(280);

    fireEvent.keyDown(separator, { key: "End" });
    expect(onChange).toHaveBeenLastCalledWith(480);
  });
});
