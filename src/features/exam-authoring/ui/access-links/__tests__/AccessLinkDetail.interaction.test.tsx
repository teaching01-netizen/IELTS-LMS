import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AssessmentAccessLink } from "../../../contracts/accessLinks";
import { AccessLinkDetail } from "../AccessLinkDetail";

/**
 * AT-10/14/15/16/17 — the detail pane's interaction contract.
 *
 * The pane is where staff land after pressing a row, so it must behave like a
 * real pane and not a swapped document: one gliding tab indicator, roving tab
 * focus, an opacity-only panel reveal, a scroll position that belongs to the
 * selected link, and an Escape that hands focus back instead of dropping it.
 */
const link: AssessmentAccessLink = {
  id: "link-current",
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

function detailProps(overrides: Partial<React.ComponentProps<typeof AccessLinkDetail>> = {}) {
  return {
    link,
    isStaleRelease: false,
    currentVersionNumber: 5,
    url: "https://example.test/join/link-current",
    activity: [{ kind: "joined" as const, studentName: "Jane", occurredAt: "2026-08-28T01:00:00Z" }],
    activityLoading: false,
    onCopy: vi.fn(),
    onShare: vi.fn(),
    onEdit: vi.fn(),
    onPresent: vi.fn(),
    onCreateForCurrent: vi.fn(),
    ...overrides,
  };
}

const scrollTopCalls: unknown[] = [];

beforeEach(() => {
  scrollTopCalls.length = 0;
  // jsdom throws scrollTop writes away; a spy setter makes the reset observable.
  Object.defineProperty(HTMLElement.prototype, "scrollTop", {
    configurable: true,
    get() { return 0; },
    set(value: unknown) { scrollTopCalls.push(value); },
  });
});

afterEach(() => {
  delete (HTMLElement.prototype as unknown as Record<string, unknown>)["scrollTop"];
});

describe("AccessLinkDetail interaction contract", () => {
  it("AT-01: every action in the pane presses through the shared vocabulary", () => {
    render(<AccessLinkDetail {...detailProps()} />);
    for (const name of ["Edit Saturday Class", "Share", "Copy", "Present"]) {
      expect(screen.getByRole("button", { name }).className).toContain("sat-press");
    }
    expect(screen.getByRole("link", { name: "Open student page" }).className).toContain("sat-press");
  });

  it("AT-14: one indicator marks the selected tab and the panel reveals without translating", () => {
    render(<AccessLinkDetail {...detailProps()} />);
    expect(screen.getByRole("tab", { name: "Overview" }).querySelector(".sat-tab-indicator")).not.toBeNull();
    expect(screen.getByRole("tab", { name: /Activity/ }).querySelector(".sat-tab-indicator")).toBeNull();

    fireEvent.click(screen.getByRole("tab", { name: /Activity/ }));
    expect(screen.getByRole("tab", { name: /Activity/ }).querySelector(".sat-tab-indicator")).not.toBeNull();
    expect(screen.getByRole("tab", { name: "Overview" }).querySelector(".sat-tab-indicator")).toBeNull();
    expect(document.querySelectorAll(".sat-panel-enter")).toHaveLength(1);
  });

  it("AT-15: the tablist keeps a single tab stop and moves focus with the selection", () => {
    render(<AccessLinkDetail {...detailProps()} />);
    const [overview, activityTab, settingsTab] = screen.getAllByRole("tab");
    expect(overview).toHaveAttribute("tabindex", "0");
    expect(activityTab).toHaveAttribute("tabindex", "-1");
    expect(settingsTab).toHaveAttribute("tabindex", "-1");

    fireEvent.keyDown(screen.getByRole("tablist"), { key: "ArrowRight" });
    const activity = screen.getByRole("tab", { name: /Activity/ });
    expect(activity).toHaveAttribute("aria-selected", "true");
    expect(activity).toHaveAttribute("tabindex", "0");
    expect(document.activeElement).toBe(activity);

    fireEvent.keyDown(screen.getByRole("tablist"), { key: "End" });
    expect(screen.getByRole("tab", { name: "Settings" })).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(screen.getByRole("tablist"), { key: "Home" });
    expect(screen.getByRole("tab", { name: "Overview" })).toHaveAttribute("aria-selected", "true");
  });

  it("AT-16: a different link starts its own scroll position", () => {
    const { rerender } = render(<AccessLinkDetail {...detailProps()} />);
    expect(scrollTopCalls).toContain(0);
    scrollTopCalls.length = 0;

    rerender(<AccessLinkDetail {...detailProps({ link: { ...link, id: "link-other", name: "Monday Class" } })} />);

    expect(scrollTopCalls).toContain(0);
    expect(screen.getByRole("tab", { name: "Overview" })).toHaveAttribute("aria-selected", "true");
  });

  it("AT-10: the copy confirmation swaps in place on both copy affordances", () => {
    const { rerender } = render(<AccessLinkDetail {...detailProps()} />);
    expect(screen.getByRole("button", { name: "Copy" })).toBeInTheDocument();

    rerender(<AccessLinkDetail {...detailProps({ copyConfirmed: true })} />);

    expect(screen.getByRole("button", { name: "Copied" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Copy" })).not.toBeInTheDocument();
    // The Settings row keeps its own copy control, named as before.
    fireEvent.click(screen.getByRole("tab", { name: "Settings" }));
    expect(screen.getByRole("button", { name: "Copy link ID" })).toHaveTextContent("Copied");
  });

  it("AT-17: Escape asks the dashboard to return focus to the row", () => {
    const onEscapeToRow = vi.fn();
    render(<AccessLinkDetail {...detailProps({ onEscapeToRow })} />);

    fireEvent.keyDown(screen.getByTestId("access-link-detail"), { key: "Escape" });

    expect(onEscapeToRow).toHaveBeenCalledOnce();
  });

  it("AT-17: no Escape handling when the pane has nowhere to send focus", () => {
    render(<AccessLinkDetail {...detailProps()} />);
    expect(() => fireEvent.keyDown(screen.getByTestId("access-link-detail"), { key: "Escape" })).not.toThrow();
  });
});
