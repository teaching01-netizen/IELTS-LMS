import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AssessmentAccessLink } from "../../../contracts/accessLinks";
import { AccessLinkPresentView, AccessLinkShareSheet } from "../AccessLinkShareSheet";

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
  hasParticipation: false,
  revision: 3,
  createdAt: "2026-08-28T00:00:00Z",
  updatedAt: "2026-08-28T00:00:00Z",
};

// The share sheet is the surface a link actually leaves the building through:
// a verbal-only link handed to a math class is the mistake this copy prevents,
// so the scope has to survive the share (and the presentation) rendering.
describe("AccessLinkShareSheet", () => {
  it("states the section scope on the share sheet", () => {
    render(
      <AccessLinkShareSheet
        open
        link={{ ...link, enabledSections: ["reading-writing"] }}
        onClose={vi.fn()}
        onPresent={vi.fn()}
      />,
    );
    expect(screen.getByText(/Verbal only/)).toBeInTheDocument();
    expect(screen.getByText(/You'll take Reading & Writing only/)).toBeInTheDocument();
  });

  it("states the scope on the presentation view", () => {
    render(
      <AccessLinkPresentView
        open
        link={{ ...link, enabledSections: ["math"] }}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText(/You'll take Math only/)).toBeInTheDocument();
  });

  it("adds no scope copy to an unscoped link", () => {
    render(
      <AccessLinkShareSheet open link={link} onClose={vi.fn()} onPresent={vi.fn()} />,
    );
    expect(screen.queryByText(/only/)).not.toBeInTheDocument();
  });
});
