import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { QuestionRevision } from "../../contracts/assessment";
import { SAVE_CONFLICT_COPY } from "../../realtime/connectionCopy";
import { useAuthoringEdits, type AuthoringEditsInput } from "../useAuthoringEdits";

/**
 * The edit pipeline's routing precedence, with no network and no store.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * "Which writer owns one keystroke?" is decided here, and the modes are not
 * interchangeable: a whole-question autosave beside the exam room is a second
 * writer racing the CRDT, and a whole-question save beside the prompt room is
 * refused with COEDIT_ACTIVE. Every branch below is one of those mistakes.
 */

function revision(revisionNumber: number, prompt = "original"): QuestionRevision {
  return {
    id: `rev-${revisionNumber}`,
    questionId: "q-1",
    semanticRevision: revisionNumber,
    revision: revisionNumber,
    state: "draft",
    questionType: "single_choice",
    stimulus: { version: 2, nodes: [], document: { type: "doc" } },
    prompt: { version: 2, nodes: [], document: { type: "doc" }, prompt },
    answer: { kind: "student_response", accepted: [], canonical: "" },
    rationale: { version: 2, nodes: [], document: { type: "doc" } },
    metadata: { sectionKey: "math", domain: null, skill: null, difficulty: "medium", tags: [] },
    accessibility: undefined,
  } as unknown as QuestionRevision;
}

function renderEdits(overrides: Partial<AuthoringEditsInput> = {}) {
  const setDraft = vi.fn();
  const withdrawWorkbookUndo = vi.fn();
  const scheduleAutosave = vi.fn();
  const publishWorkspaceScalar = vi.fn(() => true);
  const openReview = vi.fn();
  const setNotice = vi.fn();
  const retry = vi.fn();
  const flushNow = vi.fn(async () => ({ ok: true }));

  const input: AuthoringEditsInput = {
    writers: {
      mode: "http",
      publishWorkspaceScalar,
      scheduleAutosave,
      promptFreeBaselineRef: { current: null },
    },
    editing: { setDraft, withdrawWorkbookUndo },
    save: { workspaceCollaboration: null, coeditDisplayStatus: null, flushNow },
    draft: revision(2),
    conflicted: false,
    openReview,
    setNotice,
    ...overrides,
  };

  const hook = renderHook(() => useAuthoringEdits(input));

  return {
    ...hook,
    setDraft,
    withdrawWorkbookUndo,
    scheduleAutosave,
    publishWorkspaceScalar,
    openReview,
    setNotice,
    retry,
    flushNow,
  };
}

describe("an edit reaches exactly one writer", () => {
  it("withdraws the import rewind and installs the draft for every mode", () => {
    const h = renderEdits();

    act(() => h.result.current.handleChange(revision(3)));

    expect(h.withdrawWorkbookUndo).toHaveBeenCalledTimes(1);
    expect(h.setDraft).toHaveBeenCalledTimes(1);
    expect(h.scheduleAutosave).toHaveBeenCalledTimes(1);
  });

  it("never queues a whole-question save beside the exam room", () => {
    const publishWorkspaceScalar = vi.fn(() => true);
    const scheduleAutosave = vi.fn();
    const h = renderEdits({
      writers: {
        mode: "workspace-room",
        publishWorkspaceScalar,
        scheduleAutosave,
        promptFreeBaselineRef: { current: null },
      },
    });

    act(() => h.result.current.handleChange(revision(3)));

    expect(publishWorkspaceScalar).toHaveBeenCalledTimes(1);
    expect(scheduleAutosave).not.toHaveBeenCalled();
  });

  it("still queues when the room did not take the edit", () => {
    const scheduleAutosave = vi.fn();
    const h = renderEdits({
      writers: {
        mode: "workspace-room",
        publishWorkspaceScalar: vi.fn(() => false),
        scheduleAutosave,
        promptFreeBaselineRef: { current: null },
      },
    });

    act(() => h.result.current.handleChange(revision(3)));

    expect(scheduleAutosave).toHaveBeenCalledTimes(1);
  });

  it("keeps a prompt-only change out of the legacy queue while a room owns the prompt", () => {
    const scheduleAutosave = vi.fn();
    const h = renderEdits({
      writers: {
        mode: "prompt-room",
        publishWorkspaceScalar: vi.fn(() => false),
        scheduleAutosave,
        // The prompt is the ONLY field that differs from the acknowledged base.
        promptFreeBaselineRef: { current: revision(2, "prompt") },
      },
    });

    act(() => h.result.current.handleChange(revision(2, "prompt edited")));

    expect(scheduleAutosave).not.toHaveBeenCalled();
  });

  it("queues a non-prompt change even while a room owns the prompt", () => {
    const scheduleAutosave = vi.fn();
    const baseline = revision(2, "same prompt");
    const edited = {
      ...revision(2, "same prompt"),
      metadata: { ...revision(2).metadata, difficulty: "hard" as const },
    };
    const h = renderEdits({
      writers: {
        mode: "prompt-room",
        publishWorkspaceScalar: vi.fn(() => false),
        scheduleAutosave,
        promptFreeBaselineRef: { current: baseline },
      },
    });

    act(() => h.result.current.handleChange(edited as QuestionRevision));

    expect(scheduleAutosave).toHaveBeenCalledWith(edited);
  });
});

describe("an explicit save answers the author", () => {
  it("does nothing when no question is open", async () => {
    const h = renderEdits({ draft: null });

    await act(async () => h.result.current.handleSaveNow());

    expect(h.flushNow).not.toHaveBeenCalled();
  });

  it("routes a manual save in the room through the room's own retry", async () => {
    const retry = vi.fn();
    const h = renderEdits({
      save: {
        workspaceCollaboration: { retry } as never,
        coeditDisplayStatus: "error",
        flushNow: vi.fn(async () => ({ ok: true })),
      },
    });

    await act(async () => h.result.current.handleSaveNow());

    expect(retry).toHaveBeenCalledTimes(1);
    expect(h.flushNow).not.toHaveBeenCalled();
  });

  it("opens Review instead of reporting a failure for a held-back write", async () => {
    const h = renderEdits({
      conflicted: true,
      save: {
        workspaceCollaboration: null,
        coeditDisplayStatus: null,
        flushNow: vi.fn(async () => ({ ok: false })),
      },
    });

    await act(async () => h.result.current.handleSaveNow());

    expect(h.openReview).toHaveBeenCalledTimes(1);
    // The save clears the previous notice, and must NOT add the failure copy:
    // the author is answering a decision, not reading an error.
    expect(h.setNotice).toHaveBeenCalledWith(null);
    expect(h.setNotice).not.toHaveBeenCalledWith(SAVE_CONFLICT_COPY.failed);
  });

  it("reports the one failure copy when the write simply failed", async () => {
    const h = renderEdits({
      save: {
        workspaceCollaboration: null,
        coeditDisplayStatus: null,
        flushNow: vi.fn(async () => ({ ok: false })),
      },
    });

    await act(async () => h.result.current.handleSaveNow());

    expect(h.setNotice).toHaveBeenCalledWith(SAVE_CONFLICT_COPY.failed);
    expect(h.openReview).not.toHaveBeenCalled();
  });
});
