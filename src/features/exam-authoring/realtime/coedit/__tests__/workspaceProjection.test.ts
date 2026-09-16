/**
 * SAT workspace snapshot cost.
 *
 * The workspace provider projects every shared rich root into the value the UI
 * reads, and each projection runs the full ProseMirror conversion. Co-editing
 * publishes an awareness frame on every caret move of every participant, so an
 * ungated recompute would re-serialize the whole exam for a remote cursor.
 *
 * These tests drive the REAL provider class, its real Yjs document and its real
 * Awareness; only the Hocuspocus transport and the IndexedDB attachment are
 * faked. They count projections per rich root — the actual unit of work a
 * workspace snapshot performs.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { plainContentFromText } from "../../../editor/richContent";
import { encodeStateVectorBase64 } from "../stateVector";
import { parseWorkspaceSeedFrame } from "../workspaceSeed";
import {
  SatAuthoringWorkspaceProvider,
  type WorkspaceCoeditSnapshot,
  type WorkspaceProviderDeps,
} from "../workspaceProvider";

// The exam-level room is the v2 (workspace) document identity: seeding is a
// workspace-only protocol, and the service ignores a seed for any other room.
const DOCUMENT_NAME = "coedit:v2:2f1b6c1e-6a0a-4a5b-9f0e-9d3a2f4c5b6d";
const ROOT_A = "rich:question/q-1/stimulus";
const ROOT_B = "rich:question/q-1/prompt";
const ROOT_C = "rich:question/q-1/rationale";
const PROMPT_FIELD = "question/q-1/prompt";

interface FakeTransport {
  name: string;
  document: Y.Doc;
  awareness: { states: Map<number, { [key: string]: unknown }>; clientID: number };
  /** Every stateless frame this client put on the wire, in order. */
  stateless: string[];
  /** The room reached initial sync. */
  sync: () => void;
  /** The transport reported a connection phase change. */
  status: (next: "connected" | "disconnected") => void;
  /** A stateless frame arrived from the service. */
  deliver: (payload: unknown) => void;
  /** Hocuspocus buffers outgoing updates; navigation must nudge that buffer. */
  flushPendingUpdates: () => void;
  /** How many times this client asked the transport to flush its buffer. */
  flushes: number;
  /** A server awareness frame arrived (roster change or a remote caret move). */
  awarenessFrame: () => void;
}

const harness = vi.hoisted(() => ({ transports: [] as FakeTransport[] }));

vi.mock("@hocuspocus/provider", async () => {
  const Yjs = await import("yjs");
  const { Awareness } = await import("y-protocols/awareness");
  class FakeHocuspocusProvider implements FakeTransport {
    readonly name: string;
    readonly document: Y.Doc;
    readonly awareness: InstanceType<typeof Awareness>;
    readonly stateless: string[] = [];
    flushes = 0;
    private readonly options: Record<string, unknown>;
    constructor(options: Record<string, unknown> & { name: string }) {
      this.options = options;
      this.name = options.name;
      this.document = (options.document as Y.Doc) ?? new Yjs.Doc();
      this.awareness = new Awareness(this.document);
      // The real transport forwards every awareness change — local or remote —
      // to the provider callback. That frame is what these tests count.
      this.awareness.on("update", () => this.awarenessFrame());
      harness.transports.push(this);
    }
    async connect(): Promise<void> {}
    async sendToken(): Promise<void> {}
    sendStateless(payload: string): void {
      this.stateless.push(payload);
    }
    destroy(): void {
      this.awareness.destroy();
    }
    sync(): void {
      (this.options["onSynced"] as (() => void) | undefined)?.();
    }
    status(next: "connected" | "disconnected"): void {
      (this.options["onStatus"] as ((payload: { status: string }) => void) | undefined)?.({
        status: next,
      });
    }
    deliver(payload: unknown): void {
      (this.options["onStateless"] as ((payload: { payload: string }) => void) | undefined)?.({
        payload: typeof payload === "string" ? payload : JSON.stringify(payload),
      });
    }
    flushPendingUpdates(): void {
      this.flushes += 1;
    }
    awarenessFrame(): void {
      (this.options["onAwarenessUpdate"] as (() => void) | undefined)?.();
    }
  }
  return { HocuspocusProvider: FakeHocuspocusProvider };
});

