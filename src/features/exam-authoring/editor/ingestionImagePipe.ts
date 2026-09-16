/**
 * Phase 06 — clipboard image glue (TipTap allowed, React forbidden).
 *
 * Split-surface rule: this module lives OUTSIDE ingestion/ so it may import
 * TipTap/ProseMirror types, but it must not import React. Pure validation,
 * attr builders, and the strip guard live in
 * ingestion/adapters/imageValidation.ts; this file only runs editor
 * transactions, the background upload runner, and the objectURL registry.
 *
 * Flow: pasteClipboardImage validates -> inserts ONE temp image node (single
 * history entry = the paste) -> background upload via injected upload fn
 * (default uploadAssessmentAsset) -> swap temp attrs for the real asset with
 * addToHistory:false so the whole paste stays ONE undo step (B8). Failures
 * stay inline on the node (retry/remove), never toasts, never block typing.
 *
 * Alt text is captured from the ingestion result when available, trimmed into
 * the transient node, and retained when the upload resolves. Empty alt text is
 * still allowed at staging time; the existing sat.accessibility.alt.required
 * validator blocks publish until the author fills it via the toolbar flow.
 *
 * allowBase64:false invariant: the objectURL in a temp node is transient and
 * is stripped by stripTransientImages* before persist. Every registry create
 * has exactly one revoke on every path (swap / remove / missing-node /
 * destroy).
 */
import type { Editor, JSONContent } from "@tiptap/react";
import type { Node as PMNode } from "@tiptap/pm/model";
import { uploadAssessmentAsset } from "../api/assessmentMediaApi";
import {
  buildResolvedImageAttrs,
  buildTransientImageAttrs,
  validateSatImageFile,
  type BitmapLoader,
  type ImageRejectCode,
} from "./ingestion/adapters/imageValidation";

export interface PastedImageHandle {
  uploadId: string;
  objectUrl: string;
}

export type PasteClipboardImageResult =
  | { status: "rejected"; code: ImageRejectCode; message: string }
  | { status: "accepted"; handle: PastedImageHandle };

export type PreparedClipboardImageResult =
  | Extract<PasteClipboardImageResult, { status: "rejected" }>
  | {
      status: "accepted";
      handle: PastedImageHandle;
      node: JSONContent;
      startUpload: () => void;
      discard: () => void;
    };

export interface IngestionImagePipeDeps {
  validate?: typeof validateSatImageFile | undefined;
  upload?: typeof uploadAssessmentAsset | undefined;
  createObjectUrl?: ((file: File) => string) | undefined;
  revokeObjectUrl?: ((url: string) => void) | undefined;
  makeUploadId?: (() => string) | undefined;
  loader?: BitmapLoader | null | undefined;
}

export const TRANSIENT_UPLOAD_COPY = {
  uploadingNote: "Uploading… — alt text will be required before publish.",
  failedNote: "Upload failed — Retry / Remove. Alt text still required before publish.",
} as const;

interface RegistryEntry {
  file: File;
  objectUrl: string;
  ownerId: string;
  editor: Editor;
  upload: typeof uploadAssessmentAsset;
  revokeObjectUrl: (url: string) => void;
  attempts: number;
  settled: boolean;
}

const registry = new Map<string, RegistryEntry>();
let activeUploads = 0;
const pendingQueue: string[] = [];
const MAX_CONCURRENT_UPLOADS = 3;

function defaultCreateObjectUrl(file: File): string {
  return URL.createObjectURL(file);
}

function defaultRevokeObjectUrl(url: string): void {
  URL.revokeObjectURL(url);
}

function defaultMakeUploadId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "upload-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

interface ResolvedPipeDeps {
  validate: IngestionImagePipeDeps["validate"];
  upload: IngestionImagePipeDeps["upload"];
  loader: IngestionImagePipeDeps["loader"];
  createObjectUrl: (file: File) => string;
  revokeObjectUrl: (url: string) => void;
  makeUploadId: () => string;
}

