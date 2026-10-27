/**
 * A cleanly ended room is reopened on the current draft. When the token
 * endpoint hands back the same document that just ended, reopening would only
 * be closed again: the boundary must stop there instead of re-minting tokens
 * in a tight loop.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ExamEntity } from "../../../../../types/domain";
import { examKeys } from "../../../api/examQueries";
import { SatAuthoringCollaborationBoundary } from "../SatAuthoringCollaborationBoundary";
import { useSatAuthoringCollaboration } from "../useSatAuthoringCollaboration";

const providers: Array<{ documentName: string; destroyed: boolean }> = [];

vi.mock("../workspaceProvider", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../workspaceProvider")>();
  class FakeWorkspaceProvider {
    readonly documentName: string;
    destroyed = false;
    // The room ended with every edit acknowledged.
    readonly recovery = { issue: "closed", message: null, hadUnsavedWork: false };
    readonly session = { readOnly: false, lifecyclePhase: "frozen" };
    constructor(input: { documentName: string }) {
      this.documentName = input.documentName;
      providers.push(this);
    }
    subscribe() {
      return () => undefined;
    }
    destroy() {
      this.destroyed = true;
    }
    retry() {}
  }
  return { ...actual, SatAuthoringWorkspaceProvider: FakeWorkspaceProvider };
});

const originalFetch = global.fetch;

function exam(): ExamEntity {
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
    currentDraftVersionId: "draft-1",
    currentPublishedVersionId: null,
    canEdit: true,
    canPublish: true,
    canDelete: true,
    schemaVersion: 4,
  };
}

let latest: ReturnType<typeof useSatAuthoringCollaboration> = null;
function RoomProbe() {
  latest = useSatAuthoringCollaboration();
  return <span data-testid="room">{latest ? latest.status : "none"}</span>;
}

function tokenResponse(documentName: string) {
  return new Response(
    JSON.stringify({
      success: true,
      data: {
        token: "t",
        documentName,
        serviceUrl: "ws://127.0.0.1:1",
        expiresAt: Math.floor(Date.now() / 1000) + 600,
        schemaVersion: 2,
        fieldSet: "workspace",
        mode: "write",
        actorId: "staff-1",
        displayName: "",
      },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

afterEach(() => {
  global.fetch = originalFetch;
  providers.length = 0;
  latest = null;
});

describe("reopening a cleanly ended exam room", () => {
  it("does not reopen the same ended document again", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL) => tokenResponse("coedit:v2:room-1"));
    global.fetch = fetchMock as typeof fetch;
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(examKeys.detail("exam-1"), exam());
    render(
      <QueryClientProvider client={client}>
        <SatAuthoringCollaborationBoundary examId="exam-1">
          <RoomProbe />
        </SatAuthoringCollaborationBoundary>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(providers).toHaveLength(1));

    // The clean-end reopen: the server still names the same, closed document.
    act(() => latest?.retry());
    await waitFor(() => expect(screen.getByTestId("room").textContent).toBe("error"));

    expect(providers).toHaveLength(1);
    expect(providers[0]!.destroyed).toBe(true);
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("/coedit-token"))).toHaveLength(2);
    expect(latest?.error).toMatch(/collaboration session was closed/i);
  });

  it("opens the current draft's room when the token names a new document", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(tokenResponse("coedit:v2:room-1"))
      .mockResolvedValue(tokenResponse("coedit:v2:room-2"));
    global.fetch = fetchMock as typeof fetch;
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(examKeys.detail("exam-1"), exam());
    render(
      <QueryClientProvider client={client}>
        <SatAuthoringCollaborationBoundary examId="exam-1">
          <RoomProbe />
        </SatAuthoringCollaborationBoundary>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(providers).toHaveLength(1));

    act(() => latest?.retry());
    await waitFor(() => expect(providers).toHaveLength(2));
    expect(providers[1]!.documentName).toBe("coedit:v2:room-2");
  });
});
