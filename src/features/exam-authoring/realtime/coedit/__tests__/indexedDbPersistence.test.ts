// jsdom has no IndexedDB; the real one is supplied by fake-indexeddb so these
// tests exercise the actual y-indexeddb attachment rather than a stand-in.
import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  attachIndexedDbPersistence,
  auditEpochCaches,
  clearEpochCache,
  coeditCacheName,
  coeditStaleCacheNames,
} from "../indexedDbPersistence";

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

/** A content-equivalent document with a DIFFERENT Yjs identity. */
function independentPrompt(text: string): Y.Doc {
  const doc = new Y.Doc();
  writePrompt(doc, text);
  return doc;
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
    const firstLocal = attachIndexedDbPersistence({ documentName: name, stateEpoch: "0", ydoc: first });
    await firstLocal.whenSynced;
    expect(firstLocal.localSynced).toBe(true);

    writePrompt(first, "written while offline");
    await settle();

    // A reload drops the Y.Doc without calling destroy: that is the crash /
    // refresh path, and the local copy is what recovers the author's work.
    const second = new Y.Doc();
    const secondLocal = attachIndexedDbPersistence({ documentName: name, stateEpoch: "0", ydoc: second });
    await secondLocal.whenSynced;
    expect(projection(second)).toContain("written while offline");

    await secondLocal.destroy();
    first.destroy();
  });

  it("deletes local state only on an explicit discard", async () => {
    const name = documentName();
    const first = new Y.Doc();
    const firstLocal = attachIndexedDbPersistence({ documentName: name, stateEpoch: "0", ydoc: first });
    await firstLocal.whenSynced;
    writePrompt(first, "discarded later");
    await settle();

    const second = new Y.Doc();
    const secondLocal = attachIndexedDbPersistence({ documentName: name, stateEpoch: "0", ydoc: second });
    await secondLocal.whenSynced;
    expect(projection(second)).toContain("discarded later");

    // No disconnect deletes anything; only the explicit discard does.
    await secondLocal.destroy();
    await settle();

    const third = new Y.Doc();
    const thirdLocal = attachIndexedDbPersistence({ documentName: name, stateEpoch: "0", ydoc: third });
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
    const oldLocal = attachIndexedDbPersistence({ documentName: replaced, stateEpoch: "0", ydoc: old });
    await oldLocal.whenSynced;
    writePrompt(old, "old draft prompt");
    await settle();

    // A replaced draft gets a NEW opaque document name, which is exactly why
    // identity is the isolation boundary: the new room must start clean even on
    // a browser that still holds the old copy.
    const fresh = new Y.Doc();
    const freshLocal = attachIndexedDbPersistence({ documentName: replacement, stateEpoch: "0", ydoc: fresh });
    await freshLocal.whenSynced;
    expect(projection(fresh)).not.toContain("old draft prompt");
    expect(projection(fresh)).toBe("");

    await freshLocal.destroy();
    await oldLocal.destroy();
    old.destroy();
    fresh.destroy();
  });
});

/**
 * Compaction-epoch recovery.
 *
 * A compacted room is rebuilt from the durable projection with a NEW Yjs
 * identity, so an older copy's history is not a continuation of it: merging one
 * duplicates content instead of replaying it. These tests pin the two things
 * that must therefore be true: the live attachment only ever opens its own
 * epoch's namespace, and an unreachable older copy is either proven redundant
 * or preserved — never merged, never silently deleted.
 */
