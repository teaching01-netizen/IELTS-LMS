import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthoringSocketFactory, SnapshotSource } from "../contracts";
import { assessmentKeys } from "../../api/assessmentQueries";
import { useAuthoringRealtime } from "../useAuthoringRealtime";
import { makeEventFrame, makeQuestionDetail, makeShell } from "./fixtures";

class MockSocket {
  static instances: MockSocket[] = [];
  static reset() {
    MockSocket.instances = [];
  }

  url: string;
  readyState = 0;
  sent: string[] = [];
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: ((event: Event) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    MockSocket.instances.push(this);
  }

  send(data: string) {
    this.sent.push(data);
  }
  open() {
    this.readyState = 1;
    this.onopen?.(new Event("open"));
  }
  emit(frame: unknown) {
    this.onmessage?.(new MessageEvent("message", { data: JSON.stringify(frame) }));
  }
  close() {
    this.readyState = 3;
    this.onclose?.();
  }
}

const DRAFT = "draft-7";
const SCOPE = { organizationId: "org-1", examId: "exam-1", draftVersionId: DRAFT };
const SUBSCRIBED = {
  type: "authoring.subscribed",
  v: 1,
  examId: "exam-1",
  draftVersionId: DRAFT,
  // Barrier 0 = a brand-new exam: the handshake baseline is 0, so the small
  // cursors these fixtures use are all legitimately newer than it.
  barrierCursor: 0,
};

function setup(options: {
  enabled?: boolean;
  dirty?: boolean;
  recoveryFails?: boolean;
} = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 0 } },
  });
  queryClient.setQueryData(assessmentKeys.shell("exam-1"), makeShell(["eq-1"], DRAFT));
  queryClient.setQueryData(assessmentKeys.question("eq-1"), makeQuestionDetail("eq-1"));

  const getShell = options.recoveryFails
    ? vi.fn(async () => {
        throw new Error("offline");
      })
    : vi.fn(async () => makeShell(["eq-1", "eq-2"], DRAFT));
  const getQuestion = vi.fn(async (id: string) => makeQuestionDetail(id));
  const snapshotSource = { getShell, getQuestion } as unknown as SnapshotSource;
  const socketFactory: AuthoringSocketFactory = {
    create: (url) => new MockSocket(url) as unknown as WebSocket,
  };
  const onLifecycle = vi.fn();
  const onRemoteRevision = vi.fn();
  const onRemoteStructuralChange = vi.fn();
  const dirtyState = { value: options.dirty ?? false };

  const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  const view = renderHook(
    () =>
      useAuthoringRealtime({
        examId: "exam-1",
        enabled: options.enabled ?? true,
        draftVersionId: DRAFT,
        selectedExamQuestionId: "eq-1",
        isQuestionDirty: () => dirtyState.value,
        socketFactory,
        snapshotSource,
        snapshotRetryDelayMs: 0,
        onLifecycle,
        onRemoteRevision,
        onRemoteStructuralChange,
      }),
    { wrapper },
  );

  return {
    view,
    queryClient,
    invalidateSpy,
    getShell,
    getQuestion,
    onLifecycle,
    onRemoteRevision,
    onRemoteStructuralChange,
    dirtyState,
  };
}

function openSocket(ack: unknown = SUBSCRIBED): MockSocket {
  const socket = MockSocket.instances[MockSocket.instances.length - 1];
  act(() => {
    socket.open();
    socket.emit(ack);
  });
  return socket;
}

const SHELL_KEY = JSON.stringify(assessmentKeys.shell("exam-1"));

function shellInvalidations(spy: { mock: { calls: unknown[][] } }): number {
  return spy.mock.calls.filter((call) => {
    const filters = call[0] as { queryKey?: unknown } | undefined;
    return JSON.stringify(filters?.queryKey) === SHELL_KEY;
  }).length;
}

