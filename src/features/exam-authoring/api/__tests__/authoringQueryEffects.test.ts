import { describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import type {
  AssessmentAuthoringShellResult,
  AssessmentQuestionDetail,
  AssessmentQuestionSummary,
  QuestionRevision,
} from "../../contracts/assessment";
import { makeQuestionDetail, makeShell } from "../../realtime/__tests__/fixtures";
import { accessLinkKeys } from "../accessLinkKeys";
import { assessmentKeys, authoringEffects, readyShellResult } from "../authoringQueryEffects";

/**
 * The cache-effects vocabulary, locked.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Every authoring write and realtime event now names an effect instead of a key
 * list, which only stays honest if the effects' projections are pinned down:
 * "the tree and the reports derived from it" and "the two reports, without the
 * rows" are different cache work, and a remote `question.changed` depends on
 * that difference to avoid refetching the whole shell on every keystroke-
 * adjacent event.
 *
 * So each test asserts TWO things: which projections an effect touches, and
 * with which refetch policy. The projections are exact sets — a superset is a
 * regression here, not a harmless extra, because the quiet callers chose their
 * effect precisely to avoid the rest.
 */

interface Spy {
  mock: { calls: unknown[][] };
}

interface RecordedCall {
  key: string;
  refetchType: string | undefined;
}

function recordedCalls(spy: Spy): RecordedCall[] {
  return spy.mock.calls.map((call) => {
    const filters = call[0] as { queryKey?: unknown; refetchType?: string } | undefined;
    return {
      key: JSON.stringify(filters?.queryKey),
      refetchType: filters?.refetchType,
    };
  });
}

function invalidatedKeys(spy: Spy): string[] {
  return recordedCalls(spy)
    .map((call) => call.key)
    .sort();
}

function removedKeys(spy: Spy): string[] {
  return recordedCalls(spy)
    .map((call) => call.key)
    .sort();
}

function keysOf(...keys: readonly unknown[][]): string[] {
  return keys.map((key) => JSON.stringify(key)).sort();
}

const SHELL = assessmentKeys.shell("exam-1");
const READINESS_ROOT = assessmentKeys.readinessRoot("exam-1");
const RELEASE = assessmentKeys.release("exam-1");
const QUESTION = assessmentKeys.question("eq-1");
const OTHER_QUESTION = assessmentKeys.question("eq-2");

function rowsOf(queryClient: QueryClient): (AssessmentQuestionSummary | undefined)[] {
  const shell = queryClient.getQueryData<AssessmentAuthoringShellResult>(
    assessmentKeys.shell("exam-1")
  );
  return (
    shell?.shell?.sections.flatMap((section) =>
      section.modules.flatMap((module) => module.questions)
    ) ?? []
  );
}

/** A revision shaped like an HTTP save response for `eq-1`. */
function makeSavedRevision(revision: number): QuestionRevision {
  return {
    id: `rev-${revision}`,
    questionId: "q-eq-1",
    revision,
    semanticRevision: revision,
    questionType: "single_choice",
    stimulus: null,
    prompt: null,
    rationale: null,
    answer: {
      kind: "single_choice",
      options: [{ id: "A", content: null }],
      correctOptionId: "A",
      acceptedResponses: [],
    },
    metadata: {
      sectionKey: "rw",
      domain: null,
      skill: null,
      difficulty: "medium",
      tags: [],
    },
  } as unknown as QuestionRevision;
}

function makeClient() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  // No observers are mounted in this test, so every invalidation/removal is
  // recorded by the spy without scheduling a fetch: the effects' cache POLICY
  // is the subject, not the fetches it would trigger.
  return {
    queryClient,
    invalidateSpy: vi.spyOn(queryClient, "invalidateQueries"),
    removeSpy: vi.spyOn(queryClient, "removeQueries"),
    setSpy: vi.spyOn(queryClient, "setQueryData"),
  };
}

