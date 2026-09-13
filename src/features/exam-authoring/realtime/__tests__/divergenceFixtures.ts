import type { QuestionRevision } from "../../contracts/assessment";

/** Minimal but structurally complete revision, overridable per test. */
export function makeRevision(overrides: Partial<QuestionRevision> = {}): QuestionRevision {
  return {
    id: "rev-1",
    questionId: "q-1",
    semanticRevision: 1,
    revision: 3,
    state: "draft",
    questionType: "single_choice",
    stimulus: null,
    prompt: { type: "doc", content: [{ type: "paragraph", text: "Pick one" }] },
    answer: {
      kind: "single_choice",
      options: [
        { id: "a", content: { type: "doc", content: [] } },
        { id: "b", content: { type: "doc", content: [] } },
      ],
      correctOptionId: "a",
    },
    rationale: null,
    metadata: {
      sectionKey: "rw",
      domain: "algebra",
      skill: "linear-equations",
      difficulty: "medium",
      tags: ["a", "b"],
    },
    accessibility: { longDescription: null },
    ...overrides,
  } as unknown as QuestionRevision;
}

/** Same content, different revision bookkeeping (a save that changed nothing). */
export function revisionBumped(base: QuestionRevision, revision: number): QuestionRevision {
  return { ...base, revision };
}
