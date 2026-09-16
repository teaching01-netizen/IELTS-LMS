import { IndexeddbPersistence } from "y-indexeddb";
import * as Y from "yjs";
import type { Doc } from "yjs";
import type { CoeditDecimalString } from "./protocol";
import { isCoeditDecimalString } from "./protocol";
import { toBase64 } from "./stateVector";

/**
 * Local crash/offline recovery for one collaborative room, namespaced by the
 * room's durable compaction epoch.
 *
 * Identity is the isolation boundary, and a compaction makes that boundary
 * two-dimensional: the logical room name still identifies the room, but a
 * compacted room is rebuilt from the durable projection with a NEW Yjs client
 * identity. Its history is not a continuation of the old document's, so an
 * older copy merging into it duplicates content instead of replaying it.
 * Caches are therefore keyed by `document + stateEpoch`, and an older epoch is
 * never merged — it is audited (see `auditEpochCaches`) and either proven
 * redundant or preserved for the author.
 *
 * Deletion is explicit. Local state is deleted only after a proven-redundant
 * audit, a matching committed state hash, or an explicit user discard — never
 * automatically on disconnect. An offline author's work must survive a refresh.
 */
export interface CoeditLocalPersistence {
  whenSynced: Promise<void>;
  /** True once IndexedDB has replayed its local copy into the Y.Doc. */
  readonly localSynced: boolean;
  /** The cache namespace this attachment reads and writes. */
  readonly cacheName: string;
  /** Detaches without deleting the stored copy (audits, epoch adoption). */
  detach: () => Promise<void>;
  /** Deletes this document's local cache (explicit discard only). */
  destroy: () => Promise<void>;
}

/**
 * Cache namespace for one logical room at one durable epoch.
 *
 * The `#e<epoch>` suffix is what makes an old copy unreachable from the live
 * document: it is never opened by the attachment for a newer epoch, so it can
 * never merge. `stateEpoch` is a decimal string because it crosses the JSON
 * boundary as a BIGINT-backed counter.
 */
export function coeditCacheName(
  documentName: string,
  stateEpoch: CoeditDecimalString,
): string {
  return `${documentName}#e${stateEpoch}`;
}

/**
 * How many previous epochs are audited for a possibly-unsynced copy.
 *
 * The window bounds the audit's cost (one namespace per epoch) while covering
 * every realistic gap: an epoch only advances when the SERVICE compacts an
 * oversized room, which is rare. Copies older than the window are left exactly
 * where they are — preserved, never merged, never silently cleared.
 */
export const COEDIT_STALE_CACHE_EPOCH_WINDOW = 16;

/** Namespaces that may hold an older copy, newest first. */
export function coeditStaleCacheNames(
  documentName: string,
  stateEpoch: CoeditDecimalString,
  window = COEDIT_STALE_CACHE_EPOCH_WINDOW,
): string[] {
  const names: string[] = [];
  // Instances before epoch namespacing wrote the bare document name: that copy
  // belongs to the epoch this browser was last on, and it is exactly the copy a
  // compaction can strand.
  names.push(documentName);
  if (!isCoeditDecimalString(stateEpoch)) return names;
  const epoch = BigInt(stateEpoch);
  for (let back = 1n; back <= BigInt(Math.max(0, window)); back += 1n) {
    if (epoch - back < 0n) break;
    names.push(coeditCacheName(documentName, (epoch - back).toString()));
  }
  return names.filter((name) => name !== coeditCacheName(documentName, stateEpoch));
}

/** One preserved older-epoch copy that the room does not hold. */
export interface CoeditStaleCacheReport {
  /** The cache namespace the copy lives in. */
  cacheName: string;
  /** Epoch that namespace belongs to; `0` for a pre-namespacing copy. */
  stateEpoch: CoeditDecimalString;
  /**
   * The whole copy, base64-encoded Yjs update. Byte-exact on purpose: an
   * export of local work must be restorable, not a lossy projection of it.
   */
  updateBase64: string;
  stateVectorBase64: string;
}

