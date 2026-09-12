import { beforeEach, describe, expect, it, vi } from "vitest";

const backendPost = vi.hoisted(() => vi.fn());
const backendGet = vi.hoisted(() => vi.fn());
const backendPatch = vi.hoisted(() => vi.fn());

vi.mock("../../infrastructure/examAuthoringBackendGateway", () => ({
  backendGet,
  backendPost,
  backendPatch,
}));

import { assessmentAuthoringApi } from "../assessmentAuthoringApi";

describe("assessmentAuthoringApi question contracts", () => {
  beforeEach(() => {
    backendPost.mockReset();
    backendGet.mockReset();
    backendPatch.mockReset();
  });

  it("creates a question with no body (empty-body POST the backend accepts)", async () => {
    backendPost.mockResolvedValue({ examQuestionId: "eq-new", question: { id: "rev-new" } });
    await assessmentAuthoringApi.createQuestion("mod-1");
    expect(backendPost).toHaveBeenCalledWith("/v1/assessment-authoring/modules/mod-1/questions");
  });

  it("sends batch drafts under `questions` (the key the backend reads)", async () => {
    backendPost.mockResolvedValue({ createdQuestionIds: ["eq-1"], questions: [] });
    const draft: any = {
      questionType: "single_choice",
      stimulus: {},
      prompt: {},
      answer: { kind: "single_choice", options: [], correctOptionId: null },
      rationale: {},
      metadata: { sectionKey: "reading-writing", domain: null, skill: null, difficulty: "medium", tags: [] },
      accessibility: { longDescription: null },
      isPretest: false,
    };
    const result = await assessmentAuthoringApi.batchCreateQuestions("mod-1", { questions: [draft] });
    expect(backendPost).toHaveBeenCalledWith(
      "/v1/assessment-authoring/modules/mod-1/questions/batch",
      { questions: [draft] },
      undefined,
    );
    expect(result.createdQuestionIds).toEqual(["eq-1"]);
  });

  it("saves a revision with the fencing revision plus answer (not answerDefinition)", async () => {
    backendPatch.mockResolvedValue({ examQuestionId: "eq-1" });
    const request: any = {
      revision: 3,
      questionType: "single_choice",
      stimulus: {},
      prompt: {},
      answer: { kind: "single_choice", options: [], correctOptionId: null },
      rationale: {},
      metadata: {},
      accessibility: { longDescription: null },
    };
    await assessmentAuthoringApi.saveQuestionRevision("rev-1", request);
    expect(backendPatch).toHaveBeenCalledWith(
      "/v1/assessment-authoring/question-revisions/rev-1",
      request,
    );
    expect("answerDefinition" in request).toBe(false);
  });

  it("reorders with the frontend questionIds key and returns summaries", async () => {
    const summaries: any[] = [];
    backendPatch.mockResolvedValue(summaries);
    const result = await assessmentAuthoringApi.reorderQuestions("mod-1", {
      expectedQuestionIds: ["eq-1"],
      questionIds: ["eq-1"],
    });
    expect(backendPatch).toHaveBeenCalledWith(
      "/v1/assessment-authoring/modules/mod-1/question-order",
      { expectedQuestionIds: ["eq-1"], questionIds: ["eq-1"] },
    );
    expect(result).toBe(summaries);
  });

  it("duplicates while tolerating insertAfterExamQuestionId", async () => {
    backendPost.mockResolvedValue({ examQuestionId: "eq-copy" });
    await assessmentAuthoringApi.duplicateQuestion("eq-1", {
      destinationModuleId: "mod-1",
      insertAfterExamQuestionId: "eq-1",
    });
    expect(backendPost).toHaveBeenCalledWith(
      "/v1/assessment-authoring/exam-questions/eq-1/duplicate",
      { destinationModuleId: "mod-1", insertAfterExamQuestionId: "eq-1" },
      undefined,
    );
  });

  it("bulks with value + expectedRevisions and reads the result shape", async () => {
    const resultPayload = { affectedQuestionIds: ["eq-1"], createdQuestionIds: [], updatedQuestions: [] };
    backendPost.mockResolvedValue(resultPayload);
    const result = await assessmentAuthoringApi.bulkQuestions({
      questionIds: ["eq-1"],
      action: { type: "set_pretest", value: true } as any,
      expectedRevisions: { "eq-1": 2 },
    });
    expect(backendPost).toHaveBeenCalledWith("/v1/assessment-authoring/questions/bulk", {
      questionIds: ["eq-1"],
      action: { type: "set_pretest", value: true },
      expectedRevisions: { "eq-1": 2 },
    }, undefined);
    expect(result).toEqual(resultPayload);
  });
});
