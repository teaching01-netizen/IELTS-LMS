import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { SatImageViewer } from "./SatImageViewer";

function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <SatImageViewer.EnlargeButton label="Figure 1: supply curve" onOpen={() => setOpen(true)} />
      <SatImageViewer src="https://example.com/fig1.png" alt="Figure 1: supply curve" open={open} onClose={() => setOpen(false)} />
    </>
  );
}

describe("SatImageViewer", () => {
  it("opens from enlarge, zooms, resets, and closes with focus back", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: /Enlarge image/ }));
    expect(screen.getByRole("dialog", { name: "Image viewer" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Figure 1: supply curve" })).toHaveAttribute("src", "https://example.com/fig1.png");
    const zoomIn = screen.getByRole("button", { name: "Zoom in" });
    await user.click(zoomIn);
    await user.click(zoomIn);
    expect(screen.getByText("200%")).toBeInTheDocument();
    screen.getByRole("toolbar", { name: "Image viewer controls" }).focus();
    await user.keyboard("{+}");
    expect(screen.getByText("250%")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Reset zoom" }));
    expect(screen.getByText("100%")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Image viewer" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Enlarge image/ })).toHaveFocus();
  });

  it("renders nothing when closed", () => {
    render(<SatImageViewer src="x" alt="y" open={false} onClose={() => undefined} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("enlarge button disables while blocked", () => {
    const onOpen = vi.fn();
    render(<SatImageViewer.EnlargeButton label="Fig" disabled onOpen={onOpen} />);
    expect(screen.getByRole("button", { name: /Enlarge image/ })).toBeDisabled();
  });
});