describe("compaction-epoch recovery", () => {
  it("namespaces each epoch so an older copy is unreachable from the live room", async () => {
    const name = documentName();
    expect(coeditCacheName(name, "0")).not.toBe(coeditCacheName(name, "1"));
    expect(coeditStaleCacheNames(name, "2")).toContain(coeditCacheName(name, "1"));
    expect(coeditStaleCacheNames(name, "2")).toContain(name);
    expect(coeditStaleCacheNames(name, "2")).not.toContain(coeditCacheName(name, "2"));

    const epochZero = new Y.Doc();
    const epochZeroLocal = attachIndexedDbPersistence({ documentName: name, stateEpoch: "0", ydoc: epochZero });
    await epochZeroLocal.whenSynced;
    writePrompt(epochZero, "pre-compaction prompt");
    await settle();

    const epochOne = new Y.Doc();
    const epochOneLocal = attachIndexedDbPersistence({ documentName: name, stateEpoch: "1", ydoc: epochOne });
    await epochOneLocal.whenSynced;
    expect(projection(epochOne)).toBe("");
    expect(epochOneLocal.cacheName).toBe(coeditCacheName(name, "1"));

    await epochZeroLocal.destroy();
    await epochOneLocal.destroy();
    await clearEpochCache(coeditCacheName(name, "1"));
    await clearEpochCache(coeditCacheName(name, "0"));
    epochZero.destroy();
    epochOne.destroy();
  });

  it("clears an older copy whose content the room already holds", async () => {
    const name = documentName();
    const cached = new Y.Doc();
    const cachedLocal = attachIndexedDbPersistence({ documentName: name, stateEpoch: "0", ydoc: cached });
    await cachedLocal.whenSynced;
    writePrompt(cached, "same content");
    await settle();
    await cachedLocal.detach();

    // The compacted room holds the SAME content from an independent identity:
    // no struct of the cached document is in it, so only the content comparison
    // can prove the copy redundant.
    const live = new Y.Doc();
    const equivalent = independentPrompt("same content");
    Y.applyUpdate(live, Y.encodeStateAsUpdate(equivalent), "compacted");

    const audit = await auditEpochCaches({ documentName: name, stateEpoch: "1", ydoc: live });
    expect(audit.inspected).toBe(true);
    expect(audit.discarded).toEqual([coeditCacheName(name, "0")]);
    expect(audit.divergent).toEqual([]);

    // Cleared for good: a later attach to that namespace replays nothing.
    const reopened = new Y.Doc();
    const reopenedLocal = attachIndexedDbPersistence({ documentName: name, stateEpoch: "0", ydoc: reopened });
    await reopenedLocal.whenSynced;
    expect(projection(reopened)).toBe("");

    await reopenedLocal.destroy();
    equivalent.destroy();
    live.destroy();
    cached.destroy();
  });

  it("preserves and exports an older copy holding content the room does not have", async () => {
    const name = documentName();
    const cached = new Y.Doc();
    const cachedLocal = attachIndexedDbPersistence({ documentName: name, stateEpoch: "0", ydoc: cached });
    await cachedLocal.whenSynced;
    writePrompt(cached, "unsynced idea");
    // The room's scalar record lives in a shared MAP while the rich fields live
    // in XML roots, so the audit has to read both kinds of content: a map entry
    // the room does not have is exactly the unsynced work it exists to protect.
    cached.getMap("workspace").set("question/q1/scalar", JSON.stringify({ source: "offline" }));
    await settle();
    await cachedLocal.detach();

    const live = new Y.Doc();
    const equivalent = independentPrompt("what the room has");
    Y.applyUpdate(live, Y.encodeStateAsUpdate(equivalent), "compacted");

    const audit = await auditEpochCaches({ documentName: name, stateEpoch: "1", ydoc: live });
    expect(audit.discarded).toEqual([]);
    expect(audit.divergent).toHaveLength(1);
    const report = audit.divergent[0]!;
    expect(report.cacheName).toBe(coeditCacheName(name, "0"));
    expect(report.stateEpoch).toBe("0");

    // Byte-exact: the export restores the author's work, which is the only
    // reason it is offered at all.
    const restored = new Y.Doc();
    Y.applyUpdate(restored, Uint8Array.from(atob(report.updateBase64), (char) => char.charCodeAt(0)));
    expect(projection(restored)).toContain("unsynced idea");
    expect(restored.getMap("workspace").get("question/q1/scalar")).toBe(
      JSON.stringify({ source: "offline" }),
    );

    // And it is still on the device: the audit preserves what it cannot prove
    // redundant.
    const stillCached = new Y.Doc();
    const stillCachedLocal = attachIndexedDbPersistence({ documentName: name, stateEpoch: "0", ydoc: stillCached });
    await stillCachedLocal.whenSynced;
    expect(projection(stillCached)).toContain("unsynced idea");
    expect(stillCached.getMap("workspace").get("question/q1/scalar")).toBe(
      JSON.stringify({ source: "offline" }),
    );

    // Only an explicit discard removes it.
    await stillCachedLocal.destroy();
    await clearEpochCache(coeditCacheName(name, "0"));
    const afterDiscard = new Y.Doc();
    const afterDiscardLocal = attachIndexedDbPersistence({ documentName: name, stateEpoch: "0", ydoc: afterDiscard });
    await afterDiscardLocal.whenSynced;
    expect(projection(afterDiscard)).toBe("");

    await afterDiscardLocal.destroy();
    restored.destroy();
    equivalent.destroy();
    live.destroy();
    cached.destroy();
  });
});
