import { encodeStateVector, type Doc } from "yjs";

/**
 * The save-truth identity: the document's state vector, base64 encoded.
 *
 * "Saved" means "the server's committed state vector equals mine", so the
 * comparison is made on the vector itself. Two states with the same state
 * vector hold exactly the same content, and Yjs writes the vector with a
 * deterministic ordering (`writeStateVector` sorts by client id), which makes
 * byte equality a sound identity across the browser and the service.
 *
 * History note, kept because it is the reason no digest is involved: an earlier
 * build hashed this vector on the browser and compared the digest with the
 * service's `node:crypto` SHA-256. The two implementations agreed for most
 * lengths and silently disagreed for others, so a room could commit every edit
 * and still show "Saving…" forever with no way for the author to tell. A digest
 * adds a second implementation that can be wrong; the vector cannot be wrong.
 */

/** Standard base64 (padded alphabet), byte-identical to Node's Buffer. */
export function toBase64(bytes: Uint8Array): string {
  // State vectors are capped at 8 KiB by the service
  // (`authoringcoedit.MaxStateVectorBytes`), so one pass is enough: the vector
  // is never an argument list, and no spread/apply limit is at risk.
  let binary = "";
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index] ?? 0);
  }
  return btoa(binary);
}

/** Base64 of one document's current state vector. */
export function encodeStateVectorBase64(doc: Doc): string {
  return toBase64(encodeStateVector(doc));
}