function resolveDeps(deps: IngestionImagePipeDeps | undefined): ResolvedPipeDeps {
  return {
    validate: deps?.validate ?? validateSatImageFile,
    upload: deps?.upload,
    loader: deps?.loader,
    createObjectUrl: deps?.createObjectUrl ?? defaultCreateObjectUrl,
    revokeObjectUrl: deps?.revokeObjectUrl ?? defaultRevokeObjectUrl,
    makeUploadId: deps?.makeUploadId ?? defaultMakeUploadId,
  };
}

/**
 * Find a transient image by uploadId. Positions shift on every edit so the
 * caller must re-resolve on each use — NEVER cache pos across awaits.
 */
export function findTransientPos(doc: PMNode, uploadId: string): number | null {
  let found: number | null = null;
  doc.descendants((node, pos) => {
    if (found != null) return false;
    if (
      node.type.name === "image" &&
      (node.attrs as Record<string, unknown>)["uploadId"] === uploadId
    ) {
      found = pos;
      return false;
    }
    return undefined;
  });
  return found;
}

function readImageAttrs(editor: Editor, pos: number): Record<string, unknown> | null {
  const node = editor.state.doc.nodeAt(pos);
  if (!node || node.type.name !== "image") return null;
  return { ...(node.attrs as Record<string, unknown>) };
}

/**
 * Raw-transaction attr swap. updateAttributes() in this TipTap version takes
 * no options argument, so addToHistory:false rides a manually built tr: the
 * history plugin maps the change without adding an undo entry, which keeps
 * the whole paste a single undo step.
 */
function swapAttributesNoHistory(
  editor: Editor,
  pos: number,
  attrs: Record<string, unknown>
): void {
  if (editor.isDestroyed) return;
  const node = editor.state.doc.nodeAt(pos);
  if (!node || node.type.name !== "image") return;
  const tr = editor.state.tr.setNodeMarkup(pos, undefined, {
    ...(node.attrs as Record<string, unknown>),
    ...attrs,
  });
  tr.setMeta("addToHistory", false);
  editor.view.dispatch(tr);
}

function failTransientNode(editor: Editor, uploadId: string, message: string): void {
  const pos = findTransientPos(editor.state.doc, uploadId);
  if (pos == null) return;
  swapAttributesNoHistory(editor, pos, { uploadError: message, uploading: false });
}

function pumpQueue(): void {
  while (activeUploads < MAX_CONCURRENT_UPLOADS && pendingQueue.length > 0) {
    const next = pendingQueue.shift();
    if (next == null) return;
    const entry = registry.get(next);
    if (!entry || entry.settled) continue;
    void runUpload(next, entry);
  }
}

async function runUpload(uploadId: string, entry: RegistryEntry): Promise<void> {
  activeUploads += 1;
  entry.attempts += 1;
  try {
    const asset = await entry.upload(entry.file, entry.ownerId);
    if (entry.settled) return;
    const { editor } = entry;
    if (editor.isDestroyed) {
      entry.settled = true;
      registry.delete(uploadId);
      entry.revokeObjectUrl(entry.objectUrl);
      return;
    }
    const pos = findTransientPos(editor.state.doc, uploadId);
    if (pos == null) {
      // User deleted the temp node mid-upload: revoke + no-op, no crash.
      entry.settled = true;
      registry.delete(uploadId);
      entry.revokeObjectUrl(entry.objectUrl);
      return;
    }
    swapAttributesNoHistory(editor, pos, {
      ...buildResolvedImageAttrs(asset, entry.objectUrl),
    });
    entry.settled = true;
    registry.delete(uploadId);
    entry.revokeObjectUrl(entry.objectUrl);
  } catch (error) {
    if (entry.settled) return;
    const message =
      error instanceof Error && error.message ? error.message : "Image upload failed.";
    if (!entry.editor.isDestroyed) failTransientNode(entry.editor, uploadId, message);
    // Keep the registry entry so retry can re-upload the SAME File.
  } finally {
    activeUploads = Math.max(0, activeUploads - 1);
    pumpQueue();
  }
}

function enqueueUpload(uploadId: string): void {
  if (!pendingQueue.includes(uploadId)) pendingQueue.push(uploadId);
  pumpQueue();
}

/**
 * Prepare a validated image without dispatching. The caller can insert prose
 * and all image nodes in one transaction, then start uploads. Failed/abandoned
 * insertions must discard their prepared images to release the object URLs.
 */
