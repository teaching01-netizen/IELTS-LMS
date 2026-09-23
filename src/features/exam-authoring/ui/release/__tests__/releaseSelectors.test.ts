import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type {
  AssessmentAuthoringShell,
  AssessmentValidationIssue,
  AssessmentValidationReport,
} from "../../../contracts/assessment";
import type { AssessmentReleaseState } from "../../../contracts/release";
import {
  candidateSecondsForSection,
  candidateSecondsForShell,
  operationalCountForSection,
  canPublishFromBlockers,
  formatDuration,
  formatPublishedDate,
  getFreshBlockers,
  getFreshWarnings,
  getHeroCopy,
  getHeroState,
  getHeroTone,
  getSATPublishBlockers,
  getPublishBlockers,
  isReadinessFresh,
  isSATPublishReadinessValid,
  normalizePublishNotes,
  parseIssueLink,
  secondsToMinutes,
  summarizeStaleReadiness,
  toUserFacingPublishError,
  toUserFacingReleaseError,
} from "../releaseSelectors";

// Owner-computed parity vectors: the numbers the Go clock rule
// (backend/go/internal/exams/section_time.go) actually produces, checked in by
// backend/go/internal/exams/parity_vectors_test.go. That Go test fails the
// moment this file stops matching the owner, so the expectations below are
// never frozen literals.
type ParityVector = {
  name: string;
  breakAfterSeconds: number;
  modules: Array<{ adaptiveRole: string; durationSeconds: number }>;
  candidateSeconds: number;
  candidateSecondsWithBreak: number;
};

const parityVectors = (
  JSON.parse(
    readFileSync(
      resolve(
        __dirname,
        "../../../../../../backend/go/internal/exams/testdata/candidate_section_length_vectors.json",
      ),
      "utf8",
    ),
  ) as { vectors: ParityVector[] }
).vectors;

const shell = {
  versionId: "version-1",
  versionRevision: 12,
} as AssessmentAuthoringShell;

const freshReport: AssessmentValidationReport = {
  examId: "exam-1",
  versionId: "version-1",
  versionRevision: 12,
  publishScope: "full",
  valid: true,
  errors: [],
  warnings: [],
};

const staleReport: AssessmentValidationReport = {
  ...freshReport,
  versionRevision: 11,
};

function releaseState(state: AssessmentReleaseState["state"]): AssessmentReleaseState {
  return {
    examId: "exam-1",
    providerKey: "sat",
    state,
    currentPublishedVersion:
      state === "never_published"
        ? null
        : {
            id: "published-v4",
            versionNumber: 4,
            revision: 1,
            publishNotes: null,
            publishScope: "full",
            publishedAt: "2026-08-29T03:26:24.000Z",
          },
    workingDraft: { id: "version-1", parentVersionId: null, versionNumber: 1, revision: 12 },
    summary: { candidateDurationSeconds: 4440, authoredQuestionCount: 81, deliveredQuestionCount: 54 },
    access: { totalLinks: 0, liveLinks: 0, upcomingLinks: 0, linksOnCurrentRelease: 0, liveLinksOnPreviousReleases: 0 },
  };
}

describe("isReadinessFresh", () => {
  it("matches exact version id and revision", () => {
    expect(isReadinessFresh(freshReport, shell)).toBe(true);
    expect(isReadinessFresh(freshReport, shell, "reading-writing")).toBe(false);
    expect(isReadinessFresh({ ...freshReport, publishScope: "reading-writing" }, shell, "reading-writing")).toBe(true);
    expect(isReadinessFresh(staleReport, shell)).toBe(false);
    expect(isReadinessFresh({ ...freshReport, versionId: "other" }, shell)).toBe(false);
    expect(isReadinessFresh(null, shell)).toBe(false);
    expect(isReadinessFresh(freshReport, null)).toBe(false);
    expect(isReadinessFresh(undefined, undefined)).toBe(false);
  });
});

