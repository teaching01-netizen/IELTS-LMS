import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AssessmentValidationIssue } from "../../../contracts/assessment";
import { ValidationChecklist } from "../ValidationChecklist";

function issue(overrides: Partial<AssessmentValidationIssue> & { code: string; path: string }): AssessmentValidationIssue {
  return { message: overrides.code, blocking: true, ...overrides };
}

describe("CoachingLayer — one coaching pattern", () => {
  it("speaks as release guidance with the blocking count", () => {
    render(
      <ValidationChecklist
        issues={[issue({ code: "b.1", path: "metadata.domain", message: "Choose the SAT domain", blocking: true })]}
        onIssueSelect={vi.fn()}
      />,
    );
    expect(screen.getByRole("heading", { name: /what's needed to release/i })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(/1 blocking/i);
  });

  it("celebrates readiness in release language", () => {
    render(<ValidationChecklist issues={[]} onIssueSelect={vi.fn()} />);
    expect(screen.getByRole("heading", { name: /what's needed to release/i })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(/ready to release/i);
  });

  it("every blocking item still jumps to its field", () => {
    const onIssueSelect = vi.fn();
    render(
      <ValidationChecklist
        issues={[issue({ code: "b.1", path: "metadata.domain", message: "Choose the SAT domain", blocking: true })]}
        onIssueSelect={onIssueSelect}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /choose the sat domain/i }));
    expect(onIssueSelect).toHaveBeenCalledWith(
      expect.objectContaining({ path: "metadata.domain" }),
    );
  });
});
