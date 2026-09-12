import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SatMoreMenu } from "./SatMoreMenu";

function props(overrides: Partial<Parameters<typeof SatMoreMenu>[0]> = {}) {
  return {
    open: true,
    blocked: false,
    lineReaderOn: false,
    lineReaderAvailable: true,
    breakAvailable: true,
    onSelectHelp: vi.fn(),
    onSelectShortcuts: vi.fn(),
    onToggleLineReader: vi.fn(),
    onSelectBreak: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
}

describe("SatMoreMenu", () => {
  it("renders all Bluebook rows and closes on select", async () => {
    const user = userEvent.setup();
    const onSelectHelp = vi.fn();
    const onClose = vi.fn();
    render(<SatMoreMenu {...props({ onSelectHelp, onClose })} />);
    expect(screen.getByRole("menu", { name: "More tools" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Help" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /Shortcuts/ })).toBeInTheDocument();
    expect(screen.getByRole("menuitemcheckbox", { name: /Line Reader/ })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /Unscheduled Break/ })).toBeInTheDocument();
    await user.click(screen.getByRole("menuitem", { name: "Help" }));
    expect(onSelectHelp).toHaveBeenCalledTimes(1);
  });

  it("checks Line Reader when on and disables rows while blocked", () => {
    render(<SatMoreMenu {...props({ lineReaderOn: true, blocked: true })} />);
    expect(screen.getByRole("menuitemcheckbox", { name: /Line Reader/ })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("menuitemcheckbox", { name: /Line Reader/ })).toBeDisabled();
    expect(screen.getByRole("menuitem", { name: /Unscheduled Break/ })).toBeDisabled();
    // Help stays reachable read-only while blocked.
    expect(screen.getByRole("menuitem", { name: "Help" })).not.toBeDisabled();
  });

  it("hides the break row when unavailable and closes on Escape", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<SatMoreMenu {...props({ breakAvailable: false, onClose })} />);
    expect(screen.queryByRole("menuitem", { name: /Unscheduled Break/ })).not.toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });

  it("renders nothing when closed", () => {
    render(<SatMoreMenu {...props({ open: false })} />);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });
});