describe("getFreshBlockers / getFreshWarnings", () => {
  const blocker: AssessmentValidationIssue = {
    code: "x",
    path: "p",
    message: "m",
    blocking: true,
  };
  it("returns lists only when fresh", () => {
    const report = { ...freshReport, errors: [blocker], warnings: [blocker] };
    expect(getFreshBlockers(report, true)).toEqual([blocker]);
    expect(getFreshWarnings(report, true)).toEqual([blocker]);
    expect(getFreshBlockers(report, false)).toEqual([]);
    expect(getFreshWarnings(report, false)).toEqual([]);
    expect(getFreshBlockers(null, true)).toEqual([]);
    expect(getFreshWarnings(undefined, true)).toEqual([]);
  });
});

describe("SAT publish readiness contract", () => {
  it("filters release gating to the four publish rule families", () => {
    const legacy: AssessmentValidationIssue = {
      code: "sat.metadata.domain.required",
      path: "examQuestion:q-1:metadata.domain",
      message: "Choose a domain.",
      blocking: true,
    };
    const prompt: AssessmentValidationIssue = {
      code: "question.prompt.required",
      path: "examQuestion:q-2:prompt",
      message: "Question text is required.",
      blocking: true,
    };
    const report = { ...freshReport, valid: false, errors: [legacy, prompt] };

    expect(getSATPublishBlockers(report, true)).toEqual([prompt]);
    expect(isSATPublishReadinessValid({ ...freshReport, valid: false, errors: [legacy] }, true)).toBe(true);
    expect(isSATPublishReadinessValid(report, true)).toBe(false);
    expect(isSATPublishReadinessValid(report, false)).toBe(false);
  });

  it("never reuses a fresh report across publish scopes", () => {
    const rwReport = { ...freshReport, publishScope: "reading-writing" as const };
    expect(isSATPublishReadinessValid(rwReport, true, "reading-writing")).toBe(true);
    expect(isSATPublishReadinessValid(rwReport, true, "full")).toBe(false);
  });
});

describe("getPublishBlockers", () => {
  const base = {
    lifecycleState: "never_published" as const,
    readinessFresh: true,
    readinessValid: true,
    blockerCount: 0,
    dirtyCount: 0,
    isPublishing: false,
    canEdit: true,
    canPublishExam: true,
  };
  it("is empty for a clean publishable draft", () => {
    expect(getPublishBlockers(base)).toEqual([]);
    expect(canPublishFromBlockers(getPublishBlockers(base))).toBe(true);
  });
  it("reports permissions first", () => {
    const reasons = getPublishBlockers({ ...base, canPublishExam: false, canEdit: false });
    expect(reasons[0]).toMatch(/permission to publish/);
    expect(reasons[1]).toMatch(/permission to edit/);
  });
  it("reports already-published state", () => {
    expect(
      getPublishBlockers({ ...base, lifecycleState: "published_current" }),
    ).toContain("This draft is already published");
  });
  it("enumerates blockers, staleness, dirt, and busy", () => {
    const reasons = getPublishBlockers({
      ...base,
      blockerCount: 3,
      readinessFresh: false,
      dirtyCount: 2,
      isPublishing: true,
    });
    expect(reasons).toContain("3 blocking issues to resolve");
    expect(reasons.some((r) => /stale/.test(r))).toBe(true);
    expect(reasons.some((r) => /2 unsaved delivery sections/.test(r))).toBe(true);
    expect(reasons).toContain("Publishing is in progress");
    expect(canPublishFromBlockers(reasons)).toBe(false);
  });
  it("distinguishes stale from failing checks", () => {
    expect(
      getPublishBlockers({ ...base, readinessFresh: true, readinessValid: false })[0],
    ).toMatch(/failing/);
  });
  it("singularizes one blocker and one dirty section", () => {
    const reasons = getPublishBlockers({ ...base, blockerCount: 1, dirtyCount: 1 });
    expect(reasons).toContain("1 blocking issue to resolve");
    expect(reasons.some((r) => /1 unsaved delivery section\b/.test(r))).toBe(true);
  });
  it("clamps negative dirty counts", () => {
    expect(getPublishBlockers({ ...base, dirtyCount: -2 })).toEqual([]);
  });
});

