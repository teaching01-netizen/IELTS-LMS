import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SAT_COPY } from "../../domain/satCopy";
import { SatSaveStatus } from "./SatSaveStatus";

describe("SatSaveStatus (failure-only surface)", () => {
  it("stays silent through every healthy state", () => {
    for (const state of ["idle", "saving", "offline", "retrying"] as const) {
      const { container, unmount } = render(<SatSaveStatus state={state} onRetrySave={vi.fn()} />);
      expect(container, state).toBeEmptyDOMElement();
      unmount();
    }
  });

  it("reserves assertive alert for failed-with-action and prefers server detail", () => {
    const onRetrySave = vi.fn();
    render(<SatSaveStatus state="failed" saveFailure="Gateway timeout" onRetrySave={onRetrySave} />);
    const alert = screen.getByTestId("sat-save-status");
    expect(alert).toHaveAttribute("role", "alert");
    expect(alert).toHaveTextContent("Gateway timeout");
    screen.getByRole("button", { name: SAT_COPY.saveStatus.retry }).click();
    expect(onRetrySave).toHaveBeenCalledOnce();
  });

  it("falls back to the canonical failure sentence with no server detail", () => {
    render(<SatSaveStatus state="failed" />);
    expect(screen.getByTestId("sat-save-status")).toHaveTextContent(SAT_COPY.saveStatus.failed);
  });

  it("merges the lease conflict into the superseded banner with take-over inline", () => {
    const onTakeOver = vi.fn();
    render(<SatSaveStatus state="superseded" onTakeOver={onTakeOver} />);
    const alert = screen.getByTestId("sat-save-status");
    expect(alert).toHaveAttribute("role", "alert");
    expect(alert).toHaveTextContent(SAT_COPY.saveStatus.superseded);
    // Superseded never offers a meaningless Retry — only Take over.
    expect(screen.queryByRole("button", { name: SAT_COPY.saveStatus.retry })).not.toBeInTheDocument();
    screen.getByRole("button", { name: SAT_COPY.saveStatus.takeOver }).click();
    expect(onTakeOver).toHaveBeenCalledOnce();
  });
});
