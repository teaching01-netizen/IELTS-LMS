import { describe, expect, it } from "vitest";
import type { AssessmentReleaseState } from "../../../contracts/release";
import { canViewExamResponses, describeExamLifecycle, deliveryDestination, examWorkspacePath } from "../examLifecycle";

const access = (totalLinks: number): AssessmentReleaseState["access"] => ({
  totalLinks,
  liveLinks: totalLinks,
  upcomingLinks: 0,
  linksOnCurrentRelease: totalLinks,
  liveLinksOnPreviousReleases: 0,
});
const published = (versionNumber: number): AssessmentReleaseState["currentPublishedVersion"] => ({
  id: `v${versionNumber}`,
  versionNumber,
  revision: 1,
  publishNotes: null,
  publishScope: "full",
  publishedAt: "2026-09-01T00:00:00.000Z",
});

describe("describeExamLifecycle", () => {
  it("calls an unloaded or never-published exam Editing, never a publish state", () => {
    expect(describeExamLifecycle(null).label).toBe("Editing");
    const draft = describeExamLifecycle({ state: "never_published", currentPublishedVersion: null, access: access(0) });
    expect(draft.label).toBe("Editing");
    expect(draft.detail).toBe("Changes are saved automatically. A room uses the latest saved exam.");
  });

  it("keeps earlier rooms on their version while the exam is edited", () => {
    const copy = describeExamLifecycle({
      state: "unpublished_changes",
      currentPublishedVersion: published(2),
      access: access(1),
    });
    expect(copy.label).toBe("Editing");
    expect(copy.detail).toBe("Existing rooms keep Version 2. A new room uses your latest saved changes.");
    expect(copy.tone).toBe("changes");
  });

  it("distinguishes an exam with rooms from one nobody can enter yet, with the version as detail only", () => {
    const withRooms = describeExamLifecycle({ state: "published_current", currentPublishedVersion: published(3), access: access(2) });
    expect(withRooms.label).toBe("Rooms available");
    expect(withRooms.detail).toBe("Latest room exam: Version 3");
    const noRooms = describeExamLifecycle({ state: "published_current", currentPublishedVersion: published(3), access: access(0) });
    expect(noRooms.label).toBe("Ready · No rooms yet");
  });
});

describe("exam workspace navigation", () => {
  it("keeps Questions at the bare exam URL and encodes the id", () => {
    expect(examWorkspacePath("a b", "questions")).toBe("/sat/exams/a%20b");
    expect(examWorkspacePath("e1", "settings")).toBe("/sat/exams/e1/settings");
    expect(examWorkspacePath("e1", "responses")).toBe("/sat/exams/e1/responses");
  });

  it("shows Responses to admins only, because builders cannot read results", () => {
    expect(canViewExamResponses("admin")).toBe(true);
    for (const role of ["builder", "grader", "proctor", "student", null, undefined]) {
      expect(canViewExamResponses(role)).toBe(false);
    }
  });
});

describe("create-room navigation", () => {
  it("opens the Rooms tab with the create form requested, from any exam surface", () => {
    const url = new URL(deliveryDestination("exam-1"), "https://example.com");
    expect(url.pathname).toBe("/sat/exams/exam-1/access");
    expect(url.searchParams.get("new")).toBe("1");
  });
});
