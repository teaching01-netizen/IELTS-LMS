import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { QuestionRevision } from "../../contracts/assessment";
import {
  serverQuestionDocument,
  useAuthoringDraft,
  type ServerAdoptionState,
} from "../useAuthoringDraft";

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

    let outcome: ServerAdoptionState = "no-document";
    act(() => {
      outcome = result.current.adoptServerDocumentIfPermitted({
        server: serverQuestionDocument({ question: revision(5), examQuestionId: "eq-1" }),
        selectedExamQuestionId: "eq-1",
        draftKey: "device-key",
      });
    });

    expect(outcome).toBe("adopted");
    expect(result.current.draft?.revision).toBe(5);
  });

  it("names the no-document state before the query answers", () => {
    const { result } = renderHook(() => useAuthoringDraft());

    let outcome: ServerAdoptionState = "adopted";
    act(() => {
      outcome = result.current.adoptServerDocumentIfPermitted({
        server: serverQuestionDocument(undefined),
        selectedExamQuestionId: "eq-1",
        draftKey: "device-key",
      });
    });

    expect(outcome).toBe("no-document");
    expect(result.current.draft).toBeNull();
  });

  it("refuses a revision that belongs to another question", () => {
    const { result } = renderHook(() => useAuthoringDraft());

    let outcome: ServerAdoptionState = "adopted";
    act(() => {
      outcome = result.current.adoptServerDocumentIfPermitted({
        server: serverQuestionDocument({ question: revision(5), examQuestionId: "eq-2" }),
        selectedExamQuestionId: "eq-1",
        draftKey: "device-key",
      });
    });

    expect(outcome).toBe("stale-selection");
    expect(result.current.draft).toBeNull();
  });

  it("refuses to replace the recovered device draft the author was offered", () => {
    const { result } = renderHook(() => useAuthoringDraft());
    act(() => {
      result.current.recoveredQuestionDraftKeyRef.current = "device-key";
    });

    let outcome: ServerAdoptionState = "adopted";
    act(() => {
      outcome = result.current.adoptServerDocumentIfPermitted({
        server: serverQuestionDocument({ question: revision(5), examQuestionId: "eq-1" }),
        selectedExamQuestionId: "eq-1",
        draftKey: "device-key",
      });
    });

    expect(outcome).toBe("recovered-local-copy");
    expect(result.current.draft).toBeNull();
  });

  it("stops blocking the server document once the recovered key is acknowledged", () => {
    // The held-recovery shape: a room owns the editor, so the recovered copy is
    // taken into custody by the recovery owner and the key is acknowledged. The
    // server question must then hydrate the base editor, or the author sees a
    // loading skeleton where the editor and the recovery banner should both be.
    const { result } = renderHook(() => useAuthoringDraft());
    act(() => {
      result.current.recoveredQuestionDraftKeyRef.current = "device-key";
    });
    act(() => {
      result.current.acknowledgeRecoveredDraftKey("device-key");
    });

    let outcome: ServerAdoptionState = "recovered-local-copy";
    act(() => {
      outcome = result.current.adoptServerDocumentIfPermitted({
        server: serverQuestionDocument({ question: revision(5), examQuestionId: "eq-1" }),
        selectedExamQuestionId: "eq-1",
        draftKey: "device-key",
      });
    });

    expect(outcome).toBe("adopted");
    expect(result.current.draft?.revision).toBe(5);
  });

  it("acknowledges only the key it was given", () => {
    const { result } = renderHook(() => useAuthoringDraft());
    act(() => {
      result.current.recoveredQuestionDraftKeyRef.current = "device-key";
      result.current.acknowledgeRecoveredDraftKey("other-key");
    });

    let outcome: ServerAdoptionState = "adopted";
    act(() => {
      outcome = result.current.adoptServerDocumentIfPermitted({
        server: serverQuestionDocument({ question: revision(5), examQuestionId: "eq-1" }),
        selectedExamQuestionId: "eq-1",
        draftKey: "device-key",
      });
    });

    expect(outcome).toBe("recovered-local-copy");
    expect(result.current.draft).toBeNull();
  });

  it("refuses while unsaved local work is protected", () => {
    const { result } = renderHook(() => useAuthoringDraft());
    act(() => {
      result.current.draftProtectedRef.current = true;
      result.current.setDraft(revision(2));
    });

    let outcome: ServerAdoptionState = "adopted";
    act(() => {
      outcome = result.current.adoptServerDocumentIfPermitted({
        server: serverQuestionDocument({ question: revision(5), examQuestionId: "eq-1" }),
        selectedExamQuestionId: "eq-1",
        draftKey: "device-key",
      });
    });

    expect(outcome).toBe("protected-local-copy");
    expect(result.current.draft?.revision).toBe(2);
  });

  it("does not let a protection flag with no local document block hydration", () => {
    // The stale-guard shape: the protection projection has not caught up with a
    // question move, so the flag reads protected while the document is already
    // gone. There is nothing left to protect, and blocking here would strand a
    // 200 the workspace can neither render nor explain.
    const { result } = renderHook(() => useAuthoringDraft());
    act(() => {
      result.current.draftProtectedRef.current = true;
    });

    let outcome: ServerAdoptionState = "protected-local-copy";
    act(() => {
      outcome = result.current.adoptServerDocumentIfPermitted({
        server: serverQuestionDocument({ question: revision(5), examQuestionId: "eq-1" }),
        selectedExamQuestionId: "eq-1",
        draftKey: "device-key",
      });
    });

    expect(outcome).toBe("adopted");
    expect(result.current.draft?.revision).toBe(5);
  });

  it("keeps protecting a dirty draft across an unrelated refetch", () => {
    const { result } = renderHook(() => useAuthoringDraft());
    act(() => {
      result.current.setDraft(revision(2));
      result.current.draftProtectedRef.current = true;
    });

    let outcome: ServerAdoptionState = "adopted";
    act(() => {
      outcome = result.current.adoptServerDocumentIfPermitted({
        server: serverQuestionDocument({ question: revision(9), examQuestionId: "eq-1" }),
        selectedExamQuestionId: "eq-1",
        draftKey: "device-key",
      });
    });

    expect(outcome).toBe("protected-local-copy");
    expect(result.current.draft?.revision).toBe(2);
  });
});
