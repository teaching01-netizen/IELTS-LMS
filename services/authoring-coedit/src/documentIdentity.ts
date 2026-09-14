/**
 * Opaque document identity.
 *
 * The service NEVER derives a room from client-supplied identifiers: it parses
 * the frozen opaque name, and separately requires the signed token's
 * `documentName` to equal the requested name (see authToken.ts).
 */
export const DOCUMENT_PREFIX = "coedit:v1:";
export const WORKSPACE_DOCUMENT_PREFIX = "coedit:v2:";

export const SCHEMA_VERSION = 1;
export const FIELD_SET_PROMPT = "prompt";
export const FIELD_SET_WORKSPACE = "workspace";

/** Size limits, mirrored from the Go package (authoringcoedit/identity.go). */
export const MAX_YDOC_STATE_BYTES = 4 << 20;
export const MAX_PROMPT_JSON_BYTES = 1 << 20;
export const MAX_FRAME_BYTES = 2 << 20;

export interface ParsedDocumentName {
  documentName: string;
  documentId: string;
}

export interface ParsedAnyDocumentName extends ParsedDocumentName {
  schemaVersion: 1 | 2;
  fieldSet: "prompt" | "workspace";
}

export function parseDocumentName(raw: unknown): ParsedDocumentName | null {
  if (typeof raw !== "string") return null;
  const name = raw.trim();
  if (!name.startsWith(DOCUMENT_PREFIX)) return null;
  const documentId = name.slice(DOCUMENT_PREFIX.length);
  if (!documentId) return null;
  if (/[:/\s]/.test(documentId)) return null;
  return { documentName: name, documentId };
}

/** Migration-aware parser. The old parser stays v1-only for compatibility. */
export function parseAnyDocumentName(raw: unknown): ParsedAnyDocumentName | null {
  const prompt = parseDocumentName(raw);
  if (prompt) return { ...prompt, schemaVersion: 1, fieldSet: FIELD_SET_PROMPT };
  if (typeof raw !== "string") return null;
  const name = raw.trim();
  if (!name.startsWith(WORKSPACE_DOCUMENT_PREFIX)) return null;
  const documentId = name.slice(WORKSPACE_DOCUMENT_PREFIX.length);
  if (!documentId || /[:/\s]/.test(documentId)) return null;
  return { documentName: name, documentId, schemaVersion: 2, fieldSet: FIELD_SET_WORKSPACE };
}

export function sameDocumentName(a: unknown, b: unknown): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  return a.trim() === b.trim();
}

export function isWithinFrameLimit(payloadBytes: number): boolean {
  return payloadBytes <= MAX_FRAME_BYTES;
}
