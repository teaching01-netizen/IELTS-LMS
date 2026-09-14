import { createHash } from "node:crypto";
import * as Y from "yjs";
import { prosemirrorJSONToYDoc, yDocToProsemirrorJSON } from "y-prosemirror";
import type { Schema } from "@tiptap/pm/model";
import {
  documentFromStructuredContent,
  getRichTextSchema,
  structuredContentFromDocument,
} from "./richTextSchema.js";
import {
  FIELD_SET_PROMPT,
  FIELD_SET_WORKSPACE,
  MAX_PROMPT_JSON_BYTES,
  MAX_YDOC_STATE_BYTES,
} from "./documentIdentity.js";
import type { StructuredContent } from "../../../src/features/exam-authoring/contracts/assessment.js";

/**
 * Seed and serialization boundary for the `prompt` fragment.
 *
 * Property under test: for every supported document,
 *
 *   HTTP JSON -> Y.Doc prompt fragment -> HTTP JSON
 *
 * preserves the canonical structured-content projection. That is only true
 * because both sides share one schema and one set of content transforms.
 */
let cachedSchema: Schema | null = null;

export function promptSchema(): Schema {
  cachedSchema ??= getRichTextSchema();
  return cachedSchema;
}

export class CodecError extends Error {
  readonly reason: string;
  constructor(reason: string, message: string) {
    super(message);
    this.name = "CodecError";
    this.reason = reason;
  }
}

/**
 * Seeds a brand-new Y.Doc from the current HTTP prompt.
 *
 * `xmlFragment` is the field name the browser binds (`prompt`), so a seeded
 * document and a browser-created fragment converge on the same root.
 */
export function seedYDocFromPrompt(prompt: unknown): Y.Doc {
  const schema = promptSchema();
  const richDocument = documentFromStructuredContent(
    prompt as Parameters<typeof documentFromStructuredContent>[0],
  );
  return prosemirrorJSONToYDoc(schema, richDocument, FIELD_SET_PROMPT);
}

/** Applies committed binary state onto a fresh Y.Doc. */
export function applyBinaryState(ydoc: Y.Doc, state: Uint8Array): void {
  Y.applyUpdate(ydoc, state);
}

export function encodeStateAsUpdate(ydoc: Y.Doc): Uint8Array {
  return Y.encodeStateAsUpdate(ydoc);
}

export function encodeStateVector(ydoc: Y.Doc): Uint8Array {
  return Y.encodeStateVector(ydoc);
}

/** SHA-256 over a state vector: the exact state a client may call Saved. */
export function hashStateVector(vector: Uint8Array): string {
  return createHash("sha256").update(vector).digest("hex");
}

export function currentStateHash(ydoc: Y.Doc): string {
  return hashStateVector(encodeStateVector(ydoc));
}

/** Canonical structured-content projection of the live fragment. */
export function projectPrompt(ydoc: Y.Doc): StructuredContent {
  const schema = promptSchema();
  const json = yDocToProsemirrorJSON(ydoc, FIELD_SET_PROMPT) as Parameters<
    typeof structuredContentFromDocument
  >[0];
  return structuredContentFromDocument(json);
}

/** JSON byte size of the projection (the materialized prompt is capped). */
export function projectPromptJson(ydoc: Y.Doc): string {
  const projected = projectPrompt(ydoc);
  const json = JSON.stringify(projected);
  if (Buffer.byteLength(json, "utf8") > MAX_PROMPT_JSON_BYTES) {
    throw new CodecError("coedit_oversized", "Prompt exceeds the materialized size limit.");
  }
  return json;
}

/**
 * Projects the scalar workspace root used by the browser bindings. Values are
 * JSON strings so Y.Map updates stay atomic and do not expose a mutable object
 * through a provider snapshot. Rich fields remain in their named XML
 * fragments; the map is the durable scalar/recovery projection.
 */
export function projectWorkspace(ydoc: Y.Doc): Record<string, unknown> {
  const root = ydoc.getMap<unknown>(FIELD_SET_WORKSPACE);
  const out: Record<string, unknown> = {};
  root.forEach((value, key) => {
    if (typeof value !== "string") {
      out[key] = value;
      return;
    }
    try {
      out[key] = JSON.parse(value) as unknown;
    } catch {
      // A malformed scalar is not allowed to poison the service projection.
    }
  });
  // Rich roots are named `rich:<field path>` so every editor can bind to its
  // own XML fragment while one exam still has one room. Include their
  // canonical JSON projection in the private workspace snapshot so a Go
  // materializer or recovery export can see the same content as the editor.
  for (const [name, shared] of ydoc.share) {
    if (!name.startsWith("rich:") || !(shared instanceof Y.XmlFragment)) continue;
    try {
      out[name] = structuredContentFromDocument(
        yDocToProsemirrorJSON(ydoc, name) as Parameters<typeof structuredContentFromDocument>[0],
      );
    } catch {
      // A malformed rich root is ignored at this projection boundary; the
      // persisted binary remains available for a later recovery inspection.
    }
  }
  return out;
}

export function projectWorkspaceJson(ydoc: Y.Doc): string {
  const json = JSON.stringify(projectWorkspace(ydoc));
  if (Buffer.byteLength(json, "utf8") > MAX_YDOC_STATE_BYTES) {
    throw new CodecError("coedit_oversized", "SAT authoring workspace is too large to save.");
  }
  return json;
}

export function assertStateWithinLimit(state: Uint8Array): void {
  if (state.byteLength > MAX_YDOC_STATE_BYTES) {
    throw new CodecError("coedit_oversized", "Collaboration state exceeds the persisted size limit.");
  }
}

export function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

export function fromBase64(value: string | null | undefined): Uint8Array | null {
  if (!value) return null;
  try {
    return new Uint8Array(Buffer.from(value, "base64"));
  } catch {
    return null;
  }
}
