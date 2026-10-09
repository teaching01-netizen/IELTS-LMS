import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ExamWorkspaceHeader, type ExamWorkspaceHeaderProps } from "../ExamWorkspaceHeader";

function props(overrides: Partial<ExamWorkspaceHeaderProps> = {}): ExamWorkspaceHeaderProps {
  return {
    examTitle: "Practice Test 06",
    lifecycle: { label: "Published · Version 2", detail: null, tone: "published" },
    activeTab: "questions",
    showResponses: true,
    onSelectTab: vi.fn(),
    onBack: vi.fn(),
    ...overrides,
  };
}

describe("ExamWorkspaceHeader", () => {
  it("shows the title, the lifecycle, and marks only the current tab", () => {
    render(<ExamWorkspaceHeader {...props({ activeTab: "settings" })} />);
    expect(screen.getByRole("heading", { name: "Practice Test 06" })).toBeInTheDocument();
    expect(screen.getByTestId("exam-lifecycle")).toHaveTextContent("Published · Version 2");
    const tabs = within(screen.getByRole("navigation", { name: "Exam sections" }));
    expect(tabs.getByRole("button", { name: "Settings" })).toHaveAttribute("aria-current", "page");
    expect(tabs.getByRole("button", { name: "Questions" })).not.toHaveAttribute("aria-current");
  });

  it("reports the chosen tab and leaves navigation to the host", () => {
    const onSelectTab = vi.fn();
    render(<ExamWorkspaceHeader {...props({ onSelectTab })} />);
    fireEvent.click(screen.getByRole("button", { name: "Results" }));
    expect(onSelectTab).toHaveBeenCalledWith("responses");
  });

  it("omits Results for roles that cannot read results", () => {
    render(<ExamWorkspaceHeader {...props({ showResponses: false })} />);
    expect(screen.queryByRole("button", { name: "Results" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Questions" })).toBeInTheDocument();
  });

  it("marks no tab current on pages that are not tabs", () => {
    render(<ExamWorkspaceHeader {...props({ activeTab: null })} />);
    const tabs = within(screen.getByRole("navigation", { name: "Exam sections" }));
    expect(tabs.queryByRole("button", { current: "page" })).not.toBeInTheDocument();
  });

  it("only renders actions the host provides", () => {
    render(<ExamWorkspaceHeader {...props()} />);
    expect(screen.queryByRole("button", { name: /^publish version$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /preview/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /student access/i })).not.toBeInTheDocument();
  });

  it("gives Publish a stated reason instead of a silent disabled button", () => {
    const onPublish = vi.fn();
    render(<ExamWorkspaceHeader {...props({ onPublish, publishDisabledReason: "Save your timing changes first" })} />);
    const publish = screen.getByRole("button", { name: /^publish version$/i });
    expect(publish).toBeDisabled();
    expect(publish).toHaveAttribute("title", "Save your timing changes first");
    fireEvent.click(publish);
    expect(onPublish).not.toHaveBeenCalled();
  });

  it("shows an issue indicator only when there are issues, with a count in its name", () => {
    const onOpenIssues = vi.fn();
    const { rerender } = render(<ExamWorkspaceHeader {...props({ issueCount: 0, onOpenIssues })} />);
    expect(screen.queryByRole("button", { name: /issue/i })).not.toBeInTheDocument();
    rerender(<ExamWorkspaceHeader {...props({ issueCount: 3, onOpenIssues })} />);
    fireEvent.click(screen.getByRole("button", { name: "Review 3 issues" }));
    expect(onOpenIssues).toHaveBeenCalledOnce();
    rerender(<ExamWorkspaceHeader {...props({ issueCount: 1, onOpenIssues })} />);
    expect(screen.getByRole("button", { name: "Review 1 issue" })).toBeInTheDocument();
  });

  it("offers one Import menu holding every import path", () => {
    const first = vi.fn();
    const second = vi.fn();
    render(
      <ExamWorkspaceHeader
        {...props({
          importItems: [
            { id: "a", label: "Add questions to this module…", onSelect: first },
            { id: "b", label: "Replace exam from workbook…", onSelect: second },
          ],
        })}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Import questions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Replace exam from workbook/ }));
    expect(second).toHaveBeenCalledOnce();
    expect(first).not.toHaveBeenCalled();
  });
});
