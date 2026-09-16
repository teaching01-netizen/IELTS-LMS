/**
 * Pre-compaction local copy recovery, through the real provider.
 *
 * The service compacts an oversized room by rebuilding it from the durable
 * projection, which gives the room a NEW Yjs client identity and advances
 * `stateEpoch`. A browser copy written before that is not a continuation of the
 * compacted document: merging it would duplicate content, and deleting it would
 * throw away an author's unsynced work. This suite drives the real provider
 * (real Yjs, real y-indexeddb; only the transport is faked) to pin what happens
 * instead — the copy is preserved, reported, exportable, and removed only when
 * the author explicitly discards it.
 */
import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { attachIndexedDbPersistence } from "../indexedDbPersistence";
import { PromptCoeditProvider } from "../provider";

const DOCUMENT_NAME = `coedit:v2:${globalThis.crypto.randomUUID()}`;
const PROMPT_FIELD = "prompt";

const harness = vi.hoisted(() => ({ transports: [] as Array<{ sync: () => void; document: Y.Doc }> }));

vi.mock("@hocuspocus/provider", async () => {
  const Yjs = await import("yjs");
  class FakeHocuspocusProvider {
    readonly document: Y.Doc;
    private readonly options: Record<string, unknown>;
    constructor(options: Record<string, unknown>) {
      this.options = options;
      this.document = (options["document"] as Y.Doc) ?? new Yjs.Doc();
      harness.transports.push(this as unknown as { sync: () => void; document: Y.Doc });
    }
    async connect(): Promise<void> {}
    async sendToken(): Promise<void> {}
    sendStateless(): void {}
    flushPendingUpdates(): void {}
    destroy(): void {}
    sync(): void {
      (this.options["onSynced"] as (() => void) | undefined)?.();
    }
  }
  return { HocuspocusProvider: FakeHocuspocusProvider };
});

let providers: PromptCoeditProvider[] = [];

afterEach(() => {
  for (const provider of providers) provider.destroy();
  providers = [];
  harness.transports.length = 0;
});

function writePrompt(doc: Y.Doc, text: string): void {
  const fragment = doc.getXmlFragment(PROMPT_FIELD);
  doc.transact(() => {
    const paragraph = new Y.XmlElement("paragraph");
    const body = new Y.XmlText();
    body.insert(0, text);
    paragraph.insert(0, [body]);
    fragment.insert(fragment.length, [paragraph]);
  });
}

function openProvider(stateEpoch: string): PromptCoeditProvider {
  const provider = new PromptCoeditProvider({
    documentName: DOCUMENT_NAME,
    field: PROMPT_FIELD,
    serviceUrl: "ws://127.0.0.1:0",
    token: { token: "session-token", expiresAt: Math.floor(Date.now() / 1000) + 3600 },
    self: { actorId: "actor-1", displayName: "You" },
    readOnly: false,
    refreshToken: async () => ({
      token: "session-token",
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
    }),
    stateEpoch,
  });
  providers.push(provider);
  return provider;
}

/** Writes one cache namespace and detaches, exactly like a finished session. */
async function seedCache(stateEpoch: string, text: string): Promise<void> {
  const doc = new Y.Doc();
  const local = attachIndexedDbPersistence({ documentName: DOCUMENT_NAME, stateEpoch, ydoc: doc });
  await local.whenSynced;
  writePrompt(doc, text);
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  await local.detach();
  doc.destroy();
}

async function waitFor(check: () => boolean, label: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`timed out waiting for ${label}`);
}

describe("pre-compaction local copy", () => {
  it("is never merged into the room, and is reported and exportable", async () => {
    await seedCache("0", "unsynced idea");

    const provider = openProvider("1");
    const transport = harness.transports.at(-1);
    transport?.sync();
    // The room the browser opens holds DIFFERENT content, which is what makes
    // the older copy unsynced work rather than a redundant replay.
    writePrompt(provider.ydoc, "what the room has");

    await waitFor(() => provider.snapshot().issue === "stale_cache", "the stale-cache report");
    const snapshot = provider.snapshot();
    expect(snapshot.ready).toBe(true);
    expect(snapshot.issueMessage).not.toBeNull();
    // The live document was not touched by the old copy.
    expect(provider.ydoc.getXmlFragment(PROMPT_FIELD).toString()).toContain("what the room has");
    expect(provider.ydoc.getXmlFragment(PROMPT_FIELD).toString()).not.toContain("unsynced idea");

    const recovery = provider.session.recovery;
    expect(recovery.canExportStaleCache).toBe(true);
    const exported = recovery.exportStaleCache();
    expect(exported).toHaveLength(1);
    expect(exported?.[0]).toMatchObject({ room: DOCUMENT_NAME, stateEpoch: "0" });

    // The export restores exactly what the copy held.
    const restored = new Y.Doc();
    const bytes = Uint8Array.from(atob(exported?.[0]?.update ?? ""), (char) => char.charCodeAt(0));
    Y.applyUpdate(restored, bytes);
    expect(restored.getXmlFragment(PROMPT_FIELD).toString()).toContain("unsynced idea");

    // A flush is blocked while the copy is unreconciled: navigation must not
    // walk past work that exists only on this device.
    await expect(provider.flushAndWaitForSaved(200)).resolves.toMatchObject({
      outcome: "stale_cache",
      saved: false,
    });

    // Only the explicit discard removes it, and the report clears with it.
    await recovery.discardStaleCache();
    expect(provider.session.recovery.canExportStaleCache).toBe(false);
    expect(provider.snapshot().issue).toBe("none");
    const reopened = new Y.Doc();
    const reopenedLocal = attachIndexedDbPersistence({
      documentName: DOCUMENT_NAME,
      stateEpoch: "0",
      ydoc: reopened,
    });
    await reopenedLocal.whenSynced;
    expect(reopened.getXmlFragment(PROMPT_FIELD).toString()).toBe("");
    await reopenedLocal.destroy();
    restored.destroy();
  });

  it("is cleared silently when it holds nothing the room lacks", async () => {
    await seedCache("0", "same content");

    const provider = openProvider("1");
    harness.transports.at(-1)?.sync();
    // The compacted rebuild of the same content: same text, different identity.
    const equivalent = new Y.Doc();
    writePrompt(equivalent, "same content");
    Y.applyUpdate(provider.ydoc, Y.encodeStateAsUpdate(equivalent), "compacted");

    await waitFor(() => provider.snapshot().ready, "the readiness barrier");
    // Give the audit the same window the recovery test gives it, then assert it
    // decided to discard rather than to nag.
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(provider.snapshot().issue).toBe("none");
    expect(provider.session.recovery.canExportStaleCache).toBe(false);

    const reopened = new Y.Doc();
    const reopenedLocal = attachIndexedDbPersistence({
      documentName: DOCUMENT_NAME,
      stateEpoch: "0",
      ydoc: reopened,
    });
    await reopenedLocal.whenSynced;
    expect(reopened.getXmlFragment(PROMPT_FIELD).toString()).toBe("");
    await reopenedLocal.destroy();
    equivalent.destroy();
  });
});
