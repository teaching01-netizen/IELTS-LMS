import { describe, expect, it, vi } from "vitest";
import { makeRevision } from "../../__tests__/divergenceFixtures";
import {
  COEDIT_FIELD_PATCH_KEYS,
  isPromptOnlyChange,
  promptFreeFieldPatch,
  promptFreeFieldsChangedSince,
  remotelyBlockedFields,
  savePromptFreeFields,
  type PromptFreeSaveDeps,
} from "../fieldPatch";
import type { QuestionRevision } from "../../../contracts/assessment";

function revision(overrides: Partial<QuestionRevision> = {}): QuestionRevision {
  return makeRevision(overrides);
}

function conflict(): Error & { statusCode: number } {
  return Object.assign(new Error("Question changed while you were editing."), {
    statusCode: 409,
  });
}

const PROMPT_JSON = JSON.stringify({
  type: "doc",
  content: [{ type: "paragraph", text: "Pick one" }],
});

describe("prompt-free field diff", () => {
  it("reports no change when only revision bookkeeping moved", () => {
    const base = revision();
    expect(promptFreeFieldsChangedSince(base, revision({ revision: base.revision + 4 }))).toEqual(
      []
    );
  });

  it("ignores tag order, which carries no meaning", () => {
    const base = revision();
    const reordered = revision({
      metadata: { ...base.metadata, tags: [...base.metadata.tags].reverse() },
    });
    expect(promptFreeFieldsChangedSince(base, reordered)).toEqual([]);
  });

  it("detects every allow-listed field and nothing else", () => {
    const base = revision();
    const local = revision({
      questionType: "student_produced_response",
      stimulus: { type: "doc", content: [] },
      answer: { kind: "student_produced_response", acceptedResponses: ["2"], normalizeFraction: false, normalizeDecimal: true, numericTolerance: "0.01" },
      rationale: { type: "doc", content: [{ type: "paragraph", text: "because" }] },
      metadata: { ...base.metadata, difficulty: "hard" },
      accessibility: { longDescription: "a long description" },
    });
    expect(promptFreeFieldsChangedSince(base, local).sort()).toEqual(
      [...COEDIT_FIELD_PATCH_KEYS].sort()
    );
  });

  it("treats an answer-key-only change as an answer change", () => {
    const base = revision();
    const local = revision({
      answer: { ...base.answer, correctOptionId: "b" } as QuestionRevision["answer"],
    });
    expect(promptFreeFieldsChangedSince(base, local)).toEqual(["answer"]);
  });

  it("distinguishes a prompt-only edit from a field edit", () => {
    const base = revision();
    const promptOnly = revision({
      prompt: { type: "doc", content: [{ type: "paragraph", text: "Pick the best one" }] },
    });
    const fieldOnly = revision({ metadata: { ...base.metadata, difficulty: "hard" } });
    expect(isPromptOnlyChange(base, promptOnly)).toBe(true);
    expect(isPromptOnlyChange(base, fieldOnly)).toBe(false);
    expect(isPromptOnlyChange(base, revision())).toBe(false);
  });
});

describe("prompt-free request shape", () => {
  it("carries only the requested fields plus the revision", () => {
    const local = revision({ rationale: { type: "doc", content: [] } });
    const request = promptFreeFieldPatch(local, ["rationale"]);
    expect(Object.keys(request).sort()).toEqual(["rationale", "revision"]);
    expect(request.revision).toBe(local.revision);
  });

  it("cannot express a prompt write in any field combination", () => {
    const local = revision();
    const request = promptFreeFieldPatch(local, [...COEDIT_FIELD_PATCH_KEYS]);
    expect(Object.keys(request)).not.toContain("prompt");
    expect(JSON.stringify(request)).not.toContain(PROMPT_JSON);
  });
});

