import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useSatShortcuts } from "./useSatShortcuts";
import type { SatToolActionBinding } from "../domain/satToolActions";

function binding(): SatToolActionBinding & Record<string, ReturnType<typeof vi.fn>> {
  const fn = () => vi.fn();
  return {
    calculator: fn(), reference: fn(), lineReader: fn(), highlights: fn(),
    eliminatorMode: fn(), markForReview: fn(), questionMenu: fn(), directions: fn(),
    notes: fn(), timerVisibility: fn(), help: fn(), shortcuts: fn(),
    breakConfirm: fn(), nextQuestion: fn(), previousQuestion: fn(),
    zoomIn: fn(), zoomOut: fn(), zoomReset: fn(),
  };
}

function Harness({ b, enabled = true }: { b: SatToolActionBinding; enabled?: boolean }) {
  useSatShortcuts(enabled, b);
  return (
    <div>
      <button type="button">outside</button>
      <input aria-label="answer" />
    </div>
  );
}

describe("useSatShortcuts", () => {
  it("fires the same action as clicking (Ctrl+Alt+C toggles calculator)", async () => {
    const user = userEvent.setup();
    const b = binding();
    render(<Harness b={b} />);
    await user.click(document.body);
    await user.keyboard("{Control>}{Alt>}c{/Alt}{/Control}");
    expect(b.calculator).toHaveBeenCalledTimes(1);
  });

  it("ignores shortcuts while typing in inputs", async () => {
    const user = userEvent.setup();
    const b = binding();
    const { container } = render(<Harness b={b} />);
    const input = container.querySelector("input")!;
    input.focus();
    await user.keyboard("{Control>}{Alt>}c{/Alt}{/Control}");
    expect(b.calculator).not.toHaveBeenCalled();
  });

  it("does nothing when disabled", async () => {
    const user = userEvent.setup();
    const b = binding();
    render(<Harness b={b} enabled={false} />);
    await user.keyboard("{Control>}{Alt>}c{/Alt}{/Control}");
    expect(b.calculator).not.toHaveBeenCalled();
  });
});
