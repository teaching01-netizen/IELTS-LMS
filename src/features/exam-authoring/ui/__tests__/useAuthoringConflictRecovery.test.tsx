import { act, renderHook, waitFor } from "@testing-library/react";
import type { MutableRefObject } from "react";
import { QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { assessmentAuthoringApi } from "../../api/assessmentAuthoringApi";
import type { useExamQuestion } from "../../api/assessmentQueries";
import type { QuestionRevision } from "../../contracts/assessment";
import {
  useAuthoringConflictRecovery,
  useAuthoringDeviceDraftRecovery,
} from "../useAuthoringConflictRecovery";

/**
 * The inverted recovery edge, and the conflict/recovery surface's policy.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Two invariants here are invisible in review and expensive if broken:
 *
 *   1. persistence may only HOLD a recovered device draft — never adopt it —
 *      when a room owns the editor, and the answer has to be given while
 *      persistence is being constructed. That is the dependency that was
 *      inverted to break the cycle, so it is pinned here;
 *   2. the three-way compare renders only when the capability is granted AND
 *      base, local and remote are all present. A partial compare would show a
 *      two-way diff as if it were a conflict.
 */

afterEach(() => {
  vi.restoreAllMocks();
});

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
    accessibility: { longDescription: null },
  } as unknown as QuestionRevision;
}

describe("device-draft recovery holder", () => {
  it("holds a recovered draft and reports that it took over presenting it", () => {
    const { result } = renderHook(
      (props: { selectedExamQuestionId: string | null }) =>
        useAuthoringDeviceDraftRecovery({
          roomOwnsEditor: true,
          selectedExamQuestionId: props.selectedExamQuestionId,
        }),
      { initialProps: { selectedExamQuestionId: "eq-1" as string | null } }
    );

    let held = false;
    act(() => {
      held = result.current.hold("eq-1", revision(4));
    });

    expect(held).toBe(true);
    expect(result.current.recovery?.questionId).toBe("eq-1");
    expect(result.current.recovery?.draft).toEqual(revision(4));
  });

  it("refuses to hold when no room owns the editor, so the caller adopts it", () => {
    const { result } = renderHook(() =>
      useAuthoringDeviceDraftRecovery({ roomOwnsEditor: false, selectedExamQuestionId: "eq-1" })
    );

    let held = true;
    act(() => {
      held = result.current.hold("eq-1", revision(4));
    });

    expect(held).toBe(false);
    expect(result.current.recovery).toBeNull();
  });

  it("drops a held draft when the selection moves to another question", () => {
    const { result, rerender } = renderHook(
      (props: { selectedExamQuestionId: string | null }) =>
        useAuthoringDeviceDraftRecovery({
          roomOwnsEditor: true,
          selectedExamQuestionId: props.selectedExamQuestionId,
        }),
      { initialProps: { selectedExamQuestionId: "eq-1" as string | null } }
    );
    act(() => {
      result.current.hold("eq-1", revision(4));
    });
    expect(result.current.recovery).not.toBeNull();

    rerender({ selectedExamQuestionId: "eq-2" });

    expect(result.current.recovery).toBeNull();
  });

  it("clears on request once the author has decided", () => {
    const { result } = renderHook(() =>
      useAuthoringDeviceDraftRecovery({ roomOwnsEditor: true, selectedExamQuestionId: "eq-1" })
    );
    act(() => {
      result.current.hold("eq-1", revision(4));
    });

    act(() => {
      result.current.clear();
    });

    expect(result.current.recovery).toBeNull();
  });
});

interface Harness {
  /** Open Review once the controller has mounted (the state is the hook's own). */
  conflictOpen: boolean;
  divergence: unknown;
  diverged: boolean;
  draft: QuestionRevision | null;
  conflictCompareEnabled: boolean;
  coeditDisplayStatus: string | null;
  refetch: ReturnType<typeof vi.fn>;
  saveStatus: "idle" | "saving" | "saved" | "error" | "conflict";
  draftRevision: number | null;
}

