import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { assessmentAuthoringApi } from "../../api/assessmentAuthoringApi";
import type { QuestionRevision } from "../../contracts/assessment";
import { useAuthoringSaveRouting } from "../useAuthoringSaveRouting";

// A spy on the shared client, not a module mock. Replacing the module with
// `vi.mock` here replaced it for the whole worker, and broke an unrelated suite
// that exercises the same client (`authoringShellLifecycle`), so the real
// implementation must stay installed for every other file.
afterEach(() => {
  vi.restoreAllMocks();
});

function revision(id: string, questionId: string): QuestionRevision {
  return {
    id,
    questionId,
    semanticRevision: 1,
    revision: 1,
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

function renderRouting(selectedExamQuestionId: string, setDraft: (value: unknown) => void) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderHook(
    (props: { selectedExamQuestionId: string }) =>
      useAuthoringSaveRouting({
        examId: "exam-1",
        queryClient,
        selectedExamQuestionId: props.selectedExamQuestionId,
        questionDraftKey: `draft:${props.selectedExamQuestionId}`,
        workspaceRoomActive: false,
        promptRoomActive: false,
        promptFreeBaselineRef: { current: null },
        mutationFrozenRef: { current: false },
        deletedRemotelyRef: { current: false },
        divergenceDispatchRef: { current: vi.fn() },
        recoveredQuestionDraftKeyRef: { current: null },
        setDraft: setDraft as never,
        updateSummaryCache: vi.fn(),
      }),
    {
      initialProps: { selectedExamQuestionId },
      wrapper: ({ children }) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      ),
    },
  );
}

describe("authoring save routing writeback", () => {
  it("does not install a save that resolves after the author moved to another question", async () => {
    // The leak: the editor renders the open draft and takes its header from the
    // selected module, so a late writeback put the previous question's prompt,
    // answer and "Saved" status inside the question the author had just opened.
    const setDraft = vi.fn();
    const saved = revision("math-rev-2", "math-base");
    let release: (() => void) | null = null;
    const write = vi
      .spyOn(assessmentAuthoringApi, "saveQuestionRevision")
      .mockImplementation(
        () => new Promise((resolve) => { release = () => resolve(saved); }) as never,
      );

    const { rerender, result } = renderRouting("eq-math", setDraft);
    let pending: Promise<unknown> | null = null;
    act(() => {
      pending = result.current.saveDraft(revision("math-rev-1", "math-base"));
    });

    // The author navigates while the write is still in flight.
    rerender({ selectedExamQuestionId: "eq-rw" });

    await act(async () => {
      release?.();
      await pending;
    });

    expect(write).toHaveBeenCalledTimes(1);
    expect(setDraft).not.toHaveBeenCalled();
  });

  it("installs a save that resolves while the author is still there", async () => {
    const setDraft = vi.fn();
    const saved = revision("math-rev-2", "math-base");
    vi.spyOn(assessmentAuthoringApi, "saveQuestionRevision").mockResolvedValue(saved as never);

    const { result } = renderRouting("eq-math", setDraft);
    await act(async () => {
      await result.current.saveDraft(revision("math-rev-1", "math-base"));
    });

    expect(setDraft).toHaveBeenCalledWith(saved);
  });

  it("still acknowledges the question the write was actually for", async () => {
    const setDraft = vi.fn();
    const divergenceDispatch = vi.fn();
    const updateSummaryCache = vi.fn();
    const saved = revision("math-rev-2", "math-base");
    vi.spyOn(assessmentAuthoringApi, "saveQuestionRevision").mockResolvedValue(saved as never);

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() =>
      useAuthoringSaveRouting({
        examId: "exam-1",
        queryClient,
        selectedExamQuestionId: "eq-math",
        questionDraftKey: null,
        workspaceRoomActive: false,
        promptRoomActive: false,
        promptFreeBaselineRef: { current: null },
        mutationFrozenRef: { current: false },
        deletedRemotelyRef: { current: false },
        divergenceDispatchRef: { current: divergenceDispatch },
        recoveredQuestionDraftKeyRef: { current: null },
        setDraft: setDraft as never,
        updateSummaryCache,
      }),
      { wrapper: ({ children }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider> },
    );

    await act(async () => {
      await result.current.saveDraft(revision("math-rev-1", "math-base"));
    });

    await waitFor(() => expect(updateSummaryCache).toHaveBeenCalledWith("eq-math", saved));
    expect(divergenceDispatch).toHaveBeenCalledWith({
      type: "SERVER_ACK",
      examQuestionId: "eq-math",
      saved,
    });
  });
});