vi.mock("y-indexeddb", () => ({
  IndexeddbPersistence: class {
    whenSynced = Promise.resolve();
    async destroy(): Promise<void> {}
    async clearData(): Promise<void> {}
  },
}));

let rooms: SatAuthoringWorkspaceProvider[] = [];

beforeEach(() => {
  harness.transports.length = 0;
  rooms = [];
});

afterEach(() => {
  for (const room of rooms) room.destroy();
});

function openRoom(
  deps?: WorkspaceProviderDeps,
  options: { connect?: boolean; readOnly?: boolean } = {},
) {
  const provider = new SatAuthoringWorkspaceProvider(
    {
      documentName: DOCUMENT_NAME,
      serviceUrl: "ws://127.0.0.1:0",
      token: { token: "session-token", expiresAt: Math.floor(Date.now() / 1000) + 3600 },
      self: { actorId: "actor-1", displayName: "You" },
      readOnly: options.readOnly ?? false,
      refreshToken: async () => ({
        token: "session-token",
        expiresAt: Math.floor(Date.now() / 1000) + 3600,
      }),
    },
    deps,
  );
  rooms.push(provider);
  const transport = harness.transports.at(-1);
  if (!transport) throw new Error("the transport was not constructed");
  // The real transport reports the connection before the room syncs; both
  // matter, so the fake drives the same two callbacks in the same order.
  if (options.connect !== false) {
    transport.status("connected");
    transport.sync();
  }
  return { provider, transport };
}

/** Fails the test on a missing root instead of yielding undefined. */
function valueOf(snapshot: WorkspaceCoeditSnapshot, root: string): string {
  const value = snapshot.values[root];
  if (typeof value !== "string") {
    throw new Error(`${root} was not projected (have ${Object.keys(snapshot.values).join(", ")})`);
  }
  return value;
}

/** Every text run in a projected structured-content value, at any depth. */
function textWithin(value: unknown): string {
  const text: string[] = [];
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const child of node) visit(child);
      return;
    }
    if (!node || typeof node !== "object") return;
    const record = node as { text?: unknown };
    if (typeof record.text === "string") text.push(record.text);
    for (const child of Object.values(record)) visit(child);
  };
  visit(value);
  return text.join(" ");
}

