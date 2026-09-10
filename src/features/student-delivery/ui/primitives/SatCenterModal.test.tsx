import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SatCenterModal } from "./SatCenterModal";

describe("SatCenterModal", () => {
  it("renders a named dialog and closes via the close button", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <SatCenterModal open title="Help" closeLabel="Close help" onClose={onClose}>
        body
      </SatCenterModal>,
    );
    expect(await screen.findByRole("dialog", { name: "Help" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Close help" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on Escape (Radix handles Escape; shell onClose owns state)", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <SatCenterModal open title="Help" closeLabel="Close help" onClose={onClose}>
        body
      </SatCenterModal>,
    );
    expect(await screen.findByRole("dialog", { name: "Help" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });

  it("uses the 72pc scrim token with no legacy dim utility or blur", async () => {
    render(
      <SatCenterModal open title="Help" closeLabel="Close help" onClose={() => undefined}>
        body
      </SatCenterModal>,
    );
    await screen.findByRole("dialog", { name: "Help" });
    const overlay = document.querySelector(".sat-dialog-backdrop");
    expect(overlay).not.toBeNull();
    expect(overlay!.className).toContain("var(--sat-scrim)");
    expect(overlay!.className).not.toContain("bg-black/40");
    expect(overlay!.className).not.toContain("backdrop-blur");
    expect(document.body.innerHTML).not.toContain("backdrop-blur");
  });

  it("caps the panel 650 wide / 560 default with 740 max-height, radius 10, modal shadow", async () => {
    const { rerender } = render(
      <SatCenterModal open title="Help" closeLabel="Close help" wide onClose={() => undefined}>
        body
      </SatCenterModal>,
    );
    let panel = await screen.findByRole("dialog", { name: "Help" });
    expect(panel.className).toContain("min(650px");
    expect(panel.className).toContain("min(740px");
    expect(panel.className).toContain("rounded-[10px]");
    expect(panel.className).toContain("var(--sat-shadow-modal)");
    expect(panel.className).not.toContain("shadow-2xl");
    expect(panel.className).not.toContain("rounded-[12px]");
    rerender(
      <SatCenterModal open title="Confirm" closeLabel="Close confirm" onClose={() => undefined}>
        body
      </SatCenterModal>,
    );
    panel = await screen.findByRole("dialog", { name: "Confirm" });
    expect(panel.className).toContain("min(560px");
  });

  it("keeps dialog titles at 17px by default and renders 28px help titles", async () => {
    const { rerender } = render(
      <SatCenterModal open title="Confirm" closeLabel="Close" onClose={() => undefined}>
        body
      </SatCenterModal>,
    );
    expect(await screen.findByText("Confirm")).toHaveClass("text-[17px]");
    rerender(
      <SatCenterModal open title="Help" closeLabel="Close help" titleSize="help" onClose={() => undefined}>
        body
      </SatCenterModal>,
    );
    expect(await screen.findByText("Help")).toHaveClass("text-[28px]");
  });

  it("renders the wide variant and optional description", async () => {
    render(
      <SatCenterModal open title="Help" closeLabel="Close help" wide description="Exam help" onClose={() => undefined}>
        body
      </SatCenterModal>,
    );
    expect(await screen.findByRole("dialog", { name: "Help" })).toBeInTheDocument();
    expect(screen.getByText("Exam help")).toBeInTheDocument();
  });
});
