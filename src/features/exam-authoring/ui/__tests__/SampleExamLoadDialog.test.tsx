import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SampleExamLoadDialog } from "../SampleExamLoadDialog";

describe("SampleExamLoadDialog", () => {
  it("explains the complete replacement and invokes confirmation", () => {
    const onConfirm = vi.fn();
    render(
      <SampleExamLoadDialog
        open
        busy={false}
        existingQuestionCount={12}
        onCancel={vi.fn()}
        onConfirm={onConfirm}
      />
    );
    expect(screen.getByRole("dialog", { name: "Load sample SAT" })).toBeInTheDocument();
    expect(screen.getByText(/147 original SAT-style questions/i)).toBeInTheDocument();
    expect(screen.getByText(/12 current draft questions will be replaced/i)).toBeInTheDocument();
    expect(screen.getByText(/Published versions are untouched/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Load 147 questions" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("locks controls while the transactional load is in progress", () => {
    render(
      <SampleExamLoadDialog
        open
        busy
        existingQuestionCount={0}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />
    );
    expect(screen.getByRole("button", { name: "Loading sample…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
  });
});