describe("SAT workspace snapshot", () => {
  it("re-projects only the rich root that changed, never for awareness", () => {
    const projected: string[] = [];
    const { provider, transport } = openRoom({
      projectRichFragment: (ydoc, rootName) => {
        projected.push(rootName);
        return ydoc.getXmlFragment(rootName).toString();
      },
    });

    provider.setRichField("question/q-1/stimulus", plainContentFromText("Stimulus"));
    provider.setRichField(PROMPT_FIELD, plainContentFromText("Prompt"));
    provider.setRichField("question/q-1/rationale", plainContentFromText("Rationale"));
    // No subscriber yet, so nothing has projected: the work is driven by the
    // published snapshot, not by the document.
    expect(projected).toEqual([]);

    const snapshots: WorkspaceCoeditSnapshot[] = [];
    provider.subscribe((next) => snapshots.push(next));
    expect(projected).toEqual([ROOT_A, ROOT_B, ROOT_C]);

    // A local awareness frame that DOES change the roster (the author moves to
    // another question) publishes, but must not re-serialize any fragment.
    provider.setPresence({ surface: "builder", questionId: "q-1" });
    expect(snapshots).toHaveLength(2);
    expect(snapshots[1]!.participants.find((entry) => entry.isSelf)?.selectedQuestionId).toBe("q-1");
    expect(projected).toEqual([ROOT_A, ROOT_B, ROOT_C]);
    // Presence and status frames reuse the published object, so a consumer that
    // depends on `values` does not re-render for a caret.
    expect(snapshots[1]!.values).toBe(snapshots[0]!.values);

    // A collaborator joins the room: another awareness frame, another publish,
    // still no projection.
    transport.awareness.states.set(4242, {
      user: { id: "actor-2", name: "Mira", color: "#0891B2" },
      target: { surface: "builder", questionId: "q-2" },
    });
    transport.awarenessFrame();
    expect(snapshots[2]!.participants.map((entry) => entry.displayName)).toEqual(["You", "Mira"]);
    expect(snapshots[2]!.participants.map((entry) => entry.selectedQuestionId)).toEqual(["q-1", "q-2"]);
    expect(projected).toEqual([ROOT_A, ROOT_B, ROOT_C]);

    // The collaborator's caret moves: the state changed, the roster did not.
    // Nothing a reader can see changed, so nothing is published at all.
    transport.awareness.states.set(4242, {
      user: { id: "actor-2", name: "Mira", color: "#0891B2" },
      target: { surface: "builder", questionId: "q-2" },
      cursor: { anchor: 5, head: 5 },
    });
    transport.awarenessFrame();
    expect(snapshots).toHaveLength(3);
    expect(projected).toEqual([ROOT_A, ROOT_B, ROOT_C]);

    // A real document change re-projects that root — and only that root.
    provider.setRichField(PROMPT_FIELD, plainContentFromText("Prompt edited"));
    expect(projected).toEqual([ROOT_A, ROOT_B, ROOT_C, ROOT_B]);
    expect(valueOf(snapshots[3]!, ROOT_B)).toContain("Prompt edited");
    expect(valueOf(snapshots[3]!, ROOT_A)).toBe(valueOf(snapshots[0]!, ROOT_A));
  });

  it("invalidates the cached projection for an edit nested inside a paragraph", () => {
    const projected: string[] = [];
    const { provider } = openRoom({
      projectRichFragment: (ydoc, rootName) => {
        projected.push(rootName);
        return ydoc.getXmlFragment(rootName).toString();
      },
    });
    provider.setRichField(PROMPT_FIELD, plainContentFromText("Prompt"));
    const snapshots: WorkspaceCoeditSnapshot[] = [];
    provider.subscribe((next) => snapshots.push(next));
    expect(projected).toEqual([ROOT_B]);

    // A keystroke lands on the paragraph's text node, never on the fragment the
    // projection is cached against: only a deep observer sees this.
    const paragraph = provider.ydoc.getXmlFragment(ROOT_B).get(0) as Y.XmlElement;
    const text = paragraph.get(0) as Y.XmlText;
    text.insert(text.length, " updated");

    expect(projected).toEqual([ROOT_B, ROOT_B]);
    expect(valueOf(snapshots.at(-1)!, ROOT_B)).toContain("Prompt updated");
  });

  it("re-projects a rich root when a collaborator's update arrives", () => {
    const projected: string[] = [];
    const { provider } = openRoom({
      projectRichFragment: (ydoc, rootName) => {
        projected.push(rootName);
        return ydoc.getXmlFragment(rootName).toString();
      },
    });
    provider.setRichField(PROMPT_FIELD, plainContentFromText("Prompt"));
    const snapshots: WorkspaceCoeditSnapshot[] = [];
    provider.subscribe((next) => snapshots.push(next));
    expect(projected).toEqual([ROOT_B]);

    // A second client converges on the room, types into the SAME paragraph, and
    // its update is applied the way the transport applies one.
    const peer = new Y.Doc();
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(provider.ydoc));
    const peerText = (peer.getXmlFragment(ROOT_B).get(0) as Y.XmlElement).get(0) as Y.XmlText;
    peerText.insert(peerText.length, " from Mira");
    Y.applyUpdate(provider.ydoc, Y.encodeStateAsUpdate(peer), "remote");
    peer.destroy();

    expect(projected).toEqual([ROOT_B, ROOT_B]);
    expect(valueOf(snapshots.at(-1)!, ROOT_B)).toContain("Prompt from Mira");
  });

  it("projects rich roots and scalar fields with the shipped conversion by default", () => {
    const { provider } = openRoom();
    const snapshots: WorkspaceCoeditSnapshot[] = [];
    provider.subscribe((next) => snapshots.push(next));

    // Scalar workspace fields travel through the same published record: the UI
    // reads `values[path]`, so an empty record would blank every shared field.
    provider.setValue("ui/selectedQuestionId", "q-1");
    expect(snapshots.at(-1)!.values["ui/selectedQuestionId"]).toBe("q-1");

    // An accepted seed arrives as an ordinary Yjs update from the service; the
    // local equivalent of applying that update is the projection under test.
    provider.setRichField(PROMPT_FIELD, plainContentFromText("Hello flow"));
    expect(textWithin(snapshots.at(-1)!.values[ROOT_B])).toContain("Hello flow");

    provider.setRichField(PROMPT_FIELD, plainContentFromText("Rewritten"));
    expect(textWithin(snapshots.at(-1)!.values[ROOT_B])).toContain("Rewritten");
  });
});

