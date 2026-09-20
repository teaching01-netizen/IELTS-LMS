import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AssessmentAccessLink } from "../../../contracts/accessLinks";
import { AccessLinkRow } from "../AccessLinkRow";

/**
 * AT-01/05/07/11 — the row is the surface staff press dozens of times a day.
 * These assertions pin the interaction contract that jsdom CAN see:
 *   - the shared row vocabulary (so hover/press/reduced-motion come from CSS),
 *   - a per-link pending look that never moves the row,
 *   - an inline confirmation that replaces the funnel line in place,
 *   - the overflow menu still being a sibling (never a nested button).
 * The pressed transform itself is proved in the browser suite (satPressCss +
 * e2e/sat-access-links-interaction).
 */
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

function renderRow(props: Partial<React.ComponentProps<typeof AccessLinkRow>> = {}) {
  return render(
    <AccessLinkRow
      link={link}
      selected={false}
      isStaleRelease={false}
      onSelect={vi.fn()}
      menuItems={[{ id: "edit", label: "Edit Link", onSelect: vi.fn() }]}
      {...props}
    />,
  );
}

describe("AccessLinkRow interaction contract", () => {
  it("AT-01/05: the row uses the shared row vocabulary and a stable element id", () => {
    renderRow({ selected: true });
    const row = screen.getByRole("button", { name: "Open Saturday Class" });
    expect(row).toHaveClass("sat-list-row", "sat-press-row");
    expect(row).toHaveAttribute("id", "access-link-row-link-1");
    expect(row).toHaveAttribute("aria-current", "true");
    // Geometry contract: the pressed state may not change the row's box.
    expect(row.className).toContain("min-h-[76px]");
    expect(row.className).toContain("pr-14");
  });

  it("AT-07: a pending write is announced on the row, keeps its geometry, and hides the menu", () => {
    renderRow({ busy: true, pendingLabel: "Pausing…" });
    const row = screen.getByRole("button", { name: "Open Saturday Class" });
    expect(row).toHaveAttribute("aria-busy", "true");
    expect(screen.getByText("Pausing…")).toBeInTheDocument();
    expect(screen.getByTestId("access-link-pending-link-1")).toBeInTheDocument();
    // The pressed control replaces the overflow trigger rather than adding one:
    // no second control, no width change, no nested buttons.
    expect(screen.queryByLabelText("Actions for Saturday Class")).not.toBeInTheDocument();
    expect(row.className).toContain("min-h-[76px]");
    expect(document.querySelector("button button")).toBeNull();
  });

  it("AT-08: a settled row returns to its resting presentation", () => {
    const { rerender } = renderRow({ busy: true, pendingLabel: "Pausing…" });
    rerender(
      <AccessLinkRow
        link={{ ...link, status: "paused", lifecycleState: "paused", revision: 4 }}
        selected={false}
        isStaleRelease={false}
        onSelect={vi.fn()}
        menuItems={[{ id: "edit", label: "Edit Link", onSelect: vi.fn() }]}
      />,
    );
    const row = screen.getByRole("button", { name: "Open Saturday Class" });
    expect(row).not.toHaveAttribute("aria-busy");
    expect(screen.queryByText("Pausing…")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Actions for Saturday Class")).toBeInTheDocument();
    expect(screen.getByText("10 joined · 8 started · 4 submitted")).toBeInTheDocument();
  });

  it("AT-11: the confirmation replaces the funnel line instead of pushing new rows", () => {
    renderRow({ confirmation: "Link copied" });
    expect(screen.getByText("Link copied")).toBeInTheDocument();
    expect(screen.queryByText(/joined/)).not.toBeInTheDocument();
    const row = screen.getByRole("button", { name: "Open Saturday Class" });
    // One line either way: the meta slots are fixed, so nothing below moves.
    expect(row.querySelectorAll("span.mt-1").length).toBe(2);
  });

  it("keeps the row selectable while idle", () => {
    const onSelect = vi.fn();
    renderRow({ onSelect });
    const row = screen.getByRole("button", { name: "Open Saturday Class" });
    expect(row).not.toHaveAttribute("aria-busy");
    fireEvent.click(row);
    expect(onSelect).toHaveBeenCalledOnce();
    expect(screen.getByText("10 joined · 8 started · 4 submitted")).toBeInTheDocument();
  });
});
