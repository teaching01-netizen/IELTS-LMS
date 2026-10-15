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
  publishScope: "full",
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
  it("renders name, version, exam phase and counts, and mentions check-in only when it is not open", () => {
    render(
      <AccessLinkRow
        link={link}
        phase={null}
        onOpen={vi.fn()}
        menuItems={[{ id: "edit", label: "Edit Link", onSelect: vi.fn() }]}
      />,
    );
    expect(screen.getByText("Saturday Class")).toBeInTheDocument();
    expect(screen.getByText("Version 5")).toBeInTheDocument();
    expect(screen.queryByText(/Check-in/)).not.toBeInTheDocument();
    expect(screen.getByText("10 registered · 4 submitted")).toBeInTheDocument();
  });

  it("shows the exam phase as a pill, and no pill rather than a guess when it is unknown", () => {
    const { rerender } = render(<AccessLinkRow link={link} phase="live" onOpen={vi.fn()} menuItems={[]} />);
    expect(screen.getByText("Running")).toBeInTheDocument();
    rerender(<AccessLinkRow link={{ ...link, status: "paused", lifecycleState: "paused" }} phase="unknown" onOpen={vi.fn()} menuItems={[]} />);
    expect(screen.queryByText("Running")).not.toBeInTheDocument();
    expect(screen.queryByText("Status unavailable")).not.toBeInTheDocument();
    expect(screen.getByText(/Check-in paused/)).toBeInTheDocument();
  });

  it("tags the last-opened room", () => {
    render(<AccessLinkRow link={link} phase={null} highlighted onOpen={vi.fn()} menuItems={[]} />);
    expect(screen.getByText("Last opened")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open Saturday Class (last opened)" })).toHaveClass("bg-au-accent-tint");
  });

  it("badges a narrowed link so it is not shared with the wrong class", () => {
    const { rerender } = render(
      <AccessLinkRow
        link={{ ...link, enabledSections: ["reading-writing"] }}
        phase={null}
        onOpen={vi.fn()}
        menuItems={[]}
      />,
    );
    expect(screen.getByText("Reading & Writing only")).toBeInTheDocument();

    rerender(
      <AccessLinkRow
        link={{ ...link, enabledSections: ["math"] }}
        phase={null}
        onOpen={vi.fn()}
        menuItems={[]}
      />,
    );
    expect(screen.getByText("Math only")).toBeInTheDocument();

    rerender(
      <AccessLinkRow
        link={{ ...link, enabledSections: null }}
        phase={null}
        onOpen={vi.fn()}
        menuItems={[]}
      />,
    );
    expect(screen.queryByText(/only/)).not.toBeInTheDocument();
  });

  it("opens the room from the row and exposes overflow actions without nesting buttons", () => {
    const onOpen = vi.fn();
    const { container } = render(
      <AccessLinkRow
        link={link}
        phase={null}
        onOpen={onOpen}
        menuItems={[{ id: "edit", label: "Edit Link", onSelect: vi.fn() }]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Open Saturday Class" }));
    expect(onOpen).toHaveBeenCalledOnce();
    expect(container.querySelector("button button")).toBeNull();
    expect(screen.getByRole("button", { name: "Actions for Saturday Class" })).toBeInTheDocument();
  });
});
