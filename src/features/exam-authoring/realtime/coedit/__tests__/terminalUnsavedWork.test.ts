/**
 * A room that ends (closed/replaced) records whether this tab still held
 * unacknowledged work, so a clean tab is reopened instead of being shown a
 * recovery surface for work that does not exist.
 */
import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { PromptCoeditProvider } from "../provider";

vi.mock("@hocuspocus/provider", async () => {
  const Yjs = await import("yjs");
  class FakeHocuspocusProvider {
    readonly document: Y.Doc;
    constructor(options: Record<string, unknown>) {
      this.document = (options["document"] as Y.Doc) ?? new Yjs.Doc();
    }
    async connect(): Promise<void> {}
    async sendToken(): Promise<void> {}
    sendStateless(): void {}
    flushPendingUpdates(): void {}
    destroy(): void {}
  }
  return { HocuspocusProvider: FakeHocuspocusProvider };
});

let providers: PromptCoeditProvider[] = [];

afterEach(() => {
  for (const provider of providers) provider.destroy();
  providers = [];
});

function openProvider(): PromptCoeditProvider {
  const token = { token: "session-token", expiresAt: Math.floor(Date.now() / 1000) + 3600 };
  const provider = new PromptCoeditProvider({
    documentName: `coedit:v2:${globalThis.crypto.randomUUID()}`,
    field: "prompt",
    serviceUrl: "ws://127.0.0.1:0",
    token,
    self: { actorId: "actor-1", displayName: "You" },
    readOnly: false,
    refreshToken: async () => token,
    stateEpoch: "0",
  });
  providers.push(provider);
  return provider;
}

describe("terminal room unsaved work", () => {
  it("records a clean tab as having nothing to recover", () => {
    const provider = openProvider();
    provider.reportReplaced();
    expect(provider.session.recovery.issue).toBe("replaced");
    expect(provider.session.recovery.hadUnsavedWork).toBe(false);
  });

  it("records an unacknowledged edit as work to recover", () => {
    const provider = openProvider();
    const fragment = provider.ydoc.getXmlFragment("prompt");
    provider.ydoc.transact(() => {
      const paragraph = new Y.XmlElement("paragraph");
      paragraph.insert(0, [new Y.XmlText("unsaved")]);
      fragment.insert(0, [paragraph]);
    });
    provider.reportReplaced();
    expect(provider.session.recovery.hadUnsavedWork).toBe(true);
  });
});
