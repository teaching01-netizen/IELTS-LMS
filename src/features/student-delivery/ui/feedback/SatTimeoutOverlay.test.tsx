import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SAT_COPY } from "../../domain/satCopy";
import { SatTimeoutOverlay } from "./SatControlFeedback";

describe("SatTimeoutOverlay", () => {
  it("shows only the recording note while the close is in progress", () => {
    render(<SatTimeoutOverlay saveFailureKind={null} saveFailure={null} onRetrySave={vi.fn()} onRetryClose={vi.fn()} />);
    expect(screen.getByRole("status")).toHaveTextContent(SAT_COPY.timeout.recordingAnswers);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("offers a close retry and points to the proctor once stalled", () => {
    const onRetryClose = vi.fn();
    render(
      <SatTimeoutOverlay saveFailureKind={null} saveFailure={null} onRetrySave={vi.fn()} closeStalled onRetryClose={onRetryClose} />,
    );
    expect(screen.getByRole("status")).toHaveTextContent(SAT_COPY.timeout.stalled);
    screen.getByRole("button", { name: SAT_COPY.timeout.retryClose }).click();
    expect(onRetryClose).toHaveBeenCalledOnce();
  });

  it("keeps the save retry ahead of the close retry", () => {
    render(
      <SatTimeoutOverlay saveFailureKind="offline" saveFailure={null} onRetrySave={vi.fn()} closeStalled onRetryClose={vi.fn()} />,
    );
    expect(screen.getByRole("status")).toHaveTextContent(SAT_COPY.timeout.offline);
    expect(screen.queryByRole("button", { name: SAT_COPY.timeout.retryClose })).toBeNull();
    expect(screen.getByRole("button", { name: SAT_COPY.review.retrySave })).toBeInTheDocument();
  });
});
