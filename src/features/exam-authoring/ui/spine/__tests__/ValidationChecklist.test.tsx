import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AssessmentValidationIssue } from "../../../contracts/assessment";
import { ValidationChecklist } from "../ValidationChecklist";

function issue(overrides: Partial<AssessmentValidationIssue> & { code: string; path: string }): AssessmentValidationIssue {
  return { message: overrides.code, blocking: true, ...overrides };
}

describe("ValidationChecklist", () => {
  it("orders blocking issues first with a role=status summary", () => {
    render(
      <ValidationChecklist
        issues={[
          issue({ code: "w.1", path: "prompt", message: "Style warning", blocking: false }),
          issue({ code: "b.1", path: "metadata.domain", message: "Choose the SAT domain", blocking: true }),
        ]}
        onIssueSelect={vi.fn()}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent(/blocking issue/);
    const items = screen.getAllByRole("button");
    expect(items[0]).toHaveTextContent("Choose the SAT domain");
    expect(items[1]).toHaveTextContent("Style warning");
  });

  it("announces Ready when there are no issues", () => {
    render(<ValidationChecklist issues={[]} onIssueSelect={vi.fn()} />);
    expect(screen.getByRole("status")).toHaveTextContent(/ready to release/i);
    expect(screen.getByText("No blocking issues")).toBeInTheDocument();
  });

  it("forwards the clicked issue for field scroll-focus", () => {
    const onIssueSelect = vi.fn();
    const blocking = issue({ code: "b.1", path: "metadata.domain", message: "Choose the SAT domain", blocking: true });
    render(<ValidationChecklist issues={[blocking]} onIssueSelect={onIssueSelect} />);
    fireEvent.click(screen.getByRole("button", { name: /choose the sat domain/i }));
    expect(onIssueSelect).toHaveBeenCalledTimes(1);
    expect(onIssueSelect).toHaveBeenCalledWith(blocking);
  });
});
