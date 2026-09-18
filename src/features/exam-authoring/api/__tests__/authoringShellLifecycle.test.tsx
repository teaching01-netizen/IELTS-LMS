import { act, renderHook, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../../../shared/api-client/errors";
import type {
  AssessmentAuthoringShell,
  AssessmentAuthoringShellResult,
} from "../../contracts/assessment";
import { useAuthoringShell, useEnsureDraftShell } from "../assessmentQueries";
import { assessmentKeys, readyShellResult } from "../authoringQueryEffects";
import { toDraftOpenErrorInfo } from "../../application/authoringShellLifecycle";

const backendGet = vi.hoisted(() => vi.fn());
const backendPost = vi.hoisted(() => vi.fn());

function mockedStatusCode(error: unknown): unknown {
  if (typeof error !== "object" || error === null) return undefined;
  const candidate = error as { status?: unknown; statusCode?: unknown };
  return candidate.status ?? candidate.statusCode;
}

vi.mock("../../infrastructure/examAuthoringBackendGateway", () => ({
  backendGet,
  backendPost,
  isBackendNotFound: (error: unknown) => mockedStatusCode(error) === 404,
  hasBackendStatusCode: (error: unknown, status: number) => mockedStatusCode(error) === status,
}));

function makeShell(revision = 3): AssessmentAuthoringShell {
  return {
    examId: "exam-1",
    providerKey: "sat",
    versionId: "v-1",
    versionRevision: revision,
    sections: [],
  };
}

function ready(revision = 3): AssessmentAuthoringShellResult {
  return readyShellResult(makeShell(revision));
}

const NO_DRAFT: AssessmentAuthoringShellResult = { state: "NO_DRAFT", shell: null };

function examNotFound(): ApiError {
  return new ApiError({ code: "EXAM_NOT_FOUND", message: "Exam not found.", status: 404 });
}

function forbidden(): ApiError {
  return new ApiError({ code: "FORBIDDEN", message: "nope", status: 403 });
}

function conflictError(): ApiError {
  return new ApiError({ code: "VERSION_CONFLICT", message: "draft changed", status: 409 });
}

function createClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

function createWrapper(queryClient: QueryClient) {
  return function QueryWrapper({ children }: PropsWithChildren) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe("authoring shell read contract (GET for refresh, explicit open)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    backendGet.mockResolvedValue(ready());
    backendPost.mockResolvedValue(makeShell());
  });

  it("FT-01: mount + refetch emits GET only, zero POST", async () => {
    const queryClient = createClient();
    const { result } = renderHook(() => useAuthoringShell("exam-1"), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(backendGet).toHaveBeenCalledTimes(1);
    // No expectedStatuses escape hatch: NO_DRAFT is a 200 lifecycle answer, so
    // the read has no \"expected error\" to declare.
    expect(backendGet).toHaveBeenCalledWith("/v1/assessment-authoring/exams/exam-1/shell");
    expect(backendPost).not.toHaveBeenCalled();

    // Window-focus-style refetch: still GET only, zero POST.
    await act(async () => {
      await result.current.refetch();
    });
    expect(backendGet).toHaveBeenCalledTimes(2);
    expect(backendPost).not.toHaveBeenCalled();
  });

  it("FT-02: an exam with no editable draft is a success, not an error", async () => {
    backendGet.mockResolvedValueOnce(NO_DRAFT);
    const queryClient = createClient();
    const { result } = renderHook(() => useAuthoringShell("exam-1"), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // The regression this whole contract exists for: a pre-draft exam used to
    // arrive as a 404 ApiError, which React Query cached as a failure and the
    // console reported as an error. It is now the answer to a successful read.
    expect(result.current.isError).toBe(false);
    expect(result.current.data).toEqual(NO_DRAFT);
    expect(backendPost).not.toHaveBeenCalled();
  });

  it("FT-03: a missing exam is a real error and is not retried", async () => {
    backendGet.mockRejectedValueOnce(examNotFound());
    const queryClient = createClient();
    const { result } = renderHook(() => useAuthoringShell("exam-1"), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    // EXAM_NOT_FOUND is definitive: retrying re-asks a question whose answer
    // cannot change. This is a retry policy, not a lifecycle interpretation.
    expect(backendGet).toHaveBeenCalledTimes(1);
    expect(backendPost).not.toHaveBeenCalled();
  });

  it("FT-03b: 403 is definitive too, and the query layer never opens a draft", async () => {
    backendGet.mockRejectedValueOnce(forbidden());
    const queryClient = createClient();
    const { result } = renderHook(() => useAuthoringShell("exam-1"), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(backendGet).toHaveBeenCalledTimes(1);
    expect(backendPost).not.toHaveBeenCalled();
  });

  it("FT-04: a single ensure per CTA click even under double-click (isPending guard)", async () => {
    let resolvePost!: (value: AssessmentAuthoringShell) => void;
    backendPost.mockImplementationOnce(
      () => new Promise<AssessmentAuthoringShell>((resolve) => {
        resolvePost = resolve;
      })
    );
    const queryClient = createClient();
    const { result } = renderHook(() => useEnsureDraftShell("exam-1"), {
      wrapper: createWrapper(queryClient),
    });

    // Component-level single-flight guard (mirrors the workspace onAction):
    // the CTA disables while isPending, so a second click never reaches
    // mutate. Model two discrete clicks with a render between (as the DOM
    // delivers them), asserting the second is swallowed.
    const clickOpenDraft = () => {
      if (result.current.isPending) return;
      result.current.mutate();
    };
    act(() => {
      clickOpenDraft();
    });
    await waitFor(() => expect(result.current.isPending).toBe(true));
    expect(backendPost).toHaveBeenCalledTimes(1);
    act(() => {
      clickOpenDraft();
    });
    expect(backendPost).toHaveBeenCalledTimes(1);

    // …and prove the in-flight mutation resolves into the SAME shell key the
    // GET query reads, as a READY lifecycle envelope (one cache shape, not two).
    const shell = makeShell(4);
    await act(async () => {
      resolvePost(shell);
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(queryClient.getQueryData(assessmentKeys.shell("exam-1"))).toEqual(
      readyShellResult(shell)
    );
    expect(backendPost).toHaveBeenCalledTimes(1);
  });

  it("FT-05: NO_DRAFT -> CTA -> POST -> READY installs the shell in cache", async () => {
    backendGet.mockResolvedValueOnce(NO_DRAFT);
    const opened = makeShell(5);
    backendPost.mockResolvedValueOnce(opened);
    const queryClient = createClient();

    const shellHook = renderHook(() => useAuthoringShell("exam-1"), {
      wrapper: createWrapper(queryClient),
    });
    await waitFor(() => expect(shellHook.result.current.isSuccess).toBe(true));
    expect(backendPost).not.toHaveBeenCalled();

    const ensureHook = renderHook(() => useEnsureDraftShell("exam-1"), {
      wrapper: createWrapper(queryClient),
    });
    await act(async () => {
      await ensureHook.result.current.mutateAsync();
    });

    expect(backendPost).toHaveBeenCalledTimes(1);
    expect(backendPost).toHaveBeenCalledWith("/v1/assessment-authoring/exams/exam-1/shell");
    expect(queryClient.getQueryData(assessmentKeys.shell("exam-1"))).toEqual(
      readyShellResult(opened)
    );
  });

  it("FT-06: an open conflict classifies without auto-loop", async () => {
    backendPost.mockRejectedValueOnce(conflictError());
    const queryClient = createClient();
    const { result } = renderHook(() => useEnsureDraftShell("exam-1"), {
      wrapper: createWrapper(queryClient),
    });

    // Capture the rejection itself rather than racing the observer's error
    // state, then prove the same error object reaches the caller's error slot.
    let caught: unknown;
    await act(async () => {
      caught = await result.current.mutateAsync().catch((error: unknown) => error);
    });
    expect(caught).toMatchObject({ status: 409 });
    // Exactly one POST: the mutation never retries a write by itself.
    expect(backendPost).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(result.current.error).toBe(caught));
    expect(toDraftOpenErrorInfo(result.current.error).kind).toBe("conflict");
    // Nothing installed on failure: the shell key keeps whatever the read said,
    // so the caller keeps showing the no-draft CTA instead of looping.
    expect(queryClient.getQueryData(assessmentKeys.shell("exam-1"))).toBeUndefined();
  });

  it("maps open failures without hand-rolled status checks", () => {
    expect(
      toDraftOpenErrorInfo(new ApiError({ code: "EXAM_NOT_FOUND", message: "m", status: 404 })).kind
    ).toBe("exam-missing");
    expect(
      toDraftOpenErrorInfo(new ApiError({ code: "FORBIDDEN", message: "m", status: 403 })).kind
    ).toBe("forbidden");
    expect(toDraftOpenErrorInfo(conflictError()).kind).toBe("conflict");
    expect(toDraftOpenErrorInfo(new Error("boom")).kind).toBe("unknown");
  });
});