describe("hero state machine", () => {
  it("covers published / unpublished / checking / ready / review / preparing", () => {
    expect(
      getHeroState({ releaseState: releaseState("published_current"), readinessValid: true, hasReadiness: true, isChecking: false, dirtyCount: 0 }),
    ).toBe("published");
    expect(
      getHeroState({ releaseState: releaseState("unpublished_changes"), readinessValid: true, hasReadiness: true, isChecking: true, dirtyCount: 0 }),
    ).toBe("unpublished");
    expect(
      getHeroState({ releaseState: releaseState("never_published"), readinessValid: false, hasReadiness: false, isChecking: true, dirtyCount: 0 }),
    ).toBe("checking");
    expect(
      getHeroState({ releaseState: releaseState("never_published"), readinessValid: true, hasReadiness: true, isChecking: false, dirtyCount: 0 }),
    ).toBe("ready");
    expect(
      getHeroState({ releaseState: releaseState("never_published"), readinessValid: false, hasReadiness: true, isChecking: false, dirtyCount: 0 }),
    ).toBe("review");
    expect(
      getHeroState({ releaseState: releaseState("never_published"), readinessValid: false, hasReadiness: false, isChecking: false, dirtyCount: 0 }),
    ).toBe("preparing");
  });
  it("dirty never-published draft falls back to review state with save-first copy", () => {
    // Mirrors the page: ready requires a clean draft, so a dirty valid draft
    // renders "Review required" with a save-first description.
    expect(
      getHeroState({ releaseState: releaseState("never_published"), readinessValid: true, hasReadiness: true, isChecking: false, dirtyCount: 1 }),
    ).toBe("review");
    expect(
      getHeroCopy("review", { releaseState: releaseState("never_published"), dirtyCount: 1, readinessValid: true }).description,
    ).toMatch(/Save 1 delivery section/);
    expect(
      getHeroCopy("ready", { releaseState: releaseState("never_published"), dirtyCount: 1, readinessValid: true }).description,
    ).toMatch(/Save 1 delivery section/);
  });
  it("a dirty published_current draft is not published", () => {
    expect(
      getHeroState({ releaseState: releaseState("published_current"), readinessValid: true, hasReadiness: true, isChecking: false, dirtyCount: 1 }),
    ).toBe("unpublished");
  });
  it("copy preserves version and dirty details", () => {
    const unpublished = releaseState("unpublished_changes");
    expect(getHeroCopy("published", { releaseState: releaseState("published_current"), dirtyCount: 0, readinessValid: true }).heading).toBe("Published");
    expect(getHeroCopy("unpublished", { releaseState: unpublished, dirtyCount: 2, readinessValid: true }).description).toMatch(/Save 2 delivery sections/);
    expect(getHeroCopy("unpublished", { releaseState: unpublished, dirtyCount: 2, readinessValid: true }).description).toMatch(/Version 4/);
    expect(getHeroCopy("ready", { releaseState: unpublished, dirtyCount: 0, readinessValid: true }).description).toMatch(/Version 5/);
    expect(getHeroCopy("checking", { releaseState: unpublished, dirtyCount: 0, readinessValid: false }).heading).toMatch(/Checking/);
    expect(getHeroCopy("preparing", { releaseState: releaseState("never_published"), dirtyCount: 0, readinessValid: false }).description).toMatch(/Run publish checks/);
  });
  it("tone mapping is stable", () => {
    expect(getHeroTone("published")).toBe("emerald");
    expect(getHeroTone("ready")).toBe("emerald");
    expect(getHeroTone("unpublished")).toBe("amber");
    expect(getHeroTone("review")).toBe("amber");
    expect(getHeroTone("checking")).toBe("slate");
    expect(getHeroTone("preparing")).toBe("slate");
  });
});