describe("savePromptFreeFields", () => {
  function deps(overrides: Partial<PromptFreeSaveDeps> = {}): PromptFreeSaveDeps & {
    saveFields: ReturnType<typeof vi.fn>;
    loadLatest: ReturnType<typeof vi.fn>;
  } {
    return {
      saveFields: vi.fn(async (_id: string, request) =>
        revision({ revision: request.revision + 1 })
      ),
      loadLatest: vi.fn(async () => revision()),
      ...overrides,
    } as PromptFreeSaveDeps & {
      saveFields: ReturnType<typeof vi.fn>;
      loadLatest: ReturnType<typeof vi.fn>;
    };
  }

  it("writes nothing at all for a prompt-only change", async () => {
    const base = revision();
    const local = revision({
      prompt: { type: "doc", content: [{ type: "paragraph", text: "Pick the best one" }] },
    });
    const d = deps();
    await expect(
      savePromptFreeFields({ examQuestionId: "eq-1", revision: local, base, deps: d })
    ).resolves.toBeNull();
    expect(d.saveFields).not.toHaveBeenCalled();
  });

  it("saves only the changed field, and never the prompt", async () => {
    const base = revision();
    const local = revision({
      stimulus: { type: "doc", content: [] },
      prompt: { type: "doc", content: [{ type: "paragraph", text: "new prompt" }] },
    });
    const d = deps();
    const saved = await savePromptFreeFields({
      examQuestionId: "eq-1",
      revision: local,
      base,
      deps: d,
    });
    expect(d.saveFields).toHaveBeenCalledTimes(1);
    const [id, request] = d.saveFields.mock.calls[0] as [string, Record<string, unknown>];
    expect(id).toBe(local.id);
    expect(request.stimulus).toEqual(local.stimulus);
    expect(Object.keys(request)).not.toContain("prompt");
    expect(saved).not.toBeNull();
  });

  it("retries once with the fresh revision when the saved fields were not changed remotely", async () => {
    const base = revision();
    const local = revision({ metadata: { ...base.metadata, difficulty: "hard" } });
    const latest = revision({
      revision: base.revision + 1,
      // The prompt moved remotely, which must NOT block a prompt-free retry.
      prompt: { type: "doc", content: [{ type: "paragraph", text: "someone else" }] },
    });
    const saveFields = vi
      .fn()
      .mockRejectedValueOnce(conflict())
      .mockImplementationOnce(async (_id: string, request: { revision: number }) =>
        revision({ revision: request.revision + 1 })
      );
    const loadLatest = vi.fn(async () => latest);
    const saved = await savePromptFreeFields({
      examQuestionId: "eq-1",
      revision: local,
      base,
      deps: { saveFields, loadLatest },
    });
    expect(loadLatest).toHaveBeenCalledWith("eq-1");
    expect(saveFields).toHaveBeenCalledTimes(2);
    const retried = saveFields.mock.calls[1][1] as { revision: number };
    expect(retried.revision).toBe(latest.revision);
    expect(saved?.revision).toBe(latest.revision + 1);
  });

  it("rethrows the conflict when the same field changed remotely", async () => {
    const base = revision();
    const local = revision({ metadata: { ...base.metadata, difficulty: "hard" } });
    const latest = revision({
      revision: base.revision + 1,
      metadata: { ...base.metadata, difficulty: "easy" },
    });
    const saveFields = vi.fn().mockRejectedValue(conflict());
    const d: PromptFreeSaveDeps = { saveFields, loadLatest: vi.fn(async () => latest) };
    await expect(
      savePromptFreeFields({ examQuestionId: "eq-1", revision: local, base, deps: d })
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(saveFields).toHaveBeenCalledTimes(1);
  });

  it("does not load the latest revision for a non-conflict failure", async () => {
    const base = revision();
    const local = revision({ rationale: { type: "doc", content: [] } });
    const boom = Object.assign(new Error("service unavailable"), { statusCode: 503 });
    const saveFields = vi.fn().mockRejectedValue(boom);
    const loadLatest = vi.fn(async () => revision());
    await expect(
      savePromptFreeFields({
        examQuestionId: "eq-1",
        revision: local,
        base,
        deps: { saveFields, loadLatest },
      })
    ).rejects.toBe(boom);
    expect(loadLatest).not.toHaveBeenCalled();
  });

  it("sends every allow-listed field when no base is known, and never retries blindly", async () => {
    const local = revision();
    const saveFields = vi.fn().mockRejectedValue(conflict());
    const loadLatest = vi.fn(async () => revision());
    await expect(
      savePromptFreeFields({
        examQuestionId: "eq-1",
        revision: local,
        base: null,
        deps: { saveFields, loadLatest },
      })
    ).rejects.toMatchObject({ statusCode: 409 });
    const request = saveFields.mock.calls[0][1] as Record<string, unknown>;
    expect(loadLatest).not.toHaveBeenCalled();
    expect(Object.keys(request)).not.toContain("prompt");
    expect(Object.keys(request).length).toBe(COEDIT_FIELD_PATCH_KEYS.length + 1);
  });
});

describe("remotelyBlockedFields", () => {
  it("blocks only the fields the remote changed to a different value", () => {
    const base = revision();
    const local = revision({
      rationale: { type: "doc", content: [{ type: "paragraph", text: "mine" }] },
      stimulus: { type: "doc", content: [{ type: "paragraph", text: "shared" }] },
    });
    const remote = revision({
      rationale: { type: "doc", content: [{ type: "paragraph", text: "theirs" }] },
      stimulus: { type: "doc", content: [{ type: "paragraph", text: "shared" }] },
    });
    expect(
      remotelyBlockedFields({ base, local, remote, fields: ["rationale", "stimulus"] })
    ).toEqual(["rationale"]);
  });

  it("blocks a field whose remote change collides with a local one", () => {
    const base = revision();
    const local = revision({ metadata: { ...base.metadata, difficulty: "hard" } });
    const remote = revision({ metadata: { ...base.metadata, difficulty: "easy" } });
    expect(remotelyBlockedFields({ base, local, remote, fields: ["metadata"] })).toEqual([
      "metadata",
    ]);
  });
});
