import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { QuestionRevision } from "../../contracts/assessment";
import { serverQuestionDocument, useAuthoringDraft } from "../useAuthoringDraft";

/**
 * The draft owner's two rules.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * "May the server document replace the local work?" is the rule the whole
 * refetch path hangs on, and every one of its conditions is a fact that arrives
 * from a different owner (the query, the selection, the recovered device draft,
 * the lifecycle's protection flag). The refs it reads now live HERE rather than
 * in persistence, so this is the one place that can exercise all four gates —
 * and the file the earlier audit correctly noted was missing.
 */

function revision(revisionNumber: number): QuestionRevision {
  return {
    id: `rev-${revisionNumber}`,
    questionId: "q-1",
    semanticRevision: revisionNumber,
    revision: revisionNumber,
    state: "draft",
    questionType: "single_choice",
    stimulus: { version: 2, nodes: [], document: { type: "doc" } },
    prompt: { version: 2, nodes: [], document: { type: "doc" } },
    answer: { kind: "student_response", accepted: [], canonical: "" },
    rationale: { version: 2, nodes: [], document: { type: "doc" } },
    metadata: { sectionKey: "math", domain: null, skill: null, difficulty: "medium", tags: [] },
    accessibility: undefined,
  } as unknown as QuestionRevision;
}

describe("the server document projection", () => {
  it("normalizes the revision and names the question it belongs to", () => {
    const server = serverQuestionDocument({
      question: revision(4),
      examQuestionId: "eq-1",
    });

    expect(server.revision?.revision).toBe(4);
    expect(server.examQuestionId).toBe("eq-1");
  });

  it("has no document before the query answers", () => {
    expect(serverQuestionDocument(undefined)).toEqual({
      revision: null,
      examQuestionId: null,
    });
  });
});

describe("the draft document", () => {
  it("installs an author's edit and clears only through the named action", () => {
    const { result } = renderHook(() => useAuthoringDraft());

    act(() => result.current.setDraft(revision(2)));
    expect(result.current.draft?.revision).toBe(2);
    expect(result.current.draftRef.current?.revision).toBe(2);
    expect(result.current.draftRevisionRef.current).toBe(2);

    act(() => result.current.clearDocument());
    expect(result.current.draft).toBeNull();
    expect(result.current.draftRef.current).toBeNull();
    expect(result.current.draftRevisionRef.current).toBeNull();
  });
});

describe("may the server document replace local work", () => {
  it("installs the revision when nothing forbids it", () => {
    const { result } = renderHook(() => useAuthoringDraft());

    let installed = false;
    act(() => {
      installed = result.current.adoptServerDocumentIfPermitted({
        server: serverQuestionDocument({ question: revision(5), examQuestionId: "eq-1" }),
        selectedExamQuestionId: "eq-1",
        draftKey: "device-key",
      });
    });

    expect(installed).toBe(true);
    expect(result.current.draft?.revision).toBe(5);
  });

  it("refuses a revision that belongs to another question", () => {
    const { result } = renderHook(() => useAuthoringDraft());

    let installed = true;
    act(() => {
      installed = result.current.adoptServerDocumentIfPermitted({
        server: serverQuestionDocument({ question: revision(5), examQuestionId: "eq-2" }),
        selectedExamQuestionId: "eq-1",
        draftKey: "device-key",
      });
    });

    expect(installed).toBe(false);
    expect(result.current.draft).toBeNull();
  });

  it("refuses to replace the recovered device draft the author was offered", () => {
    const { result } = renderHook(() => useAuthoringDraft());
    act(() => {
      result.current.recoveredQuestionDraftKeyRef.current = "device-key";
    });

    let installed = true;
    act(() => {
      installed = result.current.adoptServerDocumentIfPermitted({
        server: serverQuestionDocument({ question: revision(5), examQuestionId: "eq-1" }),
        selectedExamQuestionId: "eq-1",
        draftKey: "device-key",
      });
    });

    expect(installed).toBe(false);
    expect(result.current.draft).toBeNull();
  });

  it("refuses while unsaved local work is protected", () => {
    const { result } = renderHook(() => useAuthoringDraft());
    act(() => {
      result.current.draftProtectedRef.current = true;
      result.current.setDraft(revision(2));
    });

    let installed = true;
    act(() => {
      installed = result.current.adoptServerDocumentIfPermitted({
        server: serverQuestionDocument({ question: revision(5), examQuestionId: "eq-1" }),
        selectedExamQuestionId: "eq-1",
        draftKey: "device-key",
      });
    });

    expect(installed).toBe(false);
    expect(result.current.draft?.revision).toBe(2);
  });
});