describe("parseIssueLink", () => {
  it("parses question deep links", () => {
    expect(parseIssueLink("examQuestion:q-17:metadata.domain")).toEqual({
      questionId: "q-17",
      field: "metadata.domain",
    });
  });
  it("returns nulls for malformed paths", () => {
    expect(parseIssueLink("reading-writing.rw-m1.duration")).toEqual({ questionId: null, field: null });
    expect(parseIssueLink("")).toEqual({ questionId: null, field: null });
    expect(parseIssueLink("examQuestion::")).toEqual({ questionId: null, field: null });
    expect(parseIssueLink("examQuestion:q-1:")).toEqual({ questionId: "q-1", field: null });
  });
});

describe("formatting", () => {
  it("floors durations without a phantom 60 min", () => {
    expect(formatDuration(0)).toBe("0 min");
    expect(formatDuration(59)).toBe("0 min");
    expect(formatDuration(3599)).toBe("59 min");
    expect(formatDuration(3600)).toBe("1 hr");
    expect(formatDuration(3660)).toBe("1 hr 1 min");
    expect(formatDuration(-5)).toBe("0 min");
    expect(formatDuration(Number.NaN)).toBe("0 min");
  });
  it("handles invalid dates", () => {
    expect(formatPublishedDate("not-a-date")).toBe("recently");
    expect(formatPublishedDate("2026-08-29T03:26:24.000Z")).not.toBe("recently");
  });
  it("rounds seconds to whole minutes", () => {
    expect(secondsToMinutes(60)).toBe(1);
    expect(secondsToMinutes(0)).toBe(1);
    expect(secondsToMinutes(-10)).toBe(1);
    expect(secondsToMinutes(Number.NaN)).toBe(1);
  });
  it("normalizes publish notes", () => {
    expect(normalizePublishNotes(undefined)).toBeUndefined();
    expect(normalizePublishNotes("   ")).toBeUndefined();
    expect(normalizePublishNotes("  hello  ")).toBe("hello");
    expect(normalizePublishNotes("x".repeat(2000))).toHaveLength(1000);
  });
});

describe("candidate duration", () => {
  const section = {
    breakAfterSeconds: 600,
    modules: [
      { adaptiveRole: "base", durationSeconds: 1920 },
      { adaptiveRole: "lower_branch", durationSeconds: 1920 },
      { adaptiveRole: "higher_branch", durationSeconds: 2100 },
    ],
  };
  it("uses base plus the longer branch, not every authored module", () => {
    // 1920 + max(1920, 2100) + 600 = 4620. Summing all three modules
    // (1920*2 + 2100 + 600 = 6540) would overstate the longest sitting.
    expect(candidateSecondsForSection(section)).toBe(4620);
    // The final section's break is not part of the candidate-facing sitting.
    expect(candidateSecondsForShell({ sections: [section, section] })).toBe(8640);
  });
  it("counts only the selected section and drops its final inter-section break", () => {
    const rw = { ...section, sectionKey: "reading-writing" };
    const math = { ...section, sectionKey: "math" };
    expect(candidateSecondsForShell({ sections: [rw, math] }, "reading-writing")).toBe(4020);
    expect(candidateSecondsForShell({ sections: [rw, math] }, "math")).toBe(4020);
  });
  it("survives a missing base without NaN", () => {
    expect(
      candidateSecondsForSection({ breakAfterSeconds: 0, modules: [] }),
    ).toBe(0);
  });

  // Parity pin with the Go owner (backend/go/internal/exams/section_time.go:
  // CandidateSectionSeconds = base + the longer branch, behind the Go guard)
  // against the same checked-in artifact its own test writes.
  //
  // The failure directions, precisely: a drift in this selector fails here; an
  // owner drift fails the Go artifact test immediately, and reaches this test
  // only once the artifact is regenerated (the selector then still returns the
  // previous total). Frozen `want:` literals would be weaker still — an owner
  // change would leave them green in every sequence.
  it("has owner-computed vectors to check", () => {
    expect(parityVectors.length).toBeGreaterThan(0);
  });
  it.each(parityVectors)(
    "matches the Go owner: $name",
    ({ modules, breakAfterSeconds, candidateSecondsWithBreak }) => {
      expect(
        candidateSecondsForSection({
          breakAfterSeconds,
          modules: modules.map(({ adaptiveRole, durationSeconds }) => ({
            adaptiveRole,
            durationSeconds,
          })),
        }),
      ).toBe(candidateSecondsWithBreak);
    },
  );
});

