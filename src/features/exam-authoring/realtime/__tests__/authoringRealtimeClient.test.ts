import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthoringConnectionState } from "../contracts";
import {
  AuthoringRealtimeClient,
  buildAuthoringSocketUrl,
  computeAuthoringBackoffMs,
} from "../authoringRealtimeClient";

class MockWebSocket {
  static instances: MockWebSocket[] = [];

  url: string;
  readyState = 0;
  sent: string[] = [];
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: ((event: Event) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
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

  emitRaw(data: string) {
    this.onmessage?.(new MessageEvent("message", { data }));
  }

  close() {
    this.readyState = 3;
    this.onclose?.();
  }
}

function makeClient(options: Partial<ConstructorParameters<typeof AuthoringRealtimeClient>[0]> = {}) {
  return new AuthoringRealtimeClient({
    url: "ws://localhost/api/v1/ws/authoring?examId=exam-1",
    examId: "exam-1",
    getLastSeenCursor: () => 41,
    socketFactory: { create: (url) => new MockWebSocket(url) as unknown as WebSocket },
    heartbeatTimeoutMs: 1_000,
    keepaliveIntervalMs: 100_000,
    stableResetMs: 1_000,
    minReconnectDelayMs: 10,
    maxReconnectDelayMs: 10,
    ...options,
  });
}

describe("computeAuthoringBackoffMs", () => {
  beforeEach(() => {
    vi.spyOn(Math, "random").mockReturnValue(0);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("doubles from the 500ms base and is jitter-bounded", () => {
    vi.restoreAllMocks();
    for (const [attempt, base] of [
      [0, 500],
      [1, 1_000],
      [2, 2_000],
      [3, 4_000],
    ] as const) {
      const value = computeAuthoringBackoffMs(attempt, { jitterMs: 250 });
      expect(value).toBeGreaterThanOrEqual(base);
      expect(value).toBeLessThanOrEqual(base + 250);
    }
  });

  it("hard-caps at 30s even for absurd attempt counts", () => {
    const at10 = computeAuthoringBackoffMs(10, { jitterMs: 250 });
    const at99 = computeAuthoringBackoffMs(99, { jitterMs: 250 });
    expect(at10).toBe(30_000);
    expect(at99).toBe(30_000);
  });
});

describe("buildAuthoringSocketUrl", () => {
  it("targets the same-origin authoring path with the examId", () => {
    const url = buildAuthoringSocketUrl("exam 1/x");
    expect(url).toContain("/api/v1/ws/authoring");
    expect(url).toContain("examId=exam%201%2Fx");
  });
});

describe("AuthoringRealtimeClient", () => {
  beforeEach(() => {
    MockWebSocket.instances = [];
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("subscribes on open with the current cursor and reaches live on the ack", () => {
    const states: AuthoringConnectionState[] = [];
    const client = makeClient({ onStateChange: (s) => states.push(s) });
    client.start();
    const socket = MockWebSocket.instances[0];
    socket.open();
    expect(JSON.parse(socket.sent[0])).toMatchObject({
      type: "authoring.subscribe",
      v: 1,
      examId: "exam-1",
      lastSeenCursor: 41,
    });
    socket.emit({
      type: "authoring.subscribed",
      v: 1,
      examId: "exam-1",
      draftVersionId: "draft-7",
      barrierCursor: 512,
    });
    expect(states).toContain("live");
    client.stop();
  });

  it("treats any inbound frame as liveness (heartbeat refresh)", () => {
    const client = makeClient({ heartbeatTimeoutMs: 1_000 });
    client.start();
    const socket = MockWebSocket.instances[0];
    socket.open();
    vi.advanceTimersByTime(900);
    socket.emit({ type: "authoring.capabilities", v: 1, delivery: true, presence: false, conflictCompare: false });
    vi.advanceTimersByTime(900);
    expect(MockWebSocket.instances).toHaveLength(1);
    client.stop();
  });

  it("reconnects with exponential backoff after silence", () => {
    const client = makeClient({ heartbeatTimeoutMs: 1_000, minReconnectDelayMs: 10, maxReconnectDelayMs: 10 });
    client.start();
    MockWebSocket.instances[0].open();
    vi.advanceTimersByTime(1_001);
    expect(client.getAttemptCount()).toBe(1);
    vi.advanceTimersByTime(10);
    expect(MockWebSocket.instances).toHaveLength(2);
    client.stop();
  });

  it("sends a keepalive re-subscribe on the cadence", () => {
    const client = makeClient({ keepaliveIntervalMs: 50, heartbeatTimeoutMs: 100_000 });
    client.start();
    const socket = MockWebSocket.instances[0];
    socket.open();
    expect(socket.sent).toHaveLength(1);
    vi.advanceTimersByTime(50);
    expect(socket.sent).toHaveLength(2);
    expect(JSON.parse(socket.sent[1]).type).toBe("authoring.subscribe");
    client.stop();
  });

  it("resets backoff once the connection is stable", () => {
    const client = makeClient({
      heartbeatTimeoutMs: 100_000,
      stableResetMs: 1_000,
      minReconnectDelayMs: 10,
      maxReconnectDelayMs: 10,
    });
    client.start();
    const first = MockWebSocket.instances[0];
    first.open();
    first.emit({
      type: "authoring.subscribed",
      v: 1,
      examId: "exam-1",
      draftVersionId: "draft-7",
      barrierCursor: 1,
    });
    // Force one reconnect so the attempt counter is non-zero.
    first.close();
    vi.advanceTimersByTime(10);
    expect(client.getAttemptCount()).toBe(1);
    const second = MockWebSocket.instances[1];
    second.open();
    second.emit({
      type: "authoring.subscribed",
      v: 1,
      examId: "exam-1",
      draftVersionId: "draft-7",
      barrierCursor: 1,
    });
    vi.advanceTimersByTime(1_000);
    expect(client.getAttemptCount()).toBe(0);
    expect(client.isStableConnected()).toBe(true);
    client.stop();
  });

  it("stops retrying on a fatal subscription denial", () => {
    const states: AuthoringConnectionState[] = [];
    const client = makeClient({ onStateChange: (s) => states.push(s) });
    client.start();
    const socket = MockWebSocket.instances[0];
    socket.open();
    socket.emit({ type: "authoring.error", v: 1, code: "subscription_forbidden", message: "no" });
    expect(states).toContain("forbidden");
    const before = MockWebSocket.instances.length;
    vi.advanceTimersByTime(60_000);
    expect(MockWebSocket.instances).toHaveLength(before);
    client.stop();
  });

  it("reports malformed and oversized frames without closing the socket", () => {
    const onMalformed = vi.fn();
    const client = makeClient({ onMalformed });
    client.start();
    const socket = MockWebSocket.instances[0];
    socket.open();
    socket.emitRaw("{not json");
    expect(onMalformed).toHaveBeenCalledWith(expect.objectContaining({ reason: "malformed-json" }));
    socket.emitRaw(`"${"x".repeat(9_000)}"`);
    expect(onMalformed).toHaveBeenCalledWith(expect.objectContaining({ reason: "oversize" }));
    expect(MockWebSocket.instances).toHaveLength(1);
    client.stop();
  });

  it("reports the handshake ack ONCE per socket, with resumed=false when no cursor exists", () => {
    const onSubscribed = vi.fn();
    const client = makeClient({ getLastSeenCursor: () => null, onSubscribed });
    client.start();
    const socket = MockWebSocket.instances[0];
    socket.open();
    expect(JSON.parse(socket.sent[0])).not.toHaveProperty("lastSeenCursor");
    const ack = {
      type: "authoring.subscribed",
      v: 1,
      examId: "exam-1",
      draftVersionId: "draft-7",
      barrierCursor: 512,
    };
    socket.emit(ack);
    expect(onSubscribed).toHaveBeenCalledTimes(1);
    expect(onSubscribed).toHaveBeenCalledWith({
      examId: "exam-1",
      draftVersionId: "draft-7",
      barrierCursor: 512,
      resumed: false,
      connectionId: null,
    });
    // A keepalive re-subscribe is re-acked by the server; that ack is NOT a
    // baseline event and must never re-seed the cursor or force a refetch.
    socket.emit(ack);
    expect(onSubscribed).toHaveBeenCalledTimes(1);
    client.stop();
  });

  it("reports resumed=true when the subscribe carried lastSeenCursor", () => {
    const onSubscribed = vi.fn();
    const client = makeClient({ getLastSeenCursor: () => 41, onSubscribed });
    client.start();
    const socket = MockWebSocket.instances[0];
    socket.open();
    socket.emit({
      type: "authoring.subscribed",
      v: 1,
      examId: "exam-1",
      draftVersionId: "draft-7",
      barrierCursor: 512,
    });
    expect(onSubscribed).toHaveBeenCalledWith(expect.objectContaining({ resumed: true }));
    client.stop();
  });

  it("routes a valid frame with an unknown kind to onUnknownKind (not onMalformed)", () => {
    const onUnknownKind = vi.fn();
    const onMalformed = vi.fn();
    const client = makeClient({ onUnknownKind, onMalformed });
    client.start();
    const socket = MockWebSocket.instances[0];
    socket.open();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    socket.emit({
      type: "authoring.event",
      v: 1,
      cursor: 37,
      event: {
        version: 1,
        kind: "question.pinned",
        eventId: "evt-future",
        occurredAt: "2026-09-12T00:00:00.000Z",
        actor: { id: "user-alice", kind: "staff" },
        scope: { organizationId: "org-1", examId: "exam-1", draftVersionId: "draft-7" },
        entity: { kind: "question", examQuestionId: "eq-1", questionId: "q-1", moduleId: "m-1" },
        revision: 1,
        draftRevision: 1,
        changedFields: [],
      },
    });
    expect(onUnknownKind).toHaveBeenCalledWith({ rawKind: "question.pinned", cursor: 37 });
    expect(onMalformed).not.toHaveBeenCalled();
    expect(MockWebSocket.instances).toHaveLength(1);
    client.stop();
  });

  it("silences all callbacks after stop()", () => {
    const onStateChange = vi.fn();
    const onFrame = vi.fn();
    const client = makeClient({ onStateChange, onFrame });
    client.start();
    MockWebSocket.instances[0].open();
    client.stop();
    onStateChange.mockClear();
    vi.advanceTimersByTime(60_000);
    expect(onStateChange).not.toHaveBeenCalled();
    expect(onFrame).not.toHaveBeenCalled();
    expect(MockWebSocket.instances).toHaveLength(1);
  });
});
