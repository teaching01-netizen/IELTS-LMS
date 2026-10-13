import { act, renderHook, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PublishAssessmentRequest, PublishedAssessmentVersion } from "../../contracts/assessment";

const gateway = vi.hoisted(() => ({
  backendGet: vi.fn(),
  backendPost: vi.fn(),
  backendPatch: vi.fn(),
  backendDelete: vi.fn(),
}));

vi.mock("../../infrastructure/examAuthoringBackendGateway", () => ({
  ...gateway,
  isBackendNotFound: () => false,
  hasBackendStatusCode: () => false,
}));

import { useAssessmentReleaseState, usePublishAssessment } from "../assessmentQueries";
import { assessmentKeys } from "../authoringQueryEffects";
import type { AssessmentReleaseState } from "../../contracts/release";
import { publishedVersionToDeliveryTarget } from "../../ui/publish/useSatPublish";

const request: PublishAssessmentRequest = {
  revision: 8,
  expectedDraftVersionId: "draft-4",
  expectedDraftRevision: 12,
  publishScope: "math",
  operationKey: "publish-operation-1",
};

const publishedVersion: PublishedAssessmentVersion = {
  id: "published-9",
  examId: "exam-1",
  versionNumber: 9,
  revision: 12,
  isDraft: false,
  isPublished: true,
  publishScope: "math",
  publishNotes: null,
  createdAt: "2026-10-11T00:00:00.000Z",
};

const releaseState: AssessmentReleaseState = {
  examId: "exam-1",
  providerKey: "sat",
  state: "never_published",
  currentPublishedVersion: null,
  workingDraft: { id: "draft-4", parentVersionId: null, versionNumber: 9, revision: 12 },
  summary: { candidateDurationSeconds: 0, authoredQuestionCount: 0, deliveredQuestionCount: 0 },
  access: { totalLinks: 0, liveLinks: 0, upcomingLinks: 0, linksOnCurrentRelease: 0, liveLinksOnPreviousReleases: 0 },
};

function setup() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

beforeEach(() => vi.clearAllMocks());

describe("publish mutation acknowledgment", () => {
  it("accepts only a valid receipt for this exam and the requested scope", () => {
    expect(publishedVersionToDeliveryTarget(publishedVersion, "exam-1", "math")).toEqual({
      versionId: "published-9",
      versionNumber: 9,
      publishScope: "math",
    });
    expect(() => publishedVersionToDeliveryTarget(
      { ...publishedVersion, examId: "other-exam" },
      "exam-1",
      "math"
    )).toThrow(/could not be verified/i);
    expect(() => publishedVersionToDeliveryTarget(
      { ...publishedVersion, isPublished: false },
      "exam-1",
      "math"
    )).toThrow(/could not be verified/i);
    expect(() => publishedVersionToDeliveryTarget(
      undefined as unknown as PublishedAssessmentVersion,
      "exam-1",
      "math"
    )).toThrow(/could not be verified/i);
  });

  it("returns the committed POST version while an invalidated release read hangs", async () => {
    gateway.backendPost.mockResolvedValue(publishedVersion);
    let finishReleaseRefresh: ((value: AssessmentReleaseState) => void) | undefined;
    const backgroundReleaseRead = new Promise<AssessmentReleaseState>((resolve) => {
      finishReleaseRefresh = resolve;
    });
    gateway.backendGet
      .mockResolvedValueOnce(releaseState)
      .mockImplementationOnce(() => {
        return backgroundReleaseRead;
      });
    const { queryClient, wrapper } = setup();
    queryClient.setQueryData(assessmentKeys.shell("exam-1"), {
      state: "READY",
      shell: { examId: "exam-1", versionId: "draft-4", versionRevision: 12, sections: [] },
    });
    const { result } = renderHook(
      () => ({ mutation: usePublishAssessment("exam-1"), release: useAssessmentReleaseState("exam-1") }),
      { wrapper }
    );
    await waitFor(() => expect(result.current.release.isSuccess).toBe(true));

    let returned: PublishedAssessmentVersion | undefined;
    await act(async () => {
      returned = await result.current.mutation.mutateAsync(request);
    });
    await waitFor(() => expect(gateway.backendGet).toHaveBeenCalledTimes(2));

    expect(returned).toEqual(publishedVersion);
    expect(gateway.backendPost).toHaveBeenCalledTimes(1);
    expect(queryClient.getQueryData(assessmentKeys.shell("exam-1"))).toBeUndefined();
    await act(async () => finishReleaseRefresh?.(releaseState));
    queryClient.clear();
  });

  it("does not turn a successful publish into failure when the release refresh rejects", async () => {
    gateway.backendPost.mockResolvedValue(publishedVersion);
    gateway.backendGet.mockResolvedValueOnce(releaseState).mockRejectedValueOnce(new Error("release refresh failed"));
    const { queryClient, wrapper } = setup();
    const { result } = renderHook(
      () => ({ mutation: usePublishAssessment("exam-1"), release: useAssessmentReleaseState("exam-1") }),
      { wrapper }
    );
    await waitFor(() => expect(result.current.release.isSuccess).toBe(true));

    let returned: PublishedAssessmentVersion | undefined;
    await act(async () => {
      returned = await result.current.mutation.mutateAsync(request);
    });
    await waitFor(() => expect(result.current.release.isError).toBe(true));

    expect(returned).toEqual(publishedVersion);
    expect(gateway.backendPost).toHaveBeenCalledTimes(1);
    expect(gateway.backendGet).toHaveBeenCalledTimes(2);
    queryClient.clear();
  });
});
