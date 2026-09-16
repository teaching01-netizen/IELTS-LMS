// Opaque document identity.
//
// The browser NEVER constructs a room name from raw identifiers: Go returns the
// fully-formed name, and these helpers only validate and compare it.
export const COEDIT_DOCUMENT_PREFIX = "coedit:v1:";
export const WORKSPACE_DOCUMENT_PREFIX = "coedit:v2:";
export const FIELD_SET_WORKSPACE = "workspace";

export interface ParsedDocumentName {
  documentName: string;
  documentId: string;
}

export interface ParsedAnyDocumentName extends ParsedDocumentName {
  schemaVersion: 1 | 2;
  fieldSet: "prompt" | "workspace";
}

export function parseCoeditDocumentName(raw: string): ParsedDocumentName | null {
  const name = raw.trim();
  if (!name.startsWith(COEDIT_DOCUMENT_PREFIX)) return null;
  const id = name.slice(COEDIT_DOCUMENT_PREFIX.length);
  if (!id || /[:/\s]/.test(id)) return null;
  return { documentName: name, documentId: id };
}

/** Migration-aware parser; the v1 parser above remains intentionally strict. */
export function parseAnyDocumentName(raw: unknown): ParsedAnyDocumentName | null {
  const prompt = typeof raw === "string" ? parseCoeditDocumentName(raw) : null;
  if (prompt) return { ...prompt, schemaVersion: 1, fieldSet: "prompt" };
  if (typeof raw !== "string") return null;
  const name = raw.trim();
  if (!name.startsWith(WORKSPACE_DOCUMENT_PREFIX)) return null;
  const documentId = name.slice(WORKSPACE_DOCUMENT_PREFIX.length);
  if (!documentId || /[:/\s]/.test(documentId)) return null;
  return { documentName: name, documentId, schemaVersion: 2, fieldSet: "workspace" };
}

