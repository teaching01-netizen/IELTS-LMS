import { act, renderHook, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../../../shared/api-client/errors";
import type {
  AssessmentAuthoringShell,
  AssessmentAuthoringShellResult,
} from "../../contracts/assessment";
import { useEnsureDraftShell } from "../../api/assessmentQueries";
import { assessmentKeys } from "../../api/authoringQueryEffects";
import { useAuthoringShellLifecycle } from "../authoringShellLifecycle";

/**
 * The shell lifecycle, end to end through the REAL stack a user hits:
 * the real React Query client, the real application hook, the real API adapter,
 * and the real lifecycle mapper. Only the network boundary (the backend
 * gateway) is mocked, so nothing here can pass because a status helper was
 * stubbed to agree with the test.
 *
 * The regression this pins is the production bug: an exam with no editable
 * draft used to be a 404 error, which React Query reported as a failure and the
 * UI translated back into \"No editable draft\" by inspecting the status code.
 * Now it is a successful 200 lifecycle answer, so refresh shows the no-draft
 * state with no error and — the part that must never regress — no POST.
 */

const backendGet = vi.hoisted(() => vi.fn());
const backendPost = vi.hoisted(() => vi.fn());

function statusOf(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const candidate = error as { status?: unknown; statusCode?: unknown };
  return (candidate.status ?? candidate.statusCode) as number | undefined;
}

vi.mock("../../infrastructure/examAuthoringBackendGateway", () => ({
  backendGet,
  backendPost,
  backendPatch: vi.fn(),
  backendDelete: vi.fn(),
  isBackendNotFound: (error: unknown) => statusOf(error) === 404,
  hasBackendStatusCode: (error: unknown, status: number) => statusOf(error) === status,
}));

const SHELL: AssessmentAuthoringShell = {
  examId: "exam-1",
  providerKey: "sat",
  versionId: "draft-v1",
  versionRevision: 4,
  sections: [],
};

const NO_DRAFT: AssessmentAuthoringShellResult = { state: "NO_DRAFT", shell: null };

function createClient(): QueryClient {
  return new QueryClient({
    // retryDelay 0: the shell hook owns a retry PREDICATE (transient failures
    // retry, definitive ones do not), so the test does not need to wait out the
    // production backoff to observe the settled state.
    defaultOptions: {
      queries: { retry: false, retryDelay: 0 },
      mutations: { retry: false },
    },
  });
}

function createWrapper(queryClient: QueryClient) {
  return function QueryWrapper({ children }: PropsWithChildren) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe("authoring shell lifecycle integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    backendGet.mockResolvedValue(NO_DRAFT);
    backendPost.mockResolvedValue(SHELL);
  });

  it("refresh on a pre-draft exam stays a GET-only success", async () => {
    const queryClient = createClient();
    const { result } = renderHook(() => useAuthoringShellLifecycle("exam-1"), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.state.kind).toBe("no-draft"));
    expect(backendGet).toHaveBeenCalledTimes(1);
    expect(backendGet).toHaveBeenCalledWith("/v1/assessment-authoring/exams/exam-1/shell");
    // The whole point: refreshing never creates a draft.
    expect(backendPost).not.toHaveBeenCalled();
    // …and it is not an error state, so nothing logs, warns or renders a stack.
    expect(queryClient.getQueryState(assessmentKeys.shell("exam-1"))?.status).toBe("success");

    await act(async () => {
      await result.current.refetch();
    });
    expect(result.current.state.kind).toBe("no-draft");
    expect(backendGet).toHaveBeenCalledTimes(2);
    expect(backendPost).not.toHaveBeenCalled();
  });

  it("opening a draft is one explicit POST that lands READY in the shell cache", async () => {
    const queryClient = createClient();
    const lifecycle = renderHook(() => useAuthoringShellLifecycle("exam-1"), {
      wrapper: createWrapper(queryClient),
    });
    await waitFor(() => expect(lifecycle.result.current.state.kind).toBe("no-draft"));

    const ensure = renderHook(() => useEnsureDraftShell("exam-1"), {
      wrapper: createWrapper(queryClient),
    });
    await act(async () => {
      await ensure.result.current.mutateAsync();
    });

    expect(backendPost).toHaveBeenCalledTimes(1);
    expect(backendPost).toHaveBeenCalledWith("/v1/assessment-authoring/exams/exam-1/shell");
    // The same read key now answers READY: one cache shape, not two. The live
    // observer sees it without a refetch, so the workspace renders the moment
    // the open resolves.
    await waitFor(() =>
      expect(lifecycle.result.current.state).toEqual({ kind: "ready", shell: SHELL })
    );
    expect(queryClient.getQueryData(assessmentKeys.shell("exam-1"))).toEqual({
      state: "READY",
      shell: SHELL,
    });
    // A POST that succeeded must not have been paired with an implicit refetch.
    expect(backendGet).toHaveBeenCalledTimes(1);
  });

  it("distinguishes a missing exam from a missing draft", async () => {
    backendGet.mockRejectedValue(
      new ApiError({ code: "EXAM_NOT_FOUND", message: "Exam not found.", status: 404 })
    );
    const { result } = renderHook(() => useAuthoringShellLifecycle("exam-1"), {
      wrapper: createWrapper(createClient()),
    });
    await waitFor(() => expect(result.current.state.kind).toBe("exam-not-found"));
  });

  it("treats 403 as a definitive answer and does not retry it", async () => {
    backendGet.mockRejectedValue(new ApiError({ code: "FORBIDDEN", message: "nope", status: 403 }));
    const { result } = renderHook(() => useAuthoringShellLifecycle("exam-1"), {
      wrapper: createWrapper(createClient()),
    });
    await waitFor(() => expect(result.current.state.kind).toBe("forbidden"));
    expect(backendGet).toHaveBeenCalledTimes(1);
  });

  it("retries a transient failure and then reports it as an error", async () => {
    // 5xx is transient, so the read retries — unlike EXAM_NOT_FOUND/FORBIDDEN,
    // whose answer cannot change. The state is `error`, never a lifecycle state.
    backendGet.mockRejectedValue(new ApiError({ code: "INTERNAL", message: "boom", status: 500 }));
    const { result } = renderHook(() => useAuthoringShellLifecycle("exam-1"), {
      wrapper: createWrapper(createClient()),
    });
    await waitFor(() => expect(result.current.state.kind).toBe("error"));
    expect(backendGet.mock.calls.length).toBeGreaterThan(1);
    if (result.current.state.kind === "error") {
      expect(result.current.state.error.message).toBe("boom");
    }
  });

  it("never presents READY without a shell as a missing draft", async () => {
    // A proxy or a backend bug that drops the shell must not become an
    // \"Open draft\" offer for an exam that already has one.
    backendGet.mockResolvedValue({ state: "READY", shell: null } as AssessmentAuthoringShellResult);
    const { result } = renderHook(() => useAuthoringShellLifecycle("exam-1"), {
      wrapper: createWrapper(createClient()),
    });
    await waitFor(() => expect(result.current.state.kind).toBe("error"));
  });
});
