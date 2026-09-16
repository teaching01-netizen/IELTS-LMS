import { createHash } from "node:crypto";
import * as Y from "yjs";
import { prosemirrorJSONToYDoc, prosemirrorJSONToYXmlFragment, yDocToProsemirrorJSON } from "y-prosemirror";
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
/**
 * Name prefix of a workspace room's rich roots (`rich:<field path>`). Kept here
 * because this module both projects them and rebuilds them: a mismatch would
 * silently drop a field from the recovery projection or from a rebuild.
 */
export const RICH_ROOT_PREFIX = "rich:";

/**
 * The root type a room's name implies, or null for a root this service does
 * not own.
 *
 * Why names and not `instanceof`: Yjs creates a root it meets while APPLYING
 * an update as a bare AbstractType placeholder, and only upgrades it to the
 * concrete class when something asks for it by class (`Doc.get`). So on a
 * document that was just loaded from binary, `shared instanceof Y.XmlFragment`
 * is FALSE for a fragment that is really there — and resolving the root with
 * the wrong class re-parents its items into a new type, i.e. corrupts it.
 * This service owns the naming contract (the workspace map, `rich:` fragments,
 * the v1 `prompt` fragment), so it resolves by name and reports anything else
 * as unverifiable instead of guessing.
 */
function rootKind(name: string): "xml" | "map" | null {
  if (name === FIELD_SET_WORKSPACE) return "map";
  if (name === FIELD_SET_PROMPT || name.startsWith(RICH_ROOT_PREFIX)) return "xml";
  return null;
}

let cachedSchema: Schema | null = null;

export function promptSchema(): Schema {
  cachedSchema ??= getRichTextSchema();
  return cachedSchema;
}

/**
 * The one size-refusal string. Mirrored from Go
 * (authoringcoedit.CodeOversized) so the browser sees the same reason whether
 * Go rejected the store or this service rejected it before the call.
 */
export const COEDIT_OVERSIZED_REASON = "coedit_oversized";

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
    throw new CodecError(COEDIT_OVERSIZED_REASON, "Prompt exceeds the materialized size limit.");
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
  for (const name of ydoc.share.keys()) {
    if (rootKind(name) !== "xml") continue;
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
    throw new CodecError(COEDIT_OVERSIZED_REASON, "SAT authoring workspace is too large to save.");
  }
  return json;
}

export function assertStateWithinLimit(state: Uint8Array): void {
  if (state.byteLength > MAX_YDOC_STATE_BYTES) {
    throw new CodecError(COEDIT_OVERSIZED_REASON, "Collaboration state exceeds the persisted size limit.");
  }
}

/**
 * Rebuilds a workspace room's document from its own workspace projection.
 *
 * The inverse of `projectWorkspace`, and the reason that projection is stored:
 * scalars go back into the workspace map as the JSON strings the browser
 * writes, and each `rich:<field path>` entry is written into the same named
 * root through the same schema. Every value ends up authored by the ONE client
 * id of the returned document, which is what bounds the room's state vector to
 * its number of fields instead of its number of author sessions.
 */
export function rebuildWorkspaceDocument(projection: Record<string, unknown>): Y.Doc {
  const schema = promptSchema();
  const doc = new Y.Doc();
  const root = doc.getMap<unknown>(FIELD_SET_WORKSPACE);
  doc.transact(() => {
    for (const [key, value] of Object.entries(projection)) {
      if (key.startsWith(RICH_ROOT_PREFIX)) {
        prosemirrorJSONToYXmlFragment(
          schema,
          documentFromStructuredContent(
            value as Parameters<typeof documentFromStructuredContent>[0],
          ),
          doc.getXmlFragment(key),
        );
        continue;
      }
      root.set(key, JSON.stringify(value) ?? "null");
    }
  }, "coedit-compaction");
  return doc;
}

/**
 * Canonical content signature of a document, or null when the document holds a
 * root this boundary cannot compare.
 *
 * Compaction replaces a document with a rebuild of its projection, so the
 * rebuild has to be PROVEN equivalent first. Each root is compared at the
 * boundary the rest of the system reads:
 *
 *   - an XML fragment by its CANONICAL projection, because that projection is
 *     what Go materializes and publishes. Comparing raw fragment JSON instead
 *     would be stricter than the contract (a browser fragment without generated
 *     content identities differs from its own projection) and would refuse
 *     compaction for every real room, while comparing nothing at all would drop
 *     author-visible content.
 *   - a map by its RAW values, because the projection deliberately drops a value
 *     that is not JSON: that value is still visible to the browser, so it must
 *     make the comparison fail rather than silently disappear.
 *
 * An unknown root type yields null, which skips compaction instead of risking
 * content nobody projected.
 */
export function contentSignature(ydoc: Y.Doc): string | null {
  const parts: string[] = [];
  for (const name of ydoc.share.keys()) {
    const kind = rootKind(name);
    if (kind === null) return null;
    if (kind === "xml") {
      const projection = structuredContentFromDocument(
        yDocToProsemirrorJSON(ydoc, name) as Parameters<typeof structuredContentFromDocument>[0],
      );
      parts.push(`${name}\u0000xml\u0000${JSON.stringify(projection)}`);
      continue;
    }
    const entries: string[] = [];
    ydoc.getMap(name).forEach((value, key) => {
      entries.push(`${JSON.stringify(key)}=${JSON.stringify(value) ?? "null"}`);
    });
    parts.push(`${name}\u0000map\u0000${entries.sort().join("\u0001")}`);
  }
  return parts.sort().join("\u0002");
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
