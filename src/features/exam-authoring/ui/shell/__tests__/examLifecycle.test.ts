import { describe, expect, it } from "vitest";
import type { AssessmentReleaseState } from "../../../contracts/release";
import { canViewExamResponses, describeExamLifecycle, deliveryDestination, examWorkspacePath, parseDeliveryCreate } from "../examLifecycle";

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
  it("calls an unloaded or never-published exam a draft", () => {
    expect(describeExamLifecycle(null).label).toBe("Draft");
    expect(
      describeExamLifecycle({ state: "never_published", currentPublishedVersion: null, access: access(0) }).label,
    ).toBe("Draft");
  });

  it("names the live version and says it stays available while changes are unpublished", () => {
    const copy = describeExamLifecycle({
      state: "unpublished_changes",
      currentPublishedVersion: published(2),
      access: access(1),
    });
    expect(copy.label).toBe("Unpublished changes");
    expect(copy.detail).toBe("Version 2 remains available to students");
    expect(copy.tone).toBe("changes");
  });

  it("distinguishes a published exam with sessions from one nobody can enter yet", () => {
    expect(
      describeExamLifecycle({ state: "published_current", currentPublishedVersion: published(3), access: access(2) }).label,
    ).toBe("Published · Version 3");
    expect(
      describeExamLifecycle({ state: "published_current", currentPublishedVersion: published(3), access: access(0) }).label,
    ).toBe("Published · Version 3 · No sessions yet");
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


describe("published version setup navigation", () => {
  const target = { versionId: "version/4", versionNumber: 4, publishScope: "math" as const };

  it("carries the exact version into the create-session path", () => {
    const path = deliveryDestination("exam-1", target);
    const params = new URL(path, "https://example.com").searchParams;
    expect(params.get("new")).toBe("1");
    expect(parseDeliveryCreate(params)).toEqual(target);
  });

  it("opens an unpinned create form from any exam surface, and ignores the retired reuse handoff", () => {
    const params = new URL(deliveryDestination("exam-1"), "https://example.com").searchParams;
    expect(parseDeliveryCreate(params)).toBe("any");
    expect(parseDeliveryCreate(new URLSearchParams({ reuse: "1", version: "version/4", versionNumber: "4", scope: "math" }))).toBeNull();
  });
});
