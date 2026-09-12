import { StrictMode } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { QuestionSaveStatus } from "../../../hooks/useQuestionAutosave";
import { SAVE_CLUSTER_LABELS, SaveCluster } from "../SaveCluster";

const statuses: QuestionSaveStatus[] = ["saved", "unsaved", "saving", "offline", "error", "conflict"];

describe("SaveCluster", () => {
  it("hides only transient success and immediately reveals exceptional states", () => {
    vi.useFakeTimers();
    try {
      const { container, rerender } = render(<SaveCluster status="saved" lastSavedAt={null} transientSaved announce={false} />);
      act(() => { vi.advanceTimersByTime(1500); });
      expect(container.querySelector('[data-save-hidden="true"]')).toBeInTheDocument();
      for (const status of ["offline", "error", "conflict"] as const) {
        rerender(<SaveCluster status={status} lastSavedAt={null} transientSaved />);
        expect(container.querySelector('[data-save-hidden="true"]')).not.toBeInTheDocument();
        expect(screen.getByRole("status")).toHaveTextContent(SAVE_CLUSTER_LABELS[status]);
      }
    } finally { vi.useRealTimers(); }
  });
  it.each(statuses)("announces a single vocabulary label for status %s", (status) => {
    render(<SaveCluster status={status} lastSavedAt={null} />);
    expect(screen.getByRole("status")).toHaveTextContent(SAVE_CLUSTER_LABELS[status]);
  });

  it("retries a failed save with one click", () => {
    const onRetry = vi.fn();
    render(<SaveCluster status="error" lastSavedAt={null} onRetry={onRetry} />);
    fireEvent.click(screen.getByRole("button", { name: /not saved.*retry/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("renders non-errors as read-only status text", () => {
    render(<SaveCluster status="saved" lastSavedAt={null} onRetry={vi.fn()} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Saved");
  });

  it("fires the saved tick exactly once on entering saved, including StrictMode", () => {
    const { container, rerender } = render(
      <StrictMode><SaveCluster status="unsaved" lastSavedAt={null} /></StrictMode>,
    );
    rerender(<StrictMode><SaveCluster status="saved" lastSavedAt={new Date()} /></StrictMode>);
    expect(screen.getByRole("status")).toHaveTextContent("Saved");
    expect(container.textContent).toContain("Saved");
  });

  it("opens conflict resolution with one click when a handler is provided", () => {
    const onReviewConflict = vi.fn();
    render(<SaveCluster status="conflict" lastSavedAt={null} onReviewConflict={onReviewConflict} />);
    fireEvent.click(screen.getByRole("button", { name: /review changes/i }));
    expect(onReviewConflict).toHaveBeenCalledTimes(1);
  });

  it("stays read-only status text for conflict without a handler", () => {
    render(<SaveCluster status="conflict" lastSavedAt={null} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Changed elsewhere");
  });
});