/**
 * Server-owned workspace seeding.
 *
 * The room, not the browser, decides which of two concurrent seeds becomes the
 * content: two tabs opening the same empty question both observe an empty root,
 * so a local write would let whichever merges second silently win. These tests
 * pin the browser half of that protocol — propose, never write, and never spend
 * a frame on a root the room already holds.
 */
describe("SAT workspace seeding", () => {
  const seedFrames = (transport: FakeTransport) =>
    transport.stateless.map((payload) =>
      parseWorkspaceSeedFrame(payload, { documentName: DOCUMENT_NAME }),
    );

  it("proposes one seed frame per empty root instead of writing it locally", () => {
    const { provider, transport } = openRoom();
    const snapshots: WorkspaceCoeditSnapshot[] = [];
    provider.subscribe((next) => snapshots.push(next));

    expect(provider.seedValue("question/q-1/scalar", { source: "http" }, 7)).toBe(true);
    expect(provider.seedRichField(PROMPT_FIELD, plainContentFromText("Prompt"), 7)).toBe(true);

    const frames = seedFrames(transport);
    expect(frames.map((frame) => frame?.root)).toEqual(["scalar", "rich"]);
    expect(frames[0]).toMatchObject({
      documentName: DOCUMENT_NAME,
      path: "question/q-1/scalar",
      value: { source: "http" },
      sourceQuestionRevision: 7,
    });
    expect(frames[1]).toMatchObject({
      documentName: DOCUMENT_NAME,
      path: PROMPT_FIELD,
      sourceQuestionRevision: 7,
    });
    // The proposal has not touched the local document: an unacknowledged seed
    // must never look like shared content, or a browser that failed to reach
    // the service would appear to have filled the room itself.
    const published = snapshots.at(-1)!.values;
    expect(published["question/q-1/scalar"]).toBeUndefined();
    expect(published[ROOT_B]).toBeUndefined();
  });

  it("deduplicates identical pending proposals by their deterministic seed id", () => {
    const { provider, transport } = openRoom(undefined, { connect: false });

    expect(provider.seedRichField(PROMPT_FIELD, plainContentFromText("Prompt"))).toBe(true);
    expect(provider.seedRichField(PROMPT_FIELD, plainContentFromText("Prompt"))).toBe(true);
    expect(transport.stateless).toEqual([]);

    transport.status("connected");
    const frames = seedFrames(transport);
    expect(frames).toHaveLength(1);
    expect(frames[0]!.path).toBe(PROMPT_FIELD);
  });

  it("never proposes over a root the room already holds", () => {
    const { provider, transport } = openRoom();
    // Content that arrived as a collaborator's update (or an accepted seed).
    provider.setValue("question/q-1/scalar", { source: "room" });
    provider.setRichField(PROMPT_FIELD, plainContentFromText("Written"));

    expect(provider.seedValue("question/q-1/scalar", { source: "http" })).toBe(false);
    expect(provider.seedRichField(PROMPT_FIELD, plainContentFromText("Prompt"))).toBe(false);
    expect(transport.stateless).toEqual([]);
  });

  it("proposes nothing for a read-only session", () => {
    const { provider, transport } = openRoom(undefined, { readOnly: true });

    expect(provider.seedValue("question/q-1/scalar", { source: "http" })).toBe(false);
    expect(provider.seedRichField(PROMPT_FIELD, plainContentFromText("Prompt"))).toBe(false);
    expect(transport.stateless).toEqual([]);
  });

  it("refuses a proposal outside the seed vocabulary instead of sending it", () => {
    const { provider, transport } = openRoom();

    // `ui/selectedQuestionId` is not a seedable root, and a rich path that is
    // not one of the shipped roots cannot be arbitrated by the service.
    expect(provider.seedValue("ui/selectedQuestionId", "q-1")).toBe(false);
    expect(provider.seedRichField("question/q-1/notes", plainContentFromText("Notes"))).toBe(false);
    expect(transport.stateless).toEqual([]);
  });

  it("withholds readiness until the local cache has replayed", async () => {
    const { provider } = openRoom();

    // The room synced, but the recovery copy has not landed yet: mounting an
    // editor now would replay it underneath the author's first keystrokes.
    expect(provider.snapshot().localReady).toBe(false);
    expect(provider.snapshot().ready).toBe(false);

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(provider.snapshot().localReady).toBe(true);
    expect(provider.snapshot().ready).toBe(true);
  });
});