describe("useAuthoringRealtime", () => {
  beforeEach(() => {
    MockSocket.reset();
    vi.useRealTimers();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("is disabled and opens no socket when disabled", () => {
    const h = setup({ enabled: false });
    expect(MockSocket.instances).toHaveLength(0);
    expect(h.view.result.current.connectionState).toBe("disabled");
  });

  it("clean remote change invalidates the question detail", () => {
    const h = setup();
    const socket = openSocket();
    act(() => {
      socket.emit(makeEventFrame(10, { scope: SCOPE, kind: "question.changed" }));
    });
    expect(h.queryClient.getQueryState(assessmentKeys.question("eq-1"))?.isInvalidated).toBe(true);
    expect(h.view.result.current.stats.reconciled).toBe(1);
  });

  it("dirty remote change writes nothing and records the remote revision", () => {
    const h = setup({ dirty: true });
    const socket = openSocket();
    const before = h.queryClient.getQueryState(assessmentKeys.question("eq-1"))?.isInvalidated;
    act(() => {
      socket.emit(makeEventFrame(10, { scope: SCOPE, kind: "question.changed", revision: 9 }));
    });
    expect(h.onRemoteRevision).toHaveBeenCalledWith("eq-1", 9, "user-alice");
    expect(h.queryClient.getQueryState(assessmentKeys.question("eq-1"))?.isInvalidated).toBe(before);
    expect(h.view.result.current.stats.reconciled).toBe(0);
  });

  it("snapshot_required triggers an authoritative HTTP refetch and recovery stats", async () => {
    const h = setup();
    const socket = openSocket();
    act(() => {
      socket.emit({
        type: "authoring.snapshot_required",
        v: 1,
        examId: "exam-1",
        draftVersionId: DRAFT,
        reason: "cursor_too_old",
      });
    });
    await waitFor(() => expect(h.getShell).toHaveBeenCalled());
    await waitFor(() => expect(h.view.result.current.stats.snapshotRecoveries).toBe(1));
    const shell = h.queryClient.getQueryData<{ sections: unknown[] }>(
      assessmentKeys.shell("exam-1"),
    );
    expect(shell).toBeTruthy();
    expect(h.view.result.current.connectionState).toBe("live");
  });

  it("falls back to degraded-http when snapshot recovery fails twice", async () => {
    const h = setup({ recoveryFails: true });
    const socket = openSocket();
    act(() => {
      socket.emit({
        type: "authoring.snapshot_required",
        v: 1,
        examId: "exam-1",
        draftVersionId: DRAFT,
        reason: "delivery_gap",
      });
    });
    await waitFor(() => expect(h.view.result.current.connectionState).toBe("degraded-http"));
    expect(h.getShell).toHaveBeenCalledTimes(2);
  });

  it("lifecycle events surface the signal and flip to stale-draft", () => {
    const h = setup();
    const socket = openSocket();
    act(() => {
      socket.emit(
        makeEventFrame(11, {
          scope: { organizationId: "org-1", examId: "exam-1", draftVersionId: "draft-8" },
          kind: "draft.replaced",
          entity: { kind: "draft", examId: "exam-1", draftVersionId: "draft-8" },
        }),
      );
    });
    expect(h.onLifecycle).toHaveBeenCalledWith("draft-replaced");
    expect(h.view.result.current.connectionState).toBe("stale-draft");
  });

  it("ignores content events from another draft (stale-draft filter)", () => {
    const h = setup();
    const socket = openSocket();
    act(() => {
      socket.emit(
        makeEventFrame(12, {
          scope: { organizationId: "org-1", examId: "exam-1", draftVersionId: "draft-99" },
          kind: "question.changed",
        }),
      );
    });
    expect(h.view.result.current.stats.staleDraft).toBe(1);
    // The event itself performed no cache work (the fresh-subscribe
    // authoritative refetch already invalidated this query before it).
    const invalidations = shellInvalidations(h.invalidateSpy);
    act(() => {
      socket.emit(
        makeEventFrame(13, {
          scope: { organizationId: "org-1", examId: "exam-1", draftVersionId: "draft-99" },
          kind: "question.changed",
        }),
      );
    });
    expect(h.view.result.current.stats.staleDraft).toBe(2);
    expect(shellInvalidations(h.invalidateSpy)).toBe(invalidations);
  });

  it("establishes the cursor baseline from the HANDSHAKE, not the first event", () => {
    const h = setup();
    const socket = openSocket({
      type: "authoring.subscribed",
      v: 1,
      examId: "exam-1",
      draftVersionId: DRAFT,
      barrierCursor: 512,
    });
    // The barrier is the position the stream is guaranteed complete from.
    expect(h.view.result.current.lastProcessedCursor).toBe(512);

    act(() => {
      // A fresh subscribe replays nothing, so anything at or below the barrier
      // is already covered by the HTTP refetch — never re-applied as if new.
      socket.emit(makeEventFrame(10, { scope: SCOPE, kind: "question.changed" }));
    });
    expect(h.view.result.current.stats.outOfOrder).toBe(1);
    expect(h.view.result.current.stats.reconciled).toBe(0);

    act(() => {
      socket.emit(makeEventFrame(600, { scope: SCOPE, kind: "question.changed" }));
    });
    expect(h.view.result.current.lastProcessedCursor).toBe(600);
    expect(h.view.result.current.stats.reconciled).toBe(1);
  });

  it("a fresh subscribe closes the pre-subscribe window with an authoritative refetch", () => {
    const h = setup();
    openSocket();
    expect(shellInvalidations(h.invalidateSpy)).toBeGreaterThan(0);
    expect(h.queryClient.getQueryState(assessmentKeys.shell("exam-1"))?.isInvalidated).toBe(true);
  });

  it("a resumed subscribe does NOT re-seed the cursor or refetch", () => {
    const h = setup();
    openSocket();
    act(() => {
      h.view.result.current.reconnect();
    });
    const socket = openSocket();
    // The resume carried lastSeenCursor=0, so the server replays (0, barrier].
    expect(JSON.parse(socket.sent[0] as string)).toMatchObject({ lastSeenCursor: 0 });
    expect(h.view.result.current.lastProcessedCursor).toBe(0);
  });

  it("an unknown but valid kind advances the cursor and refetches once per kind", () => {
    const h = setup();
    const socket = openSocket();
    const unknownFrame = (cursor: number) => ({
      type: "authoring.event",
      v: 1,
      cursor,
      event: { ...makeEventFrame(cursor).event, kind: "question.pinned" },
    });
    act(() => {
      socket.emit(unknownFrame(20));
    });
    // Forward tolerance WITHOUT phantom loss: the cursor is consumed even
    // though no business behavior ran for the kind.
    expect(h.view.result.current.lastProcessedCursor).toBe(20);
    expect(h.view.result.current.stats.unknownKind).toBe(1);
    expect(h.view.result.current.stats.malformed).toBe(0);
    const afterFirst = shellInvalidations(h.invalidateSpy);
    expect(afterFirst).toBeGreaterThan(0);

    act(() => {
      socket.emit(unknownFrame(21));
    });
    expect(h.view.result.current.lastProcessedCursor).toBe(21);
    expect(h.view.result.current.stats.unknownKind).toBe(2);
    // Same kind, same binding: no refetch storm.
    expect(shellInvalidations(h.invalidateSpy)).toBe(afterFirst);
  });

  it("a remote delete of a DIRTY question preserves the draft and records divergence", () => {
    const h = setup({ dirty: true });
    const socket = openSocket();
    act(() => {
      socket.emit(makeEventFrame(30, { scope: SCOPE, kind: "question.deleted" }));
    });
    expect(h.onRemoteStructuralChange).toHaveBeenCalledWith(
      "eq-1",
      "deleted",
      "user-alice",
    );
    // The unsaved draft and its clean baseline both survive.
    expect(h.queryClient.getQueryData(assessmentKeys.question("eq-1"))).toBeTruthy();
    expect(h.queryClient.getQueryState(assessmentKeys.shell("exam-1"))?.isInvalidated).toBe(true);
    expect(h.view.result.current.stats.reconciled).toBe(0);
  });

  it("a remote delete of a CLEAN question still drops its cache", () => {
    const h = setup();
    const socket = openSocket();
    act(() => {
      socket.emit(makeEventFrame(31, { scope: SCOPE, kind: "question.deleted" }));
    });
    // Recorded even though nothing local is at risk, so the author is told a
    // collaborator deleted what they were reading rather than shown a bare load
    // error. Dropping the clean cache is still correct.
    expect(h.onRemoteStructuralChange).toHaveBeenCalledWith(
      "eq-1",
      "deleted",
      "user-alice",
    );
    expect(h.queryClient.getQueryData(assessmentKeys.question("eq-1"))).toBeUndefined();
    expect(h.view.result.current.stats.reconciled).toBe(1);
  });
});