export interface CoeditStaleCacheAudit {
  /** Namespaces proven redundant and cleared. */
  discarded: string[];
  /** Namespaces holding content the room does not have: preserved. */
  divergent: CoeditStaleCacheReport[];
  /**
   * True when the audit ran at all. False means IndexedDB cannot enumerate its
   * databases here, so nothing was inspected — and, importantly, nothing was
   * cleared or merged.
   */
  inspected: boolean;
}

export function attachIndexedDbPersistence(input: {
  documentName: string;
  stateEpoch: CoeditDecimalString;
  ydoc: Doc;
}): CoeditLocalPersistence {
  let localSynced = false;
  const cacheName = coeditCacheName(input.documentName, input.stateEpoch);
  const persistence = new IndexeddbPersistence(cacheName, input.ydoc);
  const whenSynced = persistence.whenSynced.then(() => {
    localSynced = true;
  });
  return {
    whenSynced,
    get localSynced() {
      return localSynced;
    },
    cacheName,
    detach: async () => {
      await persistence.destroy();
      localSynced = false;
    },
    destroy: async () => {
      // `destroy` detaches; `clearData` removes the stored copy. Both are
      // required for a discard to actually free the author's local content.
      await persistence.destroy();
      await persistence.clearData();
      localSynced = false;
    },
  };
}

/** Deletes one cache namespace by name, without ever reading it as content. */
export async function clearEpochCache(cacheName: string): Promise<void> {
  const scratch = new Y.Doc();
  const persistence = new IndexeddbPersistence(cacheName, scratch);
  try {
    await persistence.destroy();
    await persistence.clearData();
  } finally {
    scratch.destroy();
  }
}

/**
 * An empty Yjs update is the two-byte encoding of "zero clients with missing
 * structs" (verified against yjs: `[0, 0]`). It is the one content-free result
 * `encodeStateAsUpdate` can return.
 */
function isStateUpdateEmpty(update: Uint8Array): boolean {
  if (update.byteLength === 0) return true;
  return update.byteLength === 2 && update[0] === 0 && update[1] === 0;
}

/** The epoch a cache namespace belongs to, or `0` for a pre-namespacing copy. */
function epochOfCacheName(cacheName: string, documentName: string): CoeditDecimalString {
  const suffix = cacheName.slice(documentName.length);
  const match = /^#e(0|[1-9][0-9]*)$/.exec(suffix);
  return match?.[1] ?? "0";
}

/**
 * Content-only fingerprint of everything a shared document holds.
 *
 * Yjs history is deliberately excluded: client ids and clock values differ
 * between a pre-compaction copy and the compacted document rebuilt from the
 * durable projection, so a history comparison would call the same content
 * "divergent" and nag the author on every compaction.
 *
 * The comparison is whole-room and total: a copy that is merely older than the
 * live room also fails equality and is reported rather than cleared. That is
 * the conservative direction — the author is told about a local copy instead of
 * the client silently deleting one it cannot prove redundant.
 */
export function coeditContentFingerprint(ydoc: Doc): string {
  const parts: string[] = [];
  for (const [name, shared] of ydoc.share) {
    // Serialized through the shared type's own JSON view rather than an
    // `instanceof` test against this module's Yjs import. Yjs ships more than
    // one module instance in common setups (Hocuspocus and y-indexeddb each
    // import it themselves), and a root materialized from an applied update
    // then fails `instanceof` while still holding real content — which would
    // silently fingerprint it as empty.
    const serialized = serializeSharedType(shared);
    if (serialized === null) continue;
    parts.push(`${name}=${serialized}`);
  }
  return parts.sort().join("\n");
}

/**
 * Content view of one shared root, or null when it is not a shared type.
 *
 * Two content views, chosen by what the root can actually report rather than by
 * class: map/array/text roots serialize through `toJSON()`, and an XML root —
 * whose `toJSON()` may return null once it was materialized from an applied
 * update — serializes through `toString()`. Skipping the null case without
 * falling back would fingerprint a root full of content as empty, which is the
 * one way this comparison could delete something it should preserve.
 */
