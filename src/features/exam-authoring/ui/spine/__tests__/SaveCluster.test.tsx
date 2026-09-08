import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { QuestionSaveStatus } from "../../../hooks/useQuestionAutosave";
import { SAVE_CLUSTER_LABELS, SaveCluster } from "../SaveCluster";

const statuses: QuestionSaveStatus[] = ["saved", "unsaved", "saving", "offline", "error"];

describe("SaveCluster", () => {
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
});