describe("operationalCountForSection", () => {
  const baseModule = (overrides = {}) => ({
    moduleKey: "rw-m1",
    adaptiveRole: "base" as const,
    targetQuestionCount: 27,
    questions: Array.from({ length: 27 }, (_, index) => ({
      isPretest: index >= 25,
    })),
    ...overrides,
  });
  it("uses the live stored count when it is positive", () => {
    expect(
      operationalCountForSection({
        sectionKey: "reading-writing",
        routingPolicy: { operationalQuestionCount: 25 },
        modules: [baseModule()],
      }),
    ).toBe(25);
  });
  it("falls back to the SAT blueprint on threshold-only rows (the stuck-at-1 repro)", () => {
    // Real policy_config is threshold-only, so the shell arrives with
    // operationalQuestionCount: 0 — the page must still offer RW 25.
    expect(
      operationalCountForSection({
        sectionKey: "reading-writing",
        routingPolicy: { operationalQuestionCount: 0 },
        modules: [baseModule()],
      }),
    ).toBe(25);
    expect(
      operationalCountForSection({
        sectionKey: "math",
        routingPolicy: { operationalQuestionCount: 0 },
        modules: [
          baseModule({
            moduleKey: "math-m1",
            targetQuestionCount: 22,
            questions: Array.from({ length: 22 }, (_, index) => ({
              isPretest: index >= 20,
            })),
          }),
        ],
      }),
    ).toBe(20);
  });
  it("derives target-minus-pretest for non-blueprint sections and floors at 1", () => {
    expect(
      operationalCountForSection({
        sectionKey: "custom",
        routingPolicy: { operationalQuestionCount: 0 },
        modules: [
          {
            moduleKey: "custom-m1",
            adaptiveRole: "base",
            targetQuestionCount: 10,
            questions: [{ isPretest: false }, { isPretest: true }],
          },
        ],
      }),
    ).toBe(9);
    expect(operationalCountForSection({ sectionKey: "custom", routingPolicy: null, modules: [] })).toBe(1);
  });
});

describe("errors", () => {
  it("maps conflicts to refresh copy and hides raw bodies", () => {
    expect(toUserFacingReleaseError(new Error("version conflict 409"))).toMatch(/draft changed/i);
    expect(toUserFacingReleaseError(new Error("etag 412 mismatch"))).toMatch(/draft changed/i);
    expect(toUserFacingReleaseError(new Error("Network fetch failed"))).toMatch(/connection/i);
    expect(toUserFacingReleaseError("string")).toMatch(/could not be saved/);
  });
  it("maps publish failures without leaking raw bodies", () => {
    expect(toUserFacingPublishError(new Error("publish 500 <html>stack</html>"))).toBe(
      "The SAT version could not be published. Try again.",
    );
    expect(toUserFacingPublishError(new Error("revision conflict 409"))).toMatch(
      /draft changed/i,
    );
    expect(toUserFacingPublishError(new Error("Network timeout"))).toMatch(/connection/i);
    expect(toUserFacingPublishError(new Error("Run publish checks first"))).toMatch(
      /publish checks/i,
    );
    expect(toUserFacingPublishError(undefined)).toMatch(/could not be published/i);
  });
  it("summarizes stale readiness", () => {
    expect(summarizeStaleReadiness(freshReport, shell).fresh).toBe(true);
    const stale = summarizeStaleReadiness(staleReport, shell);
    expect(stale.fresh).toBe(false);
    expect(stale.checkedLabel).toMatch(/revision 11/);
  });
});