function renderController(overrides: Partial<Harness> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const setDraft = vi.fn();
  const acknowledgeServerRevision = vi.fn();
  const retrySave = vi.fn();
  const setNotice = vi.fn();
  const dispatchDivergence = vi.fn();
  const roomRetry = vi.fn();
  const coeditRetry = vi.fn();
  const promptFreeBaselineRef = { current: null } as MutableRefObject<QuestionRevision | null>;
  const state: Harness = {
    conflictOpen: false,
    divergence: null,
    diverged: false,
    draft: null,
    conflictCompareEnabled: false,
    coeditDisplayStatus: null,
    refetch: vi.fn(async () => ({ data: undefined })),
    saveStatus: "idle",
    draftRevision: null,
    ...overrides,
  };
  const draftRevisionRef = { current: state.draftRevision } as MutableRefObject<number | null>;
  const pendingChangesRef = { current: false } as MutableRefObject<boolean>;
  const openerRef = { current: null } as MutableRefObject<HTMLElement | null>;

  const hook = renderHook(() =>
    useAuthoringConflictRecovery({
      examId: "exam-1",
      queryClient,
      selectedExamQuestionId: "eq-1",
      selectedModuleTitle: "Module 1",
      divergence: state.divergence as never,
      diverged: state.diverged,
      baseQuestion: revision(1),
      dispatchDivergence,
      draft: state.draft,
      setDraft,
      promptFreeBaselineRef,
      questionQuery: { refetch: state.refetch, data: undefined } as unknown as ReturnType<
        typeof useExamQuestion
      >,
      acknowledgeServerRevision,
      retrySave,
      conflictCompareEnabled: state.conflictCompareEnabled,
      publishedFrozen: false,
      coeditRoomOpen: true,
      coeditUiActive: false,
      coeditDisplayStatus: state.coeditDisplayStatus as never,
      coedit: { retry: coeditRetry, error: null } as never,
      coeditRecovery: null,
      workspaceCollaboration: { retry: roomRetry } as never,
      deviceRecovery: {
        recovery: null,
        hold: () => true,
        clear: vi.fn(),
      },
      setNotice,
      fence: { saveStatus: state.saveStatus, draftRevisionRef, pendingChangesRef, openerRef },
    })
  );

  if (state.conflictOpen) {
    act(() => hook.result.current.setConflictOpen(true));
  }

  return {
    ...hook,
    state,
    setDraft,
    draftRevisionRef,
    pendingChangesRef,
    acknowledgeServerRevision,
    retrySave,
    setNotice,
    dispatchDivergence,
    roomRetry,
    coeditRetry,
    promptFreeBaselineRef,
  };
}

