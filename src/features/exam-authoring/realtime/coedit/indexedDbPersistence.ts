import { IndexeddbPersistence } from "y-indexeddb";
import type { Doc } from "yjs";

/**
 * Local crash/offline recovery for one collaborative prompt.
 *
 * Attached with the OPAQUE document name, so a replaced draft (which gets a
 * new document) can never merge into the new room's local cache: the identity
 * IS the isolation boundary.
 *
 * Deletion is explicit. Local state is deleted only after a matching committed
 * state hash or an explicit user discard, never automatically on disconnect —
 * an offline author's work must survive a refresh.
 */
export interface CoeditLocalPersistence {
  whenSynced: Promise<void>;
  /** True once IndexedDB has replayed its local copy into the Y.Doc. */
  readonly localSynced: boolean;
  /** Deletes this document's local cache (explicit discard only). */
  destroy: () => Promise<void>;
}

export function attachIndexedDbPersistence(
  documentName: string,
  ydoc: Doc,
): CoeditLocalPersistence {
  let localSynced = false;
  const persistence = new IndexeddbPersistence(documentName, ydoc);
  const whenSynced = persistence.whenSynced.then(() => {
    localSynced = true;
  });
  return {
    whenSynced,
    get localSynced() {
      return localSynced;
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