describe("authoring effect vocabulary", () => {
  it("shellChanged marks the tree AND the two reports derived from it", async () => {
    const { queryClient, invalidateSpy } = makeClient();

    await authoringEffects.shellChanged(queryClient, "exam-1");

    expect(invalidatedKeys(invalidateSpy)).toEqual(keysOf(SHELL, READINESS_ROOT, RELEASE));
    // No refetchType option: the default active refetch, i.e. a real re-read.
    for (const call of recordedCalls(invalidateSpy)) {
      expect(call.refetchType).toBeUndefined();
    }
  });

  it("shellChanged(none) keeps the quiet policy on EVERY projection, release included", async () => {
    const { queryClient, invalidateSpy } = makeClient();

    await authoringEffects.shellChanged(queryClient, "exam-1", { refetchType: "none" });

    expect(invalidatedKeys(invalidateSpy)).toEqual(keysOf(SHELL, READINESS_ROOT, RELEASE));
    // The regression this locks: the release key used to keep its default
    // active refetch, so a quiet bulk write could still kick a release read.
    for (const call of recordedCalls(invalidateSpy)) {
      expect(call.refetchType).toBe("none");
    }
  });

  it("shellDocumentChanged touches the shell alone", async () => {
    const { queryClient, invalidateSpy } = makeClient();

    await authoringEffects.shellDocumentChanged(queryClient, "exam-1", "none");

    expect(invalidatedKeys(invalidateSpy)).toEqual(keysOf(SHELL));
    expect(recordedCalls(invalidateSpy)[0]?.refetchType).toBe("none");
  });

  it("readinessAndReleaseChanged touches the two reports alone, actively", async () => {
    const { queryClient, invalidateSpy } = makeClient();

    await authoringEffects.readinessAndReleaseChanged(queryClient, "exam-1");

    expect(invalidatedKeys(invalidateSpy)).toEqual(keysOf(READINESS_ROOT, RELEASE));
    for (const call of recordedCalls(invalidateSpy)) {
      expect(call.refetchType).toBeUndefined();
    }
  });

  it("questionDetailChanged touches one question, never the tree", async () => {
    const { queryClient, invalidateSpy } = makeClient();

    await authoringEffects.questionDetailChanged(queryClient, "eq-1");

    expect(invalidatedKeys(invalidateSpy)).toEqual(keysOf(QUESTION));
    expect(recordedCalls(invalidateSpy)[0]?.refetchType).toBeUndefined();
  });

  it("questionDetailRemoved drops one question, never the tree", async () => {
    const { queryClient, invalidateSpy, removeSpy } = makeClient();

    authoringEffects.questionDetailRemoved(queryClient, "eq-1");

    expect(removedKeys(removeSpy)).toEqual(keysOf(QUESTION));
    expect(removeSpy.mock.calls).toHaveLength(1);
    expect(invalidateSpy).not.toHaveBeenCalled();
    expect(removeSpy.mock.calls[0]?.[1]).toBeUndefined();
  });

  it("questionDetailLoaded writes the fetched snapshot instead of re-reading it", () => {
    const { queryClient, invalidateSpy, setSpy } = makeClient();
    const detail = {
      examQuestionId: "eq-1",
      moduleId: "mod-1",
      moduleKey: "rw-1",
      sectionKey: "rw",
      displayOrder: 0,
      isPretest: false,
      question: {},
    } as unknown as AssessmentQuestionDetail;

    authoringEffects.questionDetailLoaded(queryClient, "eq-1", detail);

    expect(setSpy).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(setSpy.mock.calls[0]?.[0])).toBe(JSON.stringify(QUESTION));
    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  it("questionSaved installs the row's summary and the detail, and invalidates nothing", () => {
    const { queryClient, invalidateSpy, removeSpy, setSpy } = makeClient();
    const saved = makeSavedRevision(9);
    queryClient.setQueryData(
      assessmentKeys.shell("exam-1"),
      readyShellResult(makeShell(["eq-1", "eq-2"]))
    );
    queryClient.setQueryData(assessmentKeys.question("eq-1"), makeQuestionDetail("eq-1"));
    const otherRow = rowsOf(queryClient)[1];
    const writesBefore = setSpy.mock.calls.length;

    authoringEffects.questionSaved(queryClient, "exam-1", "eq-1", saved);

    const [subjectRow, stillOtherRow] = rowsOf(queryClient);
    expect(subjectRow?.questionRevisionId).toBe("rev-9");
    expect(subjectRow?.revision).toBe(9);
    expect(subjectRow?.answerKeyPreview).toBe("A");
    // The promise this write makes: a save cannot move another row, so the
    // unrelated row is the SAME object, not a rebuilt equal one.
    expect(stillOtherRow).toBe(otherRow);
    // React Query's structural sharing may hand back a clone of the saved
    // revision; what the effect promises is that the CACHED detail now IS the
    // version that was saved, not the one that was there before.
    expect(
      queryClient.getQueryData<AssessmentQuestionDetail>(assessmentKeys.question("eq-1"))?.question
    ).toStrictEqual(saved);
    // Exactly two writes — the row's tree and the detail — and no more.
    expect(setSpy.mock.calls.length - writesBefore).toBe(2);
    expect(invalidateSpy).not.toHaveBeenCalled();
    expect(removeSpy).not.toHaveBeenCalled();
  });

  it("questionSaved is a no-op on a cache holding no ready shell", () => {
    const { queryClient, invalidateSpy } = makeClient();

    authoringEffects.questionSaved(queryClient, "exam-1", "eq-1", makeSavedRevision(9));

    expect(queryClient.getQueryData(assessmentKeys.shell("exam-1"))).toBeUndefined();
    expect(queryClient.getQueryData(assessmentKeys.question("eq-1"))).toBeUndefined();
    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  it("questionPrefetched reads the open question's key on the shared stale-time policy", async () => {
    const { queryClient } = makeClient();
    const prefetchSpy = vi.spyOn(queryClient, "prefetchQuery");
    const fetch = vi.fn(async () => makeQuestionDetail("eq-1"));

    await authoringEffects.questionPrefetched(queryClient, "eq-1", fetch);

    expect(fetch).toHaveBeenCalledTimes(1);
    const options = prefetchSpy.mock.calls[0]?.[0] as {
      queryKey: unknown;
      staleTime?: number;
    };
    expect(JSON.stringify(options.queryKey)).toBe(JSON.stringify(QUESTION));
    expect(options.staleTime).toBe(60_000);
  });

  it("questionRemoved drops the detail, then marks the tree", async () => {
    const { queryClient, invalidateSpy, removeSpy } = makeClient();

    await authoringEffects.questionRemoved(queryClient, "exam-1", "eq-1");

    expect(removedKeys(removeSpy)).toEqual(keysOf(QUESTION));
    expect(invalidatedKeys(invalidateSpy)).toEqual(keysOf(SHELL, READINESS_ROOT, RELEASE));
  });

  it("accessChanged names the access-link projections, not the authoring ones", async () => {
    const { queryClient, invalidateSpy } = makeClient();

    await authoringEffects.accessChanged(queryClient, "exam-1", "link-1");

    expect(invalidatedKeys(invalidateSpy)).toEqual(
      keysOf(
        accessLinkKeys.overview("exam-1"),
        accessLinkKeys.link("link-1"),
        accessLinkKeys.members("link-1"),
        RELEASE
      )
    );
  });

  it("accessDeleted removes the link from the cached overview and drops link-specific projections", async () => {
    const { queryClient, invalidateSpy, removeSpy } = makeClient();
    queryClient.setQueryData(accessLinkKeys.overview("exam-1"), {
      currentPublishedVersion: null,
      links: [{ id: "link-1" }, { id: "link-2" }],
    });

    await authoringEffects.accessDeleted(queryClient, "exam-1", "link-1");

    expect(queryClient.getQueryData(accessLinkKeys.overview("exam-1"))).toEqual({
      currentPublishedVersion: null,
      links: [{ id: "link-2" }],
    });
    expect(removedKeys(removeSpy)).toEqual(
      keysOf(
        accessLinkKeys.link("link-1"),
        accessLinkKeys.members("link-1"),
        accessLinkKeys.activity("link-1"),
        accessLinkKeys.public("link-1")
      )
    );
    expect(invalidatedKeys(invalidateSpy)).toEqual(
      keysOf(accessLinkKeys.overview("exam-1"), RELEASE)
    );
  });

  it("an effect never touches an unrelated question's cache", async () => {
    const { queryClient, invalidateSpy, removeSpy } = makeClient();

    await authoringEffects.questionDetailChanged(queryClient, "eq-1");
    authoringEffects.questionDetailRemoved(queryClient, "eq-1");

    const touched = new Set([...invalidatedKeys(invalidateSpy), ...invalidatedKeys(removeSpy)]);
    expect(touched.has(JSON.stringify(OTHER_QUESTION))).toBe(false);
    expect(touched.has(JSON.stringify(SHELL))).toBe(false);
  });
});
