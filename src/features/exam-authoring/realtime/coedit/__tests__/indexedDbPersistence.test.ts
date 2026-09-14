// jsdom has no IndexedDB; the real one is supplied by fake-indexeddb so these
// tests exercise the actual y-indexeddb attachment rather than a stand-in.
import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { attachIndexedDbPersistence } from "../indexedDbPersistence";

function documentName(): string {
  return `coedit:v1:${globalThis.crypto.randomUUID()}`;
}

function projection(doc: Y.Doc): string {
  return doc.getXmlFragment("prompt").toString();
}

function writePrompt(doc: Y.Doc, text: string): void {
  const fragment = doc.getXmlFragment("prompt");
  doc.transact(() => {
    const paragraph = new Y.XmlElement("paragraph");
    const body = new Y.XmlText();
    body.insert(0, text);
    paragraph.insert(0, [body]);
    fragment.insert(fragment.length, [paragraph]);
  });
}

async function settle(): Promise<void> {
  // y-indexeddb writes on a microtask boundary; give the IDB transaction a
  // turn before asserting what a later attach replays.
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

describe("IndexedDB prompt recovery", () => {
  it("replays offline work into a fresh document with the same identity", async () => {
    const name = documentName();
    const first = new Y.Doc();
    const firstLocal = attachIndexedDbPersistence(name, first);
    await firstLocal.whenSynced;
    expect(firstLocal.localSynced).toBe(true);

    writePrompt(first, "written while offline");
    await settle();

    // A reload drops the Y.Doc without calling destroy: that is the crash /
    // refresh path, and the local copy is what recovers the author's work.
    const second = new Y.Doc();
    const secondLocal = attachIndexedDbPersistence(name, second);
    await secondLocal.whenSynced;
    expect(projection(second)).toContain("written while offline");

    await secondLocal.destroy();
    first.destroy();
  });

  it("deletes local state only on an explicit discard", async () => {
    const name = documentName();
    const first = new Y.Doc();
    const firstLocal = attachIndexedDbPersistence(name, first);
    await firstLocal.whenSynced;
    writePrompt(first, "discarded later");
    await settle();

    const second = new Y.Doc();
    const secondLocal = attachIndexedDbPersistence(name, second);
    await secondLocal.whenSynced;
    expect(projection(second)).toContain("discarded later");

    // No disconnect deletes anything; only the explicit discard does.
    await secondLocal.destroy();
    await settle();

    const third = new Y.Doc();
    const thirdLocal = attachIndexedDbPersistence(name, third);
    await thirdLocal.whenSynced;
    expect(projection(third)).not.toContain("discarded later");
    expect(projection(third)).toBe("");

    await thirdLocal.destroy();
    first.destroy();
    second.destroy();
  });

  it("never merges one document's local cache into another identity", async () => {
    const replaced = documentName();
    const replacement = documentName();

    const old = new Y.Doc();
    const oldLocal = attachIndexedDbPersistence(replaced, old);
    await oldLocal.whenSynced;
    writePrompt(old, "old draft prompt");
    await settle();

    // A replaced draft gets a NEW opaque document name, which is exactly why
    // identity is the isolation boundary: the new room must start clean even on
    // a browser that still holds the old copy.
    const fresh = new Y.Doc();
    const freshLocal = attachIndexedDbPersistence(replacement, fresh);
    await freshLocal.whenSynced;
    expect(projection(fresh)).not.toContain("old draft prompt");
    expect(projection(fresh)).toBe("");

    await freshLocal.destroy();
    await oldLocal.destroy();
    old.destroy();
    fresh.destroy();
  });
});
