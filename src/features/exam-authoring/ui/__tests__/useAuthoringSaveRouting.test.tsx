import { act, renderHook, waitFor } from "@testing-library/react";
import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { assessmentAuthoringApi } from "../../api/assessmentAuthoringApi";
import type { QuestionRevision } from "../../contracts/assessment";
import { useQuestionAutosave } from "../../hooks/useQuestionAutosave";
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
    (props: { selectedExamQuestionId: string; workspaceRoomActive?: boolean }) =>
      useAuthoringSaveRouting({
        examId: "exam-1",
        queryClient,
        selectedExamQuestionId: props.selectedExamQuestionId,
        questionDraftKey: `draft:${props.selectedExamQuestionId}`,
        workspaceRoomActive: props.workspaceRoomActive ?? false,
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
      initialProps: { selectedExamQuestionId } as { selectedExamQuestionId: string; workspaceRoomActive?: boolean },
      wrapper: ({ children }) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      ),
    },
  );
}

function renderLiveDraft(first: QuestionRevision) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderHook(() => {
    const [draft, setDraft] = useState<QuestionRevision | null>(first);
    const [refs] = useState(() => ({
      baseline: { current: null as QuestionRevision | null }, frozen: { current: false }, deleted: { current: false },
      dispatch: { current: vi.fn() }, recovered: { current: null as string | null },
    }));
    const routing = useAuthoringSaveRouting({
      examId: "exam-1", queryClient, selectedExamQuestionId: "eq-1", questionDraftKey: "draft:eq-1",
      workspaceRoomActive: false, promptRoomActive: false, promptFreeBaselineRef: refs.baseline,
      mutationFrozenRef: refs.frozen, deletedRemotelyRef: refs.deleted, divergenceDispatchRef: refs.dispatch,
      recoveredQuestionDraftKeyRef: refs.recovered, setDraft, updateSummaryCache: vi.fn(),
    });
    const autosave = useQuestionAutosave({ save: routing.saveDraft, debounceMs: 0 });
    return { draft, setDraft, routing, autosave };
  });
}

