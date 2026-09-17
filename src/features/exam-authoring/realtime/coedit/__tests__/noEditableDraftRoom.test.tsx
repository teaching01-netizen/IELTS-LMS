/**
 * The collaboration boundary × "this exam has no editable draft yet".
 *
 * An exam without a draft pointer has no room to open: the exam-level token
 * endpoint answers 404 and says why ("Only the current editable SAT draft can be
 * co-edited"). Every SAT page mounts this boundary, so asking anyway put a 404 —
 * and a warning about it — in the console of every author opening a pre-draft or
 * released exam, for a state the UI already renders by design.
 *
 * These tests pin the two halves of the fix: the request is not made when the
 * exam read says there is no draft, and a 404 that arrives anyway (the pointer
 * went stale, or the exam lost its draft between the read and the request) is
 * read as "no room" rather than as a collaboration failure.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ExamEntity } from "../../../../../types/domain";
import { examKeys } from "../../../api/examQueries";
import { SatAuthoringCollaborationBoundary } from "../SatAuthoringCollaborationBoundary";
import { useSatAuthoringCollaboration } from "../useSatAuthoringCollaboration";

const originalFetch = global.fetch;

function examFixture(currentDraftVersionId: string | null): ExamEntity {
  return {
    id: "exam-1",
    slug: "exam-1",
    title: "SAT Practice 1",
    type: "Academic",
    status: "draft",
    visibility: "private",
    owner: "staff-1",
    createdAt: "2026-08-16T00:00:00.000Z",
    updatedAt: "2026-08-16T00:00:00.000Z",
    currentDraftVersionId,
    currentPublishedVersionId: null,
    canEdit: true,
    canPublish: true,
    canDelete: true,
    schemaVersion: 4,
  };
}

/** A client whose cache already holds the exam, so the read never touches the network. */
function clientWithExam(exam: ExamEntity): QueryClient {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  client.setQueryData(examKeys.detail(exam.id), exam);
  return client;
}

/** The room as the page sees it: absent, or present with a status. */
function RoomProbe() {
  const collaboration = useSatAuthoringCollaboration();
  return (
    <span data-testid="room">{collaboration ? collaboration.status : "none"}</span>
  );
}

function renderBoundary(exam: ExamEntity) {
  return render(
    <QueryClientProvider client={clientWithExam(exam)}>
      <SatAuthoringCollaborationBoundary examId={exam.id}>
        <RoomProbe />
      </SatAuthoringCollaborationBoundary>
    </QueryClientProvider>,
  );
}

function coeditTokenRequests(fetchMock: ReturnType<typeof vi.fn>): string[] {
  return fetchMock.mock.calls
    .map((call) => String(call[0]))
    .filter((url) => url.includes("/coedit-token"));
}

afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("SAT collaboration boundary without an editable draft", () => {
  it("never asks for a room, and reads the room as disabled for the page", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    global.fetch = fetchMock as unknown as typeof fetch;

    renderBoundary(examFixture(null));

    // The state the page renders: a room that exists but has nothing to co-edit,
    // so the surfaces behind it keep their own save path.
    expect(await screen.findByTestId("room")).toHaveTextContent("disabled");
    expect(coeditTokenRequests(fetchMock)).toEqual([]);
  });

  it("waits for the exam read instead of racing it, so the refusal is never provoked", async () => {
    // The exam read never answers: the room must sit in "preparing" rather than
    // fire a token request in the same tick and lose the race.
    const fetchMock = vi.fn(() => new Promise<Response>(() => {}));
    global.fetch = fetchMock as unknown as typeof fetch;

    render(
      <QueryClientProvider client={clientWithExam(examFixture(null))}>
        <SatAuthoringCollaborationBoundary examId="exam-without-a-cached-read">
          <RoomProbe />
        </SatAuthoringCollaborationBoundary>
      </QueryClientProvider>,
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(coeditTokenRequests(fetchMock)).toEqual([]);
    expect(screen.getByTestId("room")).toHaveTextContent("preparing");
  });

  it("renders its children, so a page without a draft is not replaced by the boundary", () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    global.fetch = fetchMock as unknown as typeof fetch;

    render(
      <QueryClientProvider client={clientWithExam(examFixture(null))}>
        <SatAuthoringCollaborationBoundary examId="exam-1">
          <p>No editable draft</p>
        </SatAuthoringCollaborationBoundary>
      </QueryClientProvider>,
    );

    expect(screen.getByText("No editable draft")).toBeInTheDocument();
  });
});

describe("SAT collaboration boundary with an editable draft", () => {
  it("asks for the exam room once the exam says there is a draft", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          success: false,
          error: {
            code: "NOT_FOUND",
            message: "Only the current editable SAT draft can be co-edited.",
          },
        }),
        { status: 404, headers: { "content-type": "application/json" } },
      ),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    renderBoundary(examFixture("version-1"));

    await waitFor(() => expect(coeditTokenRequests(fetchMock)).toHaveLength(1));
    expect(coeditTokenRequests(fetchMock)[0]).toContain(
      "/v1/assessment-authoring/exams/exam-1/coedit-token",
    );
  });

  it("reads a 404 from the room as the no-room posture, not as a failure", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          success: false,
          error: {
            code: "NOT_FOUND",
            message: "Only the current editable SAT draft can be co-edited.",
          },
        }),
        { status: 404, headers: { "content-type": "application/json" } },
      ),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    renderBoundary(examFixture("version-1"));

    // Disabled, never "error": an author whose exam is not co-editable yet must
    // not be told the collaboration service is broken.
    await waitFor(async () => expect(await screen.findByTestId("room")).toHaveTextContent("disabled"));
  });
});