describe("conflict and recovery surface", () => {
  it("reads the remote document only while Review is open", async () => {
    const getQuestion = vi
      .spyOn(assessmentAuthoringApi, "getQuestion")
      .mockResolvedValue({ question: revision(5) } as never);
    const closed = renderController({ conflictOpen: false });

    await waitFor(() => expect(closed.result.current.baseDocument).not.toBeNull());
    expect(getQuestion).not.toHaveBeenCalled();
    closed.unmount();

    const open = renderController({ conflictOpen: true });
    await waitFor(() => expect(getQuestion).toHaveBeenCalledWith("eq-1"));
    expect(open.dispatchDivergence).toHaveBeenCalledWith(
      expect.objectContaining({ type: "REMOTE_DOCUMENT", examQuestionId: "eq-1" })
    );
  });

  it("turns a fenced write into the same divergence state Review shows", async () => {
    const getQuestion = vi
      .spyOn(assessmentAuthoringApi, "getQuestion")
      .mockResolvedValue({ question: revision(5) } as never);
    const h = renderController({ saveStatus: "conflict", draftRevision: 4 });

    await waitFor(() => expect(getQuestion).toHaveBeenCalledWith("eq-1"));
    expect(h.dispatchDivergence).toHaveBeenCalledWith(
      expect.objectContaining({ type: "REMOTE_REVISION", examQuestionId: "eq-1", remoteRevision: 5 })
    );
    await waitFor(() => expect(h.result.current.conflictOpen).toBe(true));
  });

  it("keeps a fence that is not a newer revision on its own explanation", async () => {
    // 409 also covers draft_replaced / draft_not_editable: only a genuinely
    // newer revision is a divergence.
    vi.spyOn(assessmentAuthoringApi, "getQuestion").mockResolvedValue({
      question: revision(4),
    } as never);
    const h = renderController({ saveStatus: "conflict", draftRevision: 4 });

    await waitFor(() => expect(h.result.current.baseDocument).not.toBeNull());
    expect(h.dispatchDivergence).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "REMOTE_REVISION" })
    );
  });

  it("mirrors the divergence base into the prompt-free baseline seam", async () => {
    const h = renderController({ divergence: { baseDocument: revision(3) } });

    await waitFor(() => expect(h.promptFreeBaselineRef.current).toEqual(revision(3)));
  });

  it("never renders a partial compare", async () => {
    // Capability granted, but the remote side never arrived: no classifications.
    const h = renderController({
      conflictOpen: true,
      conflictCompareEnabled: true,
      draft: revision(2),
    });
    await waitFor(() => expect(h.result.current.baseDocument).not.toBeNull());

    expect(h.result.current.classifications).toEqual([]);
  });

  it("names the other author in the deleted-remotely notice", async () => {
    const h = renderController({
      diverged: true,
      divergence: {
        deletedRemotely: true,
        remoteAuthor: { displayName: "Dana" },
      },
    });

    await waitFor(() => expect(h.result.current.activeRaceNotice).toContain("Dana"));
    expect(h.result.current.showLegacyDivergenceSurface).toBe(true);
  });

  it("routes retry to whichever writer actually failed", async () => {
    const room = renderController({ coeditDisplayStatus: "error" });
    act(() => room.result.current.handleRetrySave());
    expect(room.roomRetry).toHaveBeenCalledTimes(1);
    expect(room.retrySave).not.toHaveBeenCalled();

    const http = renderController({
      coeditUiActive: false,
      coeditDisplayStatus: null,
      draft: revision(2),
    });
    act(() => http.result.current.handleRetrySave());
    expect(http.retrySave).toHaveBeenCalledWith(revision(2));
  });

  it("installs the latest revision only after the authoritative read is in hand", async () => {
    const latest = revision(7);
    const refetch = vi.fn(async () => ({ data: { question: latest } }));
    const h = renderController({ refetch });

    await act(async () => {
      await h.result.current.handleUseLatest(revision(6));
    });

    expect(h.setDraft).toHaveBeenCalledWith(expect.objectContaining({ revision: 7 }));
    expect(h.dispatchDivergence).toHaveBeenCalledWith(
      expect.objectContaining({ type: "RESOLVE_USE_LATEST", remote: latest })
    );
    // The fenced save state and the sheet clear with the resolution.
    expect(h.acknowledgeServerRevision).toHaveBeenCalledTimes(1);
    // The resolution closes the sheet it was opened from.
    expect(h.result.current.conflictOpen).toBe(false);
    expect(h.result.current.noticeDismissed).toBe(false);
  });

  it("treats a fresh divergence as a fresh notice", () => {
    const h = renderController({ divergence: { remoteRevision: 5 } });

    act(() => h.result.current.setNoticeDismissed(true));
    expect(h.result.current.noticeDismissed).toBe(true);

    // A collaborator's newer revision re-arms the banner the author dismissed.
    h.state.divergence = { remoteRevision: 6 };
    h.rerender();

    expect(h.result.current.noticeDismissed).toBe(false);
  });

  it("reports a copy failure on the one notice channel instead of throwing", async () => {
    const writeText = vi.fn(async () => {
      throw new Error("denied");
    });
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const h = renderController({ draft: revision(2) });

    await act(async () => {
      await h.result.current.copyMyWork();
    });

    expect(h.setNotice).toHaveBeenCalledWith(expect.stringContaining("Copy failed"));
  });
});
