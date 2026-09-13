import { describe, expect, it, vi } from "vitest";
import type { SnapshotSource } from "../contracts";
import type {
  AssessmentAuthoringShell,
  AssessmentQuestionDetail,
  AssessmentQuestionSummary,
} from "../../contracts/assessment";
import { recoverAuthoringSnapshot, shellQuestionIds } from "../recovery";

function summary(examQuestionId: string, displayOrder: number): AssessmentQuestionSummary {
  return {
    examQuestionId,
    questionId: `q-${examQuestionId}`,
    questionRevisionId: `rev-${examQuestionId}`,
    displayOrder,
    isPretest: false,
    questionType: "single_choice",
    semanticRevision: 1,
    revision: 1,
    promptPreview: "preview",
    answerKeyPreview: null,
    domain: null,
    skill: null,
    difficulty: "medium",
    tags: [],
    hasStimulus: false,
    contentComplexity: "plain",
    readiness: { status: "ready", blockingIssueCount: 0, warningCount: 0 },
  } as AssessmentQuestionSummary;
}

function shellWith(ids: string[]): AssessmentAuthoringShell {
  return {
    examId: "exam-1",
    providerKey: "sat",
    versionId: "draft-7",
    versionRevision: 5,
    sections: [
      {
        id: "sec-1",
        sectionKey: "rw",
        title: "Reading & Writing",
        displayOrder: 1,
        durationSeconds: 1920,
        breakAfterSeconds: 600,
        revision: 1,
        routingPolicy: null,
        modules: [
          {
            id: "mod-1",
            moduleKey: "rw-1",
            title: "Module 1",
            displayOrder: 1,
            durationSeconds: 1920,
            targetQuestionCount: 27,
            adaptiveRole: "none",
            toolPolicy: {},
            revision: 1,
            questions: ids.map((id, index) => summary(id, index)),
          },
        ],
      },
    ],
  } as AssessmentAuthoringShell;
}

function detail(examQuestionId: string): AssessmentQuestionDetail {
  return { examQuestionId, moduleId: "mod-1", moduleKey: "rw-1", sectionKey: "rw", displayOrder: 0, isPretest: false, question: {} } as unknown as AssessmentQuestionDetail;
}

interface Harness {
  ctx: Parameters<typeof recoverAuthoringSnapshot>[0];
  source: SnapshotSource;
  setShellData: ReturnType<typeof vi.fn>;
  setQuestionData: ReturnType<typeof vi.fn>;
  removeQuestionCache: ReturnType<typeof vi.fn>;
}

function harness(overrides: {
  shell?: AssessmentAuthoringShell;
  selected?: string | null;
  cached?: string[];
  getShell?: SnapshotSource["getShell"];
  getQuestion?: SnapshotSource["getQuestion"];
} = {}): Harness {
  const getShell =
    overrides.getShell ?? vi.fn(async () => overrides.shell ?? shellWith(["eq-1", "eq-2"]));
  const getQuestion = overrides.getQuestion ?? vi.fn(async (id: string) => detail(id));
  const source: SnapshotSource = { getShell, getQuestion };
  const setShellData = vi.fn();
  const setQuestionData = vi.fn();
  const removeQuestionCache = vi.fn();
  const ctx = {
    examId: "exam-1",
    selectedExamQuestionId: overrides.selected ?? null,
    source,
    setShellData,
    setQuestionData,
    removeQuestionCache,
    listCachedQuestionIds: () => overrides.cached ?? [],
    retryDelayMs: 0,
    wait: async () => undefined,
  };
  return { ctx, source, setShellData, setQuestionData, removeQuestionCache };
}

describe("recoverAuthoringSnapshot", () => {
  it("installs the authoritative shell and prunes cached ids it no longer contains", async () => {
    const h = harness({ cached: ["eq-1", "eq-gone"] });
    const result = await recoverAuthoringSnapshot(h.ctx, "cursor_too_old");
    expect(result).toEqual({ recovered: true, reason: "cursor_too_old" });
    expect(h.setShellData).toHaveBeenCalledTimes(1);
    expect(h.removeQuestionCache).toHaveBeenCalledWith("eq-gone");
    expect(h.removeQuestionCache).not.toHaveBeenCalledWith("eq-1");
  });

  it("refreshes the selected question detail when it still exists", async () => {
    const h = harness({ selected: "eq-2" });
    await recoverAuthoringSnapshot(h.ctx, "delivery_gap");
    expect(h.setQuestionData).toHaveBeenCalledWith("eq-2", expect.anything());
  });

  it("removes the selected cache when the question was deleted remotely (404)", async () => {
    const getQuestion = vi.fn(async () => {
      throw { statusCode: 404 };
    });
    const h = harness({ selected: "eq-1", getQuestion });
    const result = await recoverAuthoringSnapshot(h.ctx, "cursor_too_old");
    expect(result.recovered).toBe(true);
    expect(h.removeQuestionCache).toHaveBeenCalledWith("eq-1");
    expect(h.setQuestionData).not.toHaveBeenCalled();
  });

  it("removes the selected cache when it is absent from the fresh shell", async () => {
    const h = harness({ selected: "eq-deleted", shell: shellWith(["eq-1"]) });
    await recoverAuthoringSnapshot(h.ctx, "cursor_too_old");
    expect(h.removeQuestionCache).toHaveBeenCalledWith("eq-deleted");
    expect(h.source.getQuestion).not.toHaveBeenCalled();
  });

  it("retries once and succeeds on the second attempt", async () => {
    const getShell = vi
      .fn<SnapshotSource["getShell"]>()
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce(shellWith(["eq-1"]));
    const h = harness({ getShell });
    const result = await recoverAuthoringSnapshot(h.ctx, "replay_too_large");
    expect(result.recovered).toBe(true);
    expect(getShell).toHaveBeenCalledTimes(2);
  });

  it("reports failure after a second failure (hook falls back to degraded-http)", async () => {
    const getShell = vi.fn(async () => {
      throw new Error("down");
    });
    const h = harness({ getShell });
    const result = await recoverAuthoringSnapshot(h.ctx, "cursor_too_old");
    expect(result.recovered).toBe(false);
    expect(getShell).toHaveBeenCalledTimes(2);
    expect(h.setShellData).not.toHaveBeenCalled();
  });
});

describe("shellQuestionIds", () => {
  it("flattens every question id in the shell", () => {
    expect(shellQuestionIds(shellWith(["eq-1", "eq-2"]))).toEqual(["eq-1", "eq-2"]);
  });
});
