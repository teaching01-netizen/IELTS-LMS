import { parseAnyDocumentName } from "./documentIdentity";

/**
 * A request to make a room's current in-memory state durable now.
 *
 * The editor's Retry action sends this. Reconnecting the socket cannot make
 * local work durable: the service stores a document only when an update re-arms
 * its debounce, so a retry after a failed save used to need another keystroke
 * before anything was even attempted — the save area sat at "Still saving…"
 * with no store in flight. The frame is the one way a client can ask for the
 * work it already holds to be persisted.
 *
 * It carries no content and no identity claim: the connection is already
 * authenticated, the room is the one that connection opened, and the outcome is
 * reported through the ordinary `coedit.ack` / `coedit.save_failed` frames that
 * every store already produces. It is therefore idempotent — asking twice about
 * the same state is the same question — which is why callers key their outbound
 * queue by room instead of by request id.
 *
 * The vocabulary is shared by both halves rather than declared twice: the
 * service imports this module the same way it imports the seed and command
 * validators.
 */
export interface CoeditStoreRequestFrame {
  type: "coedit.store";
  documentName: string;
}

export interface ParseCoeditStoreRequestOptions {
  /** Bind a parsed frame to the room currently handled by the connection. */
  documentName?: string;
}

export const COEDIT_STORE_REQUEST_TYPE = "coedit.store";

/** A frame this small cannot be an attack surface; the cap is a sanity bound. */
export const MAX_COEDIT_STORE_REQUEST_BYTES = 512;

const FRAME_KEYS: readonly string[] = ["type", "documentName"];

function isRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  try {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

/**
 * Returns true only for a complete store request for a real room.
 *
 * A room the connection is not handling is refused here rather than at the
 * store: the request names a document, and accepting a foreign name would let
 * one room ask for another room's state to be committed.
 */
export function isCoeditStoreRequest(
  value: unknown,
  options: ParseCoeditStoreRequestOptions = {},
): value is CoeditStoreRequestFrame {
  if (!isRecord(value)) return false;
  if (Object.keys(value).some((key) => !FRAME_KEYS.includes(key))) return false;
  if (value["type"] !== COEDIT_STORE_REQUEST_TYPE) return false;
  const documentName = value["documentName"];
  if (
    typeof documentName !== "string" ||
    documentName !== documentName.trim() ||
    parseAnyDocumentName(documentName) === null
  ) return false;
  if (options.documentName !== undefined && documentName !== options.documentName) return false;
  return utf8Bytes(JSON.stringify(value)) <= MAX_COEDIT_STORE_REQUEST_BYTES;
}

/** Builds the request for one room. */
export function createCoeditStoreRequest(documentName: string): CoeditStoreRequestFrame {
  const frame: CoeditStoreRequestFrame = { type: COEDIT_STORE_REQUEST_TYPE, documentName };
  if (!isCoeditStoreRequest(frame)) throw new Error("Co-edit store request is not a valid room.");
  return frame;
}

/** Parses either a decoded frame or a wire JSON string. Invalid input is ignored. */
export function parseCoeditStoreRequest(
  raw: unknown,
  options: ParseCoeditStoreRequestOptions = {},
): CoeditStoreRequestFrame | null {
  let value: unknown = raw;
  if (typeof raw === "string") {
    if (utf8Bytes(raw) > MAX_COEDIT_STORE_REQUEST_BYTES) return null;
    try {
      value = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  return isCoeditStoreRequest(value, options) ? value : null;
}
