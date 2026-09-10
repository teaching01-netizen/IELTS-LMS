import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SatLineReader } from "./SatLineReader";

describe("SatLineReader Bluebook controls", () => {
  it("renders move hint, reset, and close controls", () => {
    render(<SatLineReader position={0.5} onPositionChange={() => undefined} onDisable={() => undefined} />);
    expect(screen.getByText(/Drag the handle/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reset line reader position" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /close/i })).toBeInTheDocument();
    expect(screen.getByRole("slider", { name: "Reading line position" })).toBeInTheDocument();
  });

  it("close destroys only the overlay (calls onDisable, nothing else)", async () => {
    const user = userEvent.setup();
    const onDisable = vi.fn();
    const onPositionChange = vi.fn();
    render(<SatLineReader position={0.5} onPositionChange={onPositionChange} onDisable={onDisable} />);
    await user.click(screen.getByRole("button", { name: /close/i }));
    expect(onDisable).toHaveBeenCalledTimes(1);
    expect(onPositionChange).not.toHaveBeenCalled();
  });

  it("uses the dark reader-mask token with a dark header and white window controls", () => {
    render(<SatLineReader position={0.5} onPositionChange={() => undefined} onDisable={() => undefined} />);
    const root = document.querySelector("[data-sat-line-reader]");
    expect(root).not.toBeNull();
    // Mask window tints via the 92pc reader-mask token; the light fallback is gone.
    expect(root!.innerHTML).toContain("var(--sat-reader-mask)");
    expect(root!.innerHTML).not.toContain("var(--sat-reader-dim");
    expect(root!.innerHTML).not.toContain("backdrop-blur");
    const header = root!.querySelector("[data-sat-line-reader-header]");
    expect(header).not.toBeNull();
    expect(header!.className).toContain("var(--sat-reader-mask)");
    expect(header!.className).not.toContain("backdrop-blur");
    const window_ = root!.querySelector("[data-sat-line-reader-window]");
    expect(window_).not.toBeNull();
    expect(window_!.className).toContain("bg-white");
    const nudgePad = root!.querySelector("[data-sat-line-reader-nudge]");
    expect(nudgePad).not.toBeNull();
    expect(nudgePad!.className).toContain("bg-white");
    expect(nudgePad!.className).not.toContain("backdrop-blur");
  });

  it("keeps slider aria (min/max/now/text) intact", () => {
    render(<SatLineReader position={0.5} onPositionChange={() => undefined} onDisable={() => undefined} />);
    const slider = screen.getByRole("slider", { name: "Reading line position" });
    expect(slider).toHaveAttribute("aria-valuemin", "5");
    expect(slider).toHaveAttribute("aria-valuemax", "95");
    expect(slider).toHaveAttribute("aria-valuenow", "50");
    expect(slider).toHaveAttribute("aria-valuetext", "50 percent down the reading viewport");
    expect(slider).toHaveAttribute("aria-orientation", "vertical");
  });

  it("reset returns to middle and nudges move one step", async () => {
    const user = userEvent.setup();
    const onPositionChange = vi.fn();
    render(<SatLineReader position={0.8} onPositionChange={onPositionChange} onDisable={() => undefined} />);
    await user.click(screen.getByRole("button", { name: "Reset line reader position" }));
    expect(onPositionChange).toHaveBeenLastCalledWith(0.5);
    await user.click(screen.getByRole("button", { name: "Move line reader up" }));
    expect(onPositionChange).toHaveBeenLastCalledWith(0.47);
  });
});
