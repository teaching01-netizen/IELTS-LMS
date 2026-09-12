import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SAT_COPY } from "../../domain/satCopy";
import { SatSaveStatus } from "./SatSaveStatus";

describe("SatSaveStatus", () => {
  it("renders nothing when idle", () => {
    const { container } = render(<SatSaveStatus state="idle" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("announces saving through a single polite status region", () => {
    render(<SatSaveStatus state="saving" />);
    const status = screen.getByTestId("sat-save-status");
    expect(status).toHaveAttribute("role", "status");
    expect(status).toHaveTextContent(SAT_COPY.saveStatus.saving);
  });

  it("uses one canonical offline wording with no action", () => {
    render(<SatSaveStatus state="offline" onRetrySave={vi.fn()} />);
    const status = screen.getByTestId("sat-save-status");
    expect(status).toHaveAttribute("role", "status");
    // Canonical copy only — the legacy duplicate wording must not appear.
    expect(status).toHaveTextContent(SAT_COPY.saveStatus.offline);
    expect(status).not.toHaveTextContent("Response kept on this device");
    expect(status).not.toHaveTextContent("changes are kept");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("offers retry-now while retrying", () => {
    const onRetrySave = vi.fn();
    render(<SatSaveStatus state="retrying" onRetrySave={onRetrySave} />);
    expect(screen.getByTestId("sat-save-status")).toHaveTextContent(SAT_COPY.saveStatus.retrying);
    screen.getByRole("button", { name: SAT_COPY.saveStatus.retryNow }).click();
    expect(onRetrySave).toHaveBeenCalledOnce();
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
