import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AssessmentValidationIssue } from "../../../contracts/assessment";
import { ReadinessControl } from "../ReadinessControl";

const blocking: AssessmentValidationIssue = {
  code: "sat.answer.key.required",
  path: "answer",
  message: "Select the correct answer.",
  blocking: true,
  field: "answer",
};

const advisory: AssessmentValidationIssue = {
  code: "sat.explain.hint",
  path: "rationale",
  message: "Consider explaining the distractor logic.",
  blocking: false,
  field: "rationale",
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function renderControl(issues: AssessmentValidationIssue[]) {
  const onIssueSelect = vi.fn();
  const view = render(<ReadinessControl issues={issues} onIssueSelect={onIssueSelect} />);
  return { view, onIssueSelect };
}

const trigger = () => screen.getByRole("button", { name: /issue|Review|Ready/i });
/** The status face itself: the tone classes live on it, not on the menu trigger. */
const statusFace = () => trigger().querySelector(".sat-spine__status") as HTMLElement;

describe("question readiness as quiet metadata", () => {
  it("states a blocker plainly and jumps to the field that owns it", () => {
    const { onIssueSelect } = renderControl([blocking]);
    expect(trigger()).toHaveTextContent("1 issue");
    expect(statusFace()).toHaveClass("sat-spine__status--danger");
    fireEvent.click(trigger());
    fireEvent.click(screen.getByRole("menuitem", { name: /Answer: Select the correct answer\./ }));
    expect(onIssueSelect).toHaveBeenCalledWith("answer");
  });

  it("keeps suggestions quieter than blockers but still visible", () => {
    renderControl([advisory]);
    expect(trigger()).toHaveTextContent("Review suggestions");
    expect(statusFace()).toHaveClass("sat-spine__status--warning");
  });

  it("rests in neutral when the question is ready, so status never competes with the document", () => {
    renderControl([]);
    expect(trigger()).toHaveTextContent("Question ready");
    expect(statusFace()).toHaveClass("sat-spine__status--neutral");
    expect(statusFace()).not.toHaveClass("sat-spine__status--success");
  });

  it("spends strong green only on the moment readiness changes, then settles", () => {
    const { view } = renderControl([blocking]);
    expect(statusFace()).not.toHaveClass("sat-spine__status--success");
    view.rerender(<ReadinessControl issues={[]} onIssueSelect={vi.fn()} />);
    expect(statusFace()).toHaveClass("sat-spine__status--success");
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(statusFace()).toHaveClass("sat-spine__status--neutral");
  });
});