/**
 * Durable acknowledgements and the navigation flush.
 *
 * Two facts decide whether an editor may say Saved or a route may navigate: the
 * acknowledgement has to be NEWER than every one already applied (ordered by
 * the durable commit sequence, which is not the materialized revision), and it
 * has to cover the EXACT state vector this tab holds.
 */
describe("durable acknowledgements and flush", () => {
  const ack = (variant: Record<string, unknown>) => ({
    type: "coedit.ack",
    documentName: DOCUMENT_NAME,
    stateHash: "a".repeat(64),
    questionRevision: 1,
    materializedRevision: 5,
    ...variant,
  });

  /** Lets the replay land, which is what opens the readiness barrier. */
  const openBarrier = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

  it("accepts a newer commit sequence at an unchanged materialized revision", async () => {
    const { provider, transport } = openRoom();
    await openBarrier();
    const vector = encodeStateVectorBase64(provider.ydoc);

    transport.deliver(ack({ stateVector: vector, commitSequence: "7" }));
    expect(provider.snapshot().saveState.name).toBe("saved");
    expect(provider.snapshot().commitSequence).toBe("7");

    // A UI-only commit shares the materialized revision: only the sequence can
    // say it is newer, and "Saved" must follow the newer state, not the equal
    // revision.
    provider.setValue("ui/selectedQuestionId", "q-1");
    const afterEdit = encodeStateVectorBase64(provider.ydoc);
    transport.deliver(ack({ stateVector: afterEdit, commitSequence: "8" }));
    expect(provider.snapshot().saveState.name).toBe("saved");
    expect(provider.snapshot().lastAckedRevision).toBe("5");

    // And an older sequence is ignored outright, even though it carries a
    // revision the provider has never seen.
    transport.deliver(
      ack({ stateVector: encodeStateVectorBase64(new Y.Doc()), commitSequence: "8", materializedRevision: 99 }),
    );
    expect(provider.snapshot().saveState.name).toBe("saved");
    expect(provider.snapshot().saveState.acknowledgedStateVector).toBe(afterEdit);
  });

  it("adopts the durable epoch an acknowledgement reports", async () => {
    const { provider, transport } = openRoom();
    await openBarrier();
    expect(provider.snapshot().stateEpoch).toBe("0");

    transport.deliver(
      ack({
        stateVector: encodeStateVectorBase64(provider.ydoc),
        commitSequence: "1",
        stateEpoch: "3",
      }),
    );
    expect(provider.snapshot().stateEpoch).toBe("3");
  });

  it("resolves the flush only for this tab's exact state vector", async () => {
    const { provider, transport } = openRoom();
    await openBarrier();
    provider.setRichField(PROMPT_FIELD, plainContentFromText("Ready to navigate"));

    const pending = provider.flushAndWaitForSaved(500);
    expect(transport.flushes).toBe(1);
    // A vector that is not this tab's cannot satisfy the flush, even though it
    // is a real durable acknowledgement.
    transport.deliver(
      ack({ stateVector: encodeStateVectorBase64(new Y.Doc()), commitSequence: "1" }),
    );
    expect(provider.snapshot().saveState.name).not.toBe("saved");

    transport.deliver(
      ack({ stateVector: encodeStateVectorBase64(provider.ydoc), commitSequence: "2" }),
    );
    await expect(pending).resolves.toMatchObject({ outcome: "saved", saved: true });
  });

  it("classifies a lost transport and a missed deadline instead of claiming Saved", async () => {
    const { provider, transport } = openRoom();
    await openBarrier();
    provider.setRichField(PROMPT_FIELD, plainContentFromText("Unsaved"));

    await expect(provider.flushAndWaitForSaved(200)).resolves.toMatchObject({
      outcome: "pending",
      saved: false,
    });

    transport.status("disconnected");
    await expect(provider.flushAndWaitForSaved(200)).resolves.toMatchObject({
      outcome: "offline",
      saved: false,
    });
  });
});