function serializeSharedType(shared: unknown): string | null {
  const candidate = shared as { toJSON?: unknown; toString?: unknown } | null;
  if (!candidate || typeof candidate !== "object") return null;
  if (typeof candidate.toJSON === "function") {
    let value: unknown = null;
    try {
      value = (candidate.toJSON as () => unknown)();
    } catch {
      value = null;
    }
    if (value !== null && value !== undefined) {
      try {
        return `json:${JSON.stringify(value)}`;
      } catch {
        // A cyclic projection is not a content view; fall through to the XML one.
      }
    }
  }
  if (typeof candidate.toString !== "function") return null;
  try {
    return `xml:${String((candidate.toString as () => string)())}`;
  } catch {
    return null;
  }
}

/** Cache namespaces this environment can see, or null when it cannot enumerate. */
async function listExistingCacheNames(): Promise<Set<string> | null> {
  const factory = globalThis.indexedDB as IDBFactory | undefined;
  if (!factory || typeof factory.databases !== "function") return null;
  try {
    const databases = await factory.databases();
    return new Set(
      databases
        .map((entry) => entry.name)
        .filter((name): name is string => typeof name === "string"),
    );
  } catch {
    // Enumeration is unavailable (a privacy mode, or an older engine). The
    // audit then inspects nothing: no copy is cleared, and — structurally — no
    // older copy is ever merged either, because the live attachment only ever
    // opens the current epoch's namespace.
    return null;
  }
}

/**
 * Reconciles older-epoch copies with the room that is now open.
 *
 * Runs ONLY after the current epoch's replay AND the network sync have both
 * landed, so the live document is the real content an older copy is compared
 * against. A copy is cleared only when it is proven to hold nothing the room
 * lacks — proven two ways, because a compaction rewrites history:
 *
 *   - the Yjs state it holds is already covered by the live document, or
 *   - its content fingerprint equals the live room's (a compacted rebuild).
 *
 * Everything else is preserved and reported. Nothing is ever merged.
 */
export async function auditEpochCaches(input: {
  documentName: string;
  stateEpoch: CoeditDecimalString;
  ydoc: Doc;
  window?: number;
}): Promise<CoeditStaleCacheAudit> {
  const audit: CoeditStaleCacheAudit = { discarded: [], divergent: [], inspected: false };
  const existing = await listExistingCacheNames();
  if (!existing) return audit;
  audit.inspected = true;

  const candidates = coeditStaleCacheNames(
    input.documentName,
    input.stateEpoch,
    input.window,
  ).filter((name) => existing.has(name));
  if (candidates.length === 0) return audit;

  const liveStateVector = Y.encodeStateVector(input.ydoc);
  const liveFingerprint = coeditContentFingerprint(input.ydoc);

  for (const cacheName of candidates) {
    const scratch = new Y.Doc();
    const persistence = new IndexeddbPersistence(cacheName, scratch);
    try {
      await persistence.whenSynced;
      const missing = Y.encodeStateAsUpdate(scratch, liveStateVector);
      const redundant =
        isStateUpdateEmpty(missing) || coeditContentFingerprint(scratch) === liveFingerprint;
      if (redundant) {
        await persistence.clearData();
        audit.discarded.push(cacheName);
        continue;
      }
      audit.divergent.push({
        cacheName,
        stateEpoch: epochOfCacheName(cacheName, input.documentName),
        updateBase64: toBase64(Y.encodeStateAsUpdate(scratch)),
        stateVectorBase64: toBase64(Y.encodeStateVector(scratch)),
      });
    } catch {
      // A copy that cannot be read is left exactly as it is. An unreadable copy
      // is not an empty one, and this is the only path that deletes local work.
    } finally {
      await persistence.destroy().catch(() => undefined);
      scratch.destroy();
    }
  }
  return audit;
}
