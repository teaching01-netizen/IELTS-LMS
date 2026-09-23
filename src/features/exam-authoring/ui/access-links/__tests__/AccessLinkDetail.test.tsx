import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AssessmentAccessLink } from "../../../contracts/accessLinks";
import { AccessLinkDetail } from "../AccessLinkDetail";

const link: AssessmentAccessLink = {
  id: "link-current",
  examId: "exam-1",
  examTitle: "Digital SAT",
  providerKey: "sat",
  publishedVersionId: "version-4",
  versionNumber: 4,
  publishScope: "full",
  scheduleId: "schedule-1",
  name: "Old Scholarship",
  audienceType: "cohort",
  audienceLabel: "Old Scholarship",
  accessMode: "student_code",
  availabilityType: "anytime",
  opensAt: null,
  closesAt: null,
  lifecycleState: "active",
  status: "live",
  selectedStudentCount: 0,
  metrics: { registered: 10, started: 8, submitted: 4 },
  isCurrentRelease: false,
  hasParticipation: true,
  revision: 3,
  createdAt: "2026-08-28T00:00:00Z",
  updatedAt: "2026-08-28T00:00:00Z",
};

function renderDetail() {
  return render(
    <AccessLinkDetail
      link={link}
      isStaleRelease
      currentVersionNumber={5}
      url="https://example.test/join/link-current"
      activity={[{ kind: "joined", studentName: "Jane", occurredAt: "2026-08-28T01:00:00Z" }]}
      activityLoading={false}
      onCopy={vi.fn()}
      onShare={vi.fn()}
      onEdit={vi.fn()}
      onPresent={vi.fn()}
      onCreateForCurrent={vi.fn()}
    />,
  );
}

describe("AccessLinkDetail", () => {
  it("keeps the immutable-version banner and replacement action on Overview", () => {
    renderDetail();
    expect(screen.getByText("Uses Version 4")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create Version 5 Link" })).toBeInTheDocument();
  });

  it("switches to the Activity tab with arrow keys", () => {
    renderDetail();
    fireEvent.click(screen.getByRole("tab", { name: /Activity/ }));
    expect(screen.getByText("Jane")).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("tablist"), { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "Settings" })).toHaveAttribute("aria-selected", "true");
  });

  it("wraps long URLs instead of truncating them", () => {
    renderDetail();
    const url = screen.getByText("https://example.test/join/link-current");
    expect(url.className).toMatch(/break-all/);
  });
});