export async function prepareClipboardImage(
  editor: Editor,
  file: File,
  ownerId: string,
  deps?: IngestionImagePipeDeps,
  alt = ""
): Promise<PreparedClipboardImageResult> {
  const resolved = resolveDeps(deps);
  const validate = resolved.validate ?? validateSatImageFile;
  const validation =
    resolved.loader !== undefined
      ? await validate(file, { loader: resolved.loader })
      : await validate(file);
  if (!validation.ok) {
    return { status: "rejected", code: validation.code, message: validation.message };
  }
  if (editor.isDestroyed) {
    return {
      status: "rejected",
      code: "decode",
      message: "The editor was closed before the image could be inserted.",
    };
  }
  const uploadId = resolved.makeUploadId();
  const objectUrl = resolved.createObjectUrl(file);
  const upload = resolved.upload ?? uploadAssessmentAsset;
  const entry: RegistryEntry = {
    file,
    objectUrl,
    ownerId,
    editor,
    upload,
    revokeObjectUrl: resolved.revokeObjectUrl,
    attempts: 0,
    settled: false,
  };
  registry.set(uploadId, entry);
  let started = false;
  const discard = (): void => {
    if (entry.settled) return;
    entry.settled = true;
    registry.delete(uploadId);
    entry.revokeObjectUrl(objectUrl);
  };
  return {
    status: "accepted",
    handle: { uploadId, objectUrl },
    node: { type: "image", attrs: buildTransientImageAttrs(uploadId, objectUrl, alt) },
    discard,
    startUpload: () => {
      if (started || entry.settled) return;
      if (editor.isDestroyed || findTransientPos(editor.state.doc, uploadId) == null) {
        discard();
        return;
      }
      started = true;
      enqueueUpload(uploadId);
    },
  };
}

/** Standalone image insertion, sharing preparation with atomic mixed pastes. */
export async function pasteClipboardImage(
  editor: Editor,
  file: File,
  ownerId: string,
  deps?: IngestionImagePipeDeps,
  alt = ""
): Promise<PasteClipboardImageResult> {
  const prepared = await prepareClipboardImage(editor, file, ownerId, deps, alt);
  if (prepared.status === "rejected") return prepared;
  // Insert at the cursor. Exception: when the selection is a NodeSelection
  // on one of our own transient images (the state left behind by a previous
  // paste), insert AFTER it — otherwise insertContent would replace the
  // still-uploading node and sequential pastes would clobber each other.
  const selection = editor.state.selection as unknown as {
    node?: { type: { name: string }; attrs: Record<string, unknown> };
    to: number;
  };
  const onOwnTransient =
    selection.node?.type.name === "image" && typeof selection.node.attrs["uploadId"] === "string";
  try {
    const inserted = onOwnTransient
      ? editor.chain().insertContentAt(selection.to, prepared.node).run()
      : editor.chain().insertContent(prepared.node).run();
    if (!inserted) throw new Error("Image insertion was rejected by the editor.");
    prepared.startUpload();
    return { status: "accepted", handle: prepared.handle };
  } catch (error) {
    prepared.discard();
    throw error;
  }
}

/**
 * Re-run the upload for the SAME File after a failure. Pos is re-resolved
 * (never cached) and the error flag is cleared with addToHistory:false so
 * retry does not add undo steps.
 */
export async function retryTransientUpload(
  editor: Editor,
  uploadId: string,
  ownerId: string,
  deps?: IngestionImagePipeDeps
): Promise<void> {
  const entry = registry.get(uploadId);
  if (!entry) return;
  entry.ownerId = ownerId;
  if (deps?.upload) entry.upload = deps.upload;
  if (deps?.revokeObjectUrl) entry.revokeObjectUrl = deps.revokeObjectUrl;
  entry.settled = false;
  const pos = findTransientPos(editor.state.doc, uploadId);
  if (pos != null) swapAttributesNoHistory(editor, pos, { uploadError: null, uploading: true });
  enqueueUpload(uploadId);
}

/**
 * User-visible delete: normal history entry (undo restores the temp node),
 * plus exactly-once URL revoke and registry cleanup.
 */
