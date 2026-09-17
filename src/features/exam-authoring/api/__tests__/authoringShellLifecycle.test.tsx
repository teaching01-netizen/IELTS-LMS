import { act, renderHook, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../../../shared/api-client/errors";
import type { AssessmentAuthoringShell } from "../../contracts/assessment";
import {
  assessmentKeys,
  toEnsureDraftShellErrorInfo,
  useAuthoringShell,
  useEnsureDraftShell,
} from "../assessmentQueries";

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

function notFoundError(): ApiError {
  return new ApiError({ code: "NOT_FOUND", message: "no draft", status: 404 });
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

describe("Phase 04 shell lifecycle (GET for refresh, explicit open)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    backendGet.mockResolvedValue(makeShell());
    backendPost.mockResolvedValue(makeShell());
  });

  it("FT-01: mount + refetch emits GET only, zero POST", async () => {
    const queryClient = createClient();
    const { result } = renderHook(() => useAuthoringShell("exam-1"), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(backendGet).toHaveBeenCalledTimes(1);
    // The 404 is declared expected: an exam without an editable draft is a state
    // this read reports, not a load failure worth a console warning.
    expect(backendGet).toHaveBeenCalledWith("/v1/assessment-authoring/exams/exam-1/shell", {
      expectedStatuses: [404],
    });
    expect(backendPost).not.toHaveBeenCalled();

    // Window-focus-style refetch: still GET only, zero POST.
    await act(async () => {
      await result.current.refetch();
    });
    expect(backendGet).toHaveBeenCalledTimes(2);
    expect(backendPost).not.toHaveBeenCalled();
  });

  it("FT-02: single ensure per CTA click even under double-click (isPending guard)", async () => {
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
    // GET query reads (no new key family), so the workspace renders from cache.
    const shell = makeShell(4);
    await act(async () => {
      resolvePost(shell);
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(queryClient.getQueryData(assessmentKeys.shell("exam-1"))).toEqual(shell);
    expect(backendPost).toHaveBeenCalledTimes(1);
  });

  it("FT-03: observer never calls ensure (no POST from this hook file on GET 404)", async () => {
    backendGet.mockRejectedValueOnce(notFoundError());
    const queryClient = createClient();
    const { result } = renderHook(() => useAuthoringShell("exam-1"), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    // The query layer performs zero POSTs by itself: observers render the
    // no-draft state with no CTA and no ensure call (the workspace role gate
    // hides the button; covered in AuthoringWorkspaceNoDraft.test.tsx).
    expect(backendGet).toHaveBeenCalledTimes(1);
    expect(backendPost).not.toHaveBeenCalled();
  });

  it("FT-04a: 404 -> CTA -> POST -> render flow installs the shell in cache", async () => {
    backendGet.mockRejectedValueOnce(notFoundError());
    const opened = makeShell(5);
    backendPost.mockResolvedValueOnce(opened);
    const queryClient = createClient();

    const shellHook = renderHook(() => useAuthoringShell("exam-1"), {
      wrapper: createWrapper(queryClient),
    });
    await waitFor(() => expect(shellHook.result.current.isError).toBe(true));
    expect(backendPost).not.toHaveBeenCalled();

    const ensureHook = renderHook(() => useEnsureDraftShell("exam-1"), {
      wrapper: createWrapper(queryClient),
    });
    await act(async () => {
      await ensureHook.result.current.mutateAsync();
    });

    expect(backendPost).toHaveBeenCalledTimes(1);
    expect(backendPost).toHaveBeenCalledWith("/v1/assessment-authoring/exams/exam-1/shell");
    // Success installs the shell: a workspace mounted after the ensure reads
    // it from cache (the GET 404 is not retried by the mutation).
    expect(queryClient.getQueryData(assessmentKeys.shell("exam-1"))).toEqual(opened);
  });

  it("FT-04b: 409 -> recover path classifies without auto-loop", async () => {
    backendPost.mockRejectedValueOnce(conflictError());
    const queryClient = createClient();
    const { result } = renderHook(() => useEnsureDraftShell("exam-1"), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await expect(result.current.mutateAsync()).rejects.toMatchObject({ status: 409 });
    });
    // Exactly one POST: the mutation never retries a write by itself.
    expect(backendPost).toHaveBeenCalledTimes(1);
    expect(toEnsureDraftShellErrorInfo(result.current.error).kind).toBe("conflict");
    // Nothing installed on failure: the shell key stays empty, so the caller
    // keeps showing the no-draft CTA instead of looping.
    expect(queryClient.getQueryData(assessmentKeys.shell("exam-1"))).toBeUndefined();
  });

  it("maps ensure POST failures without hand-rolled status checks", () => {
    expect(
      toEnsureDraftShellErrorInfo(new ApiError({ code: "X", message: "m", status: 404 })).kind
    ).toBe("exam-missing");
    expect(
      toEnsureDraftShellErrorInfo(new ApiError({ code: "X", message: "m", status: 403 })).kind
    ).toBe("forbidden");
    expect(toEnsureDraftShellErrorInfo(conflictError()).kind).toBe("conflict");
    expect(toEnsureDraftShellErrorInfo(new Error("boom")).kind).toBe("unknown");
  });
});
