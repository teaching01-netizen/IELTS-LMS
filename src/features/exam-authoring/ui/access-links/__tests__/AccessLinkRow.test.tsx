import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AssessmentAccessLink } from "../../../contracts/accessLinks";
import { AccessLinkRow } from "../AccessLinkRow";

const link: AssessmentAccessLink = {
  id: "link-1",
  examId: "exam-1",
  examTitle: "Digital SAT",
  providerKey: "sat",
  publishedVersionId: "version-5",
  versionNumber: 5,
  scheduleId: "schedule-1",
  name: "Saturday Class",
  enabledSections: null,
  audienceType: "cohort",
  audienceLabel: "Saturday",
  accessMode: "student_code",
  availabilityType: "anytime",
  opensAt: null,
  closesAt: null,
  lifecycleState: "active",
  status: "live",
  selectedStudentCount: 0,
  metrics: { registered: 10, started: 8, submitted: 4 },
  isCurrentRelease: true,
  hasParticipation: true,
  revision: 3,
  createdAt: "2026-08-28T00:00:00Z",
  updatedAt: "2026-08-28T00:00:00Z",
};

describe("AccessLinkRow", () => {
  it("renders a two-line summary with pill status and funnel counts", () => {
    render(
      <AccessLinkRow
        link={link}
        selected={false}
        isStaleRelease={false}
        onSelect={vi.fn()}
        menuItems={[{ id: "edit", label: "Edit Link", onSelect: vi.fn() }]}
      />,
    );
    expect(screen.getByText("Saturday Class")).toBeInTheDocument();
    expect(screen.getByText("Live")).toBeInTheDocument();
    expect(screen.getByText(/10 joined/)).toBeInTheDocument();
  });

  it("badges a narrowed link so it is not shared with the wrong class", () => {
    const { rerender } = render(
      <AccessLinkRow
        link={{ ...link, enabledSections: ["reading-writing"] }}
        selected={false}
        isStaleRelease={false}
        onSelect={vi.fn()}
        menuItems={[]}
      />,
    );
    expect(screen.getByText("Verbal only")).toBeInTheDocument();

    rerender(
      <AccessLinkRow
        link={{ ...link, enabledSections: ["math"] }}
        selected={false}
        isStaleRelease={false}
        onSelect={vi.fn()}
        menuItems={[]}
      />,
    );
    expect(screen.getByText("Math only")).toBeInTheDocument();

    rerender(
      <AccessLinkRow
        link={{ ...link, enabledSections: null }}
        selected={false}
        isStaleRelease={false}
        onSelect={vi.fn()}
        menuItems={[]}
      />,
    );
    expect(screen.queryByText(/only/)).not.toBeInTheDocument();
  });

  it("selects the row and exposes overflow actions without nesting buttons", () => {
    const onSelect = vi.fn();
    const { container } = render(
      <AccessLinkRow
        link={link}
        selected
        isStaleRelease
        onSelect={onSelect}
        menuItems={[{ id: "edit", label: "Edit Link", onSelect: vi.fn() }]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Open Saturday Class" }));
    expect(onSelect).toHaveBeenCalledOnce();
    expect(container.querySelector("button button")).toBeNull();
    expect(screen.getByText("Version 5")).toBeInTheDocument();
  });
});
