import { describe, expect, it } from "vitest";
import type { AssessmentAccessLink } from "../../../contracts/accessLinks";
import {
  accessLinkStatusDescription,
  accessLinkStatusTone,
  formatAccessLinkStatus,
  parseAccessLinkMembers,
  shouldPulseAccessLinkStatus,
  studentJoinUrl,
} from "../accessLinkUi";

function linkWith(overrides: Partial<AssessmentAccessLink>): AssessmentAccessLink {
  return {
    id: "link-1",
    examId: "exam-1",
    examTitle: "Digital SAT",
    providerKey: "sat",
    publishedVersionId: "version-5",
    versionNumber: 5,
    scheduleId: "schedule-1",
    name: "Saturday Class",
    audienceType: "cohort",
    audienceLabel: "Saturday",
    accessMode: "student_code",
    availabilityType: "anytime",
    opensAt: null,
    closesAt: null,
    lifecycleState: "active",
    status: "live",
    selectedStudentCount: 0,
    metrics: { registered: 0, started: 0, submitted: 0 },
    isCurrentRelease: true,
    hasParticipation: false,
    revision: 1,
    createdAt: "2026-08-28T00:00:00Z",
    updatedAt: "2026-08-28T00:00:00Z",
    ...overrides,
  };
}

describe("accessLinkStatusTone", () => {
  it("maps every status to a Calm Ops Bento pill tone", () => {
    expect(accessLinkStatusTone("live")).toBe("live");
    expect(accessLinkStatusTone("upcoming")).toBe("ready");
    expect(accessLinkStatusTone("paused")).toBe("paused");
    expect(accessLinkStatusTone("ended")).toBe("finished");
    expect(accessLinkStatusTone("revoked")).toBe("invalidated");
  });

  it("pulses only the live status", () => {
    expect(shouldPulseAccessLinkStatus("live")).toBe(true);
    for (const status of ["upcoming", "ended", "paused", "revoked"] as const) {
      expect(shouldPulseAccessLinkStatus(status)).toBe(false);
    }
  });

  it("keeps tone and label in sync for assistive technology", () => {
    for (const status of ["live", "upcoming", "ended", "paused", "revoked"] as const) {
      expect(formatAccessLinkStatus(status)).toBeTruthy();
      expect(accessLinkStatusTone(status)).toBeTruthy();
    }
  });
});

describe("studentJoinUrl", () => {
  it("encodes the link id", () => {
    expect(studentJoinUrl("a/b?c")).toContain(encodeURIComponent("a/b?c"));
  });
});

describe("accessLinkStatusDescription", () => {
  it("describes paused and revoked links", () => {
    expect(accessLinkStatusDescription(linkWith({ status: "paused" }))).toMatch(/temporarily disabled/);
    expect(accessLinkStatusDescription(linkWith({ status: "revoked" }))).toMatch(/no longer/);
  });
});

describe("parseAccessLinkMembers", () => {
  it("parses code, name, and email rows", () => {
    expect(parseAccessLinkMembers("W1, Jane Doe, jane@example.com")).toEqual([
      { studentCode: "W1", studentName: "Jane Doe", studentEmail: "jane@example.com" },
    ]);
  });

  it("rejects duplicate codes, bad email, and extra columns with row numbers", () => {
    expect(() => parseAccessLinkMembers("W1\nW1")).toThrow(/more than once/);
    expect(() => parseAccessLinkMembers("W1, Jane, not-an-email")).toThrow(/invalid email/);
    expect(() => parseAccessLinkMembers("a,b,c,d")).toThrow(/more than three columns/);
    expect(parseAccessLinkMembers("\n\n")).toEqual([]);
    expect(() => parseAccessLinkMembers(", Jane")).toThrow(/needs a student code/);
  });
});