export function removeTransientImage(
  editor: Editor,
  uploadId: string,
  deps?: Pick<IngestionImagePipeDeps, "revokeObjectUrl">
): void {
  const entry = registry.get(uploadId);
  const revoke = deps?.revokeObjectUrl ?? entry?.revokeObjectUrl ?? defaultRevokeObjectUrl;
  const pos = findTransientPos(editor.state.doc, uploadId);
  if (pos != null) {
    editor.chain().setNodeSelection(pos).deleteSelection().run();
  }
  if (entry) {
    entry.settled = true;
    registry.delete(uploadId);
    revoke(entry.objectUrl);
  }
  const queueIndex = pendingQueue.indexOf(uploadId);
  if (queueIndex >= 0) pendingQueue.splice(queueIndex, 1);
}

/**
 * Pre-save/autosave integration: strip every transient image from the live
 * editor (revoking its URL) so no blob:/data: URI can persist. Returns the
 * dropped count for a non-blocking readiness warning. Phase 01/07 wires the
 * call; this phase exports and unit-tests it.
 */
export function stripTransientImagesFromEditor(editor: Editor): number {
  let dropped = 0;
  for (const [uploadId, entry] of [...registry]) {
    if (entry.editor !== editor) continue;
    const pos = findTransientPos(editor.state.doc, uploadId);
    if (pos == null) continue;
    const attrs = readImageAttrs(editor, pos);
    const src = attrs?.["src"];
    const uploading = attrs?.["uploading"] === true;
    const hasAsset = attrs?.["assetId"] != null;
    const transientSrc = typeof src === "string" && /^(blob:|data:)/i.test(src);
    if (uploading || (!hasAsset && transientSrc)) {
      // Strip is a save-guard mutation, not a user edit: keep it out of undo.
      const tr = editor.state.tr.delete(pos, pos + 1);
      tr.setMeta("addToHistory", false);
      editor.view.dispatch(tr);
      dropped += 1;
    }
  }
  // Also sweep resolved-doc leftovers that lost their registry entry (for
  // example after a hot reload): any blob:/data: image without assetId goes.
  const leftovers: number[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name !== "image") return undefined;
    const attrs = node.attrs as Record<string, unknown>;
    if (attrs["assetId"] != null) return undefined;
    if (attrs["uploading"] === true) return undefined;
    const src = attrs["src"];
    if (typeof src === "string" && /^(blob:|data:)/i.test(src)) leftovers.push(pos);
    return undefined;
  });
  for (const pos of leftovers.reverse()) {
    const tr = editor.state.tr.delete(pos, pos + 1);
    tr.setMeta("addToHistory", false);
    editor.view.dispatch(tr);
    dropped += 1;
  }
  // Revoke + clear registry entries for this editor.
  for (const [uploadId, entry] of [...registry]) {
    if (entry.editor !== editor) continue;
    if (findTransientPos(editor.state.doc, uploadId) == null) {
      entry.settled = true;
      registry.delete(uploadId);
      entry.revokeObjectUrl(entry.objectUrl);
      const queueIndex = pendingQueue.indexOf(uploadId);
      if (queueIndex >= 0) pendingQueue.splice(queueIndex, 1);
    }
  }
  return dropped;
}

/**
 * Editor-destroy hook: revoke all live URLs for this editor and settle the
 * queue so in-flight promises resolve silently without touching a destroyed
 * editor.
 */
export function destroyTransientUploads(editor: Editor): void {
  for (const [uploadId, entry] of [...registry]) {
    if (entry.editor !== editor) continue;
    entry.settled = true;
    registry.delete(uploadId);
    try {
      entry.revokeObjectUrl(entry.objectUrl);
    } catch {
      // Revoke must never throw during teardown.
    }
    const queueIndex = pendingQueue.indexOf(uploadId);
    if (queueIndex >= 0) pendingQueue.splice(queueIndex, 1);
  }
}

/** Test-only: reset module queue/registry between cases. */
export function __resetImagePipeForTests(): void {
  registry.clear();
  pendingQueue.length = 0;
  activeUploads = 0;
}

/** Test-only: inspect queue depth without exposing the registry. */
export function __imagePipeQueueDepthForTests(): {
  active: number;
  pending: number;
  tracked: number;
} {
  return { active: activeUploads, pending: pendingQueue.length, tracked: registry.size };
}