describe("authoring save routing writeback", () => {
  it("keeps a newer edit when an earlier save is acknowledged and advances the next write's revision", async () => {
    const first = { ...revision("rev-1", "question-1"), metadata: { sectionKey: "math", domain: null, skill: null, difficulty: "medium", tags: ["first"] } } as QuestionRevision;
    const newer = { ...first, metadata: { ...first.metadata, tags: ["newer"] } };
    const saved = { ...first, revision: 2 };
    let finish: (value: QuestionRevision) => void = () => {};
    const write = vi.spyOn(assessmentAuthoringApi, "saveQuestionRevision")
      .mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }))
      .mockResolvedValueOnce({ ...newer, revision: 3 })
      .mockResolvedValueOnce({ ...first, revision: 4 });
    const { result } = renderLiveDraft(first);

    let pending!: Promise<unknown>;
    act(() => { pending = result.current.routing.saveDraft(first); });
    act(() => { result.current.setDraft(newer); });
    await act(async () => { finish(saved); await pending; });
    expect(result.current.draft?.metadata.tags).toEqual(["newer"]);
    expect(result.current.draft?.revision).toBe(2);
    await act(async () => { await result.current.routing.saveDraft(newer); });
    expect(write).toHaveBeenLastCalledWith("rev-1", expect.objectContaining({ revision: 2, metadata: newer.metadata }));
    // A queued undo can still carry revision 1 after two acknowledgements.
    await act(async () => { await result.current.routing.saveDraft(first); });
    expect(write).toHaveBeenLastCalledWith("rev-1", expect.objectContaining({ revision: 3, metadata: first.metadata }));
  });

  it("preserves the newer edit and blocks a write when the acknowledgement also changed that field", async () => {
    const first = { ...revision("rev-1", "question-1"), metadata: { sectionKey: "math", domain: null, skill: null, difficulty: "medium", tags: ["first"] } } as QuestionRevision;
    const newer = { ...first, metadata: { ...first.metadata, tags: ["newer"] } };
    const saved = { ...first, revision: 2, metadata: { ...first.metadata, tags: ["server"] } };
    let finish: (value: QuestionRevision) => void = () => {};
    const write = vi.spyOn(assessmentAuthoringApi, "saveQuestionRevision")
      .mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const { result } = renderLiveDraft(first);
    let pending!: Promise<unknown>;
    act(() => { pending = result.current.routing.saveDraft(first); });
    act(() => { result.current.setDraft(newer); });
    await act(async () => { finish(saved); await pending; });
    expect(result.current.draft?.metadata.tags).toEqual(["newer"]);
    await expect(result.current.routing.saveDraft(newer)).rejects.toMatchObject({ status: 409 });
    expect(write).toHaveBeenCalledTimes(1);
  });

  it("drains a newer queued autosave after the first write without losing it or sending a stale revision", async () => {
    const first = { ...revision("rev-1", "question-1"), metadata: { sectionKey: "math", domain: null, skill: null, difficulty: "medium", tags: ["first"] } } as QuestionRevision;
    const newer = { ...first, metadata: { ...first.metadata, tags: ["newer"] } };
    let finish: (value: QuestionRevision) => void = () => {};
    const write = vi.spyOn(assessmentAuthoringApi, "saveQuestionRevision")
      .mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }))
      .mockResolvedValueOnce({ ...newer, revision: 3 });
    const { result } = renderLiveDraft(first);
    act(() => { result.current.autosave.scheduleAutosave(first); });
    await waitFor(() => expect(write).toHaveBeenCalledTimes(1));
    act(() => {
      result.current.setDraft(newer);
      result.current.autosave.scheduleAutosave(newer);
    });
    await act(async () => { finish({ ...first, revision: 2 }); });
    await waitFor(() => expect(write).toHaveBeenCalledTimes(2));
    expect(write).toHaveBeenLastCalledWith("rev-1", expect.objectContaining({ revision: 2, metadata: newer.metadata }));
    await waitFor(() => expect(result.current.autosave.status).toBe("saved"));
    expect(result.current.draft?.metadata.tags).toEqual(["newer"]);
  });

  it("does not apply an old acknowledgement after leaving and reopening the same question", async () => {
    const setDraft = vi.fn();
    const submitted = revision("rev-1", "question-1");
    let finish: (value: QuestionRevision) => void = () => {};
    vi.spyOn(assessmentAuthoringApi, "saveQuestionRevision")
      .mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const { result, rerender } = renderRouting("eq-1", setDraft);
    let pending!: Promise<unknown>;
    act(() => { pending = result.current.saveDraft(submitted); });
    rerender({ selectedExamQuestionId: "eq-2" });
    rerender({ selectedExamQuestionId: "eq-1" });
    await act(async () => { finish({ ...submitted, revision: 2 }); await pending; });
    expect(setDraft).not.toHaveBeenCalled();
  });

  it("does not install an HTTP acknowledgement after the collaboration room takes ownership", async () => {
    const setDraft = vi.fn();
    const submitted = revision("rev-1", "question-1");
    let finish: (value: QuestionRevision) => void = () => {};
    vi.spyOn(assessmentAuthoringApi, "saveQuestionRevision")
      .mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const { result, rerender } = renderRouting("eq-1", setDraft);
    let pending!: Promise<unknown>;
    act(() => { pending = result.current.saveDraft(submitted); });
    rerender({ selectedExamQuestionId: "eq-1", workspaceRoomActive: true });
    await act(async () => { finish({ ...submitted, revision: 2 }); await pending; });
    expect(setDraft).not.toHaveBeenCalled();
  });

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
    const submitted = revision("math-rev-1", "math-base");
    const saved = { ...submitted, revision: 2 };
    vi.spyOn(assessmentAuthoringApi, "saveQuestionRevision").mockResolvedValue(saved as never);

    const { result } = renderRouting("eq-math", setDraft);
    await act(async () => {
      await result.current.saveDraft(submitted);
    });

    expect(setDraft).toHaveBeenCalledWith(expect.any(Function));
    expect(setDraft.mock.calls[0]?.[0](submitted)).toEqual(saved);
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
      submitted: expect.objectContaining({ id: "math-rev-1" }),
    });
  });
});
