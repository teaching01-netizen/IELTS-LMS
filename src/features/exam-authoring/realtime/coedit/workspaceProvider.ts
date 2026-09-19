import {
  prosemirrorJSONToYXmlFragment,
  yDocToProsemirrorJSON,
} from "y-prosemirror";
import * as Y from "yjs";
import type { RichComposerCollaboration } from "../../editor/RichQuestionComposer";
import {
  documentFromStructuredContent,
  structuredContentFromDocument,
} from "../../editor/richContent";
import { getRichTextSchema } from "../../editor/schema/richTextSchema";
import type { StructuredContent } from "../../contracts/assessment";
import type { CollaborationParticipant } from "../../ui/collaboration/collaborationParticipants";
import { participantFromCoedit, selfParticipant } from "../../ui/collaboration/collaborationParticipants";
import type {
  CoeditConnectionPhase,
  CoeditDecimalString,
  CoeditFlushResult,
  CoeditLifecycleIssue,
  CoeditLifecyclePhase,
  CoeditSaveState,
  CoeditStaleCacheExport,
} from "./contracts";
import { FIELD_SET_WORKSPACE } from "./documentIdentity";
import { collaborationExtensions } from "./editorBinding";
import {
  PromptCoeditProvider,
  type CoeditChangeReason,
  type CoeditSeedDeliveryState,
  type PromptCoeditSnapshot,
} from "./provider";
import {
  createSatWorkspaceCommand,
  type SatWorkspaceCommand,
  type SatWorkspaceCommandName,
} from "./workspaceCommands";
import {
  createWorkspaceSeedFrame,
  type WorkspaceSeedFrame,
  type WorkspaceSeedOutcome,
  type WorkspaceSeedRoot,
} from "./workspaceSeed";

export type WorkspaceCoeditingStatus = "disabled" | "preparing" | "ready" | "error";

export interface WorkspaceCoeditSnapshot {
  /** The room reached initial sync. */
  ready: boolean;
  /**
   * IndexedDB replayed (or the bounded grace period expired). Read together
   * with `ready`, this is the barrier a seed proposal may not cross.
   */
  localReady: boolean;
  connectionPhase: CoeditConnectionPhase;
  hasEstablishedConnection: boolean;
  lifecyclePhase: CoeditLifecyclePhase;
  pendingSince?: number;
  lastAckedRevision?: string;
  /** Durable compaction epoch, advanced by acknowledgements. */
  stateEpoch?: string;
  /** Newest durable commit sequence this tab has been acknowledged for. */
  commitSequence?: string;
  readOnly: boolean;
  /** The token grants write (see `PromptCoeditSnapshot.writeCapable`). */
  writeCapable: boolean;
  saveState: CoeditSaveState;
  participants: CollaborationParticipant[];
  values: Record<string, unknown>;
  commands: SatWorkspaceCommand[];
  issue: CoeditLifecycleIssue;
  issueMessage: string | null;
  published: boolean;
  /**
   * Seed outcomes the room reported, keyed by workspace path. Absent while
   * every proposal is outstanding or applied.
   *
   * A field whose seed was refused can never become hydrated, so this is the
   * fact that lets its editor stop waiting and offer recovery instead.
   */
  seedFailures?: Record<string, { outcome: WorkspaceSeedOutcome; retryable: boolean }>;
  /**
   * How far each seed proposal got on its way to the room, by workspace path.
   *
   * The arbitration half (`seedFailures`) says what the room decided; this half
   * says whether the proposal ever reached it. Without both, "this field never
   * initialized" has no cause an author or an engineer can act on.
   */
  seedDeliveries?: Record<string, CoeditSeedDeliveryState>;
}

export interface WorkspaceFieldBinding extends RichComposerCollaboration {
  fieldPath: string;
}

export interface WorkspaceRecovery {
  issue: ReturnType<PromptCoeditProvider["snapshot"]>["issue"];
  message: string | null;
  published?: boolean;
  canExport: boolean;
  exportPrompt: () => unknown | null;
  exportWorkspace: () => Record<string, unknown>;
  discardLocal: () => Promise<void>;
  /** Preserved pre-compaction copies: exportable, discarded only on request. */
  canExportStaleCache: boolean;
  exportStaleCache: () => CoeditStaleCacheExport[] | null;
  discardStaleCache: () => Promise<void>;
  reload: () => void;
}

export interface WorkspaceProviderDeps {
  /**
   * Projects one shared rich-text root into the value the UI reads. Injected so
   * a caller can observe or replace the expensive per-fragment ProseMirror
   * conversion; the default is the shipped conversion.
   */
  projectRichFragment?: (ydoc: Y.Doc, rootName: string) => unknown;
}

const RICH_ROOT_PREFIX = "rich:";

/**
 * Whether a shared rich root has ever been written to.
 *
 * A root is ALLOCATED the moment anything asks the document for it — a field
 * binding, a recovery export, a projection pass — and an allocated root is not
 * an initialized one. Projecting the two as if they were the same published an
 * empty document for a question nobody had seeded yet, and that empty value
 * then replaced the HTTP question the author was looking at (the "sidebar has
 * content but the editor is blank" state).
 *
 * The shipped structured-content contract always writes at least the
 * document's own paragraph, so a root its owner has initialized is never
 * zero-length: an empty paragraph is a real, author-made blank and stays
 * authoritative. `root allocated ≠ root initialized`.
 */
export function isInitializedRichRoot(shared: unknown): boolean {
  return shared instanceof Y.XmlFragment && shared.length > 0;
}

/**
 * The typed fragment behind one `rich:` entry of `ydoc.share`, or null when the
 * entry is not a rich root at all.
 *
 * A root that arrives from the room BEFORE anything in this tab asked the
 * document for it — which is every root of every question this tab has not
 * opened an editor on yet — is materialized by Yjs as a bare placeholder
 * `AbstractType`, not an `XmlFragment`. `Doc.get` upgrades that placeholder in
 * place on the first typed access and keeps its content. Reading the share map
 * with a plain `instanceof` skipped exactly those roots, so a question the room
 * already held was never projected, never counted as hydrated, and its seed
 * proposal bailed out on a populated fragment without recording anything: the
 * field sat on "the shared copy was never requested" until some unrelated
 * change made the room re-publish.
 */
function materializeRichRoot(ydoc: Y.Doc, name: string, shared: unknown): Y.XmlFragment | null {
  if (shared instanceof Y.XmlFragment) return shared;
  // Only a placeholder may be upgraded. A root defined with another concrete
  // type under a `rich:` name is a foreign shape and stays out of the projection.
  if (!(shared instanceof Y.AbstractType) || shared.constructor !== Y.AbstractType) return null;
  try {
    return ydoc.getXmlFragment(name);
  } catch {
    return null;
  }
}

/** The shipped projection: a shared fragment read back as structured content. */
function projectRichFragmentFromDocument(ydoc: Y.Doc, rootName: string): unknown {
  return structuredContentFromDocument(
    yDocToProsemirrorJSON(ydoc, rootName) as Parameters<typeof structuredContentFromDocument>[0],
  );
}

function sameParticipants(
  left: readonly CollaborationParticipant[],
  right: readonly CollaborationParticipant[],
): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index];
    const b = right[index];
    if (
      !a ||
      !b ||
      a.id !== b.id ||
      a.displayName !== b.displayName ||
      a.initials !== b.initials ||
      a.color !== b.color ||
      a.state !== b.state ||
      a.isSelf !== b.isSelf ||
      a.selectedQuestionId !== b.selectedQuestionId
    ) return false;
  }
  return true;
}

/**
 * One exam-level Hocuspocus room. The class deliberately contains the Yjs
 * details so routes/editors only see scalar values and opaque rich bindings.
 */
export class SatAuthoringWorkspaceProvider {
  readonly documentName: string;
  private readonly core: PromptCoeditProvider;
  private readonly values = new Map<string, unknown>();
  private readonly commands = new Map<string, SatWorkspaceCommand>();
  private readonly fieldBindings = new Map<string, WorkspaceFieldBinding>();
  private activeQuestionId: string | null = null;
  private readonly projectRichFragment: (ydoc: Y.Doc, rootName: string) => unknown;
  /** Last successful projection per shared rich root, keyed by root name. */
  private readonly richProjections = new Map<string, unknown>();
  /** Rich roots whose content moved since the cached projection was taken. */
  private readonly richDirty = new Set<string>();
  private readonly richObservers = new Map<string, () => void>();
  private publishedValues: Record<string, unknown> = {};
  private lastPublished: WorkspaceCoeditSnapshot | null = null;

  constructor(input: {
    documentName: string;
    serviceUrl: string;
    token: { token: string; expiresAt: number };
    self: { actorId: string; displayName: string };
    readOnly: boolean;
    refreshToken: () => Promise<{ token: string; expiresAt: number }>;
    onLifecycle?: (issue: CoeditLifecycleIssue, message: string | null) => void;
    /** Durable compaction epoch from the token; absent means epoch zero. */
    stateEpoch?: CoeditDecimalString;
  }, deps: WorkspaceProviderDeps = {}) {
    this.documentName = input.documentName;
    this.projectRichFragment = deps.projectRichFragment ?? projectRichFragmentFromDocument;
    this.core = new PromptCoeditProvider({
      documentName: input.documentName,
      field: FIELD_SET_WORKSPACE,
      serviceUrl: input.serviceUrl,
      token: input.token,
      self: input.self,
      readOnly: input.readOnly,
      refreshToken: input.refreshToken,
      ...(input.stateEpoch === undefined ? {} : { stateEpoch: input.stateEpoch }),
      ...(input.onLifecycle ? { onLifecycle: input.onLifecycle } : {}),
      onWorkspaceCommand: (command) => {
        this.commands.set(command.commandId, command);
        // Keep stateless history bounded for a long-lived authoring tab. The
        // command is only a cache-invalidation signal, not workspace content.
        while (this.commands.size > 128) {
          const oldest = [...this.commands.values()].sort((left, right) => left.createdAt - right.createdAt)[0];
          if (!oldest) break;
          this.commands.delete(oldest.commandId);
        }
      },
    });
    this.publishedValues = this.readValues();
  }

  get ydoc(): Y.Doc {
    return this.core.ydoc;
  }

  get session() {
    return this.core.session;
  }

  subscribe(listener: (snapshot: WorkspaceCoeditSnapshot) => void): () => void {
    return this.core.subscribe((snapshot, reason) => {
      const participants = this.participants(snapshot);
      if (
        reason === "presence" &&
        this.lastPublished !== null &&
        sameParticipants(participants, this.lastPublished.participants)
      ) {
        // An awareness frame that changes nothing a reader can see: every
        // remote caret move, and most local ones. Dropping it leaves the
        // workspace untouched instead of re-rendering every consumer for a
        // cursor.
        return;
      }
      const next = this.build(snapshot, participants, reason);
      this.lastPublished = next;
      listener(next);
    });
  }

  snapshot(
    coreSnapshot = this.core.snapshot(),
    reason: CoeditChangeReason = "content",
  ): WorkspaceCoeditSnapshot {
    return this.build(coreSnapshot, this.participants(coreSnapshot), reason);
  }

  private participants(coreSnapshot: PromptCoeditSnapshot): CollaborationParticipant[] {
    const self = selfParticipant(
      this.core.self,
      this.core.self.actorId,
      this.activeQuestionId,
      coreSnapshot.readOnly || coreSnapshot.lifecyclePhase !== "active" ? "viewing" : "editing",
    );
    const participants = new Map<string, CollaborationParticipant>([[self.id, self]]);
    for (const entry of coreSnapshot.collaborators) {
      // A remote room participant is real even when their surface does not
      // publish a question target. Never infer that they are editing the
      // question open in this browser.
      const participant = participantFromCoedit(entry, entry.selectedQuestionId);
      if (!participants.has(participant.id)) participants.set(participant.id, participant);
    }
    return [...participants.values()];
  }

  private build(
    coreSnapshot: PromptCoeditSnapshot,
    participants: CollaborationParticipant[],
    reason: CoeditChangeReason,
  ): WorkspaceCoeditSnapshot {
    // Only a change to the document itself can change projected content. For
    // presence and status frames the published object is reused, which keeps
    // `values` referentially stable so consumers do not re-render for a caret.
    if (reason === "content") this.publishedValues = this.readValues();
    return {
      ready: coreSnapshot.ready,
      localReady: coreSnapshot.localReady,
      connectionPhase: coreSnapshot.connectionPhase,
      hasEstablishedConnection: coreSnapshot.hasEstablishedConnection,
      lifecyclePhase: coreSnapshot.lifecyclePhase,
      ...(coreSnapshot.pendingSince === undefined ? {} : { pendingSince: coreSnapshot.pendingSince }),
      ...(coreSnapshot.lastAckedRevision === undefined ? {} : { lastAckedRevision: coreSnapshot.lastAckedRevision }),
      ...(coreSnapshot.stateEpoch === undefined ? {} : { stateEpoch: coreSnapshot.stateEpoch }),
      ...(coreSnapshot.commitSequence === undefined ? {} : { commitSequence: coreSnapshot.commitSequence }),
      readOnly: coreSnapshot.readOnly,
      writeCapable: coreSnapshot.writeCapable,
      saveState: coreSnapshot.saveState,
      participants,
      values: this.publishedValues,
      commands: [...this.commands.values()].sort((left, right) => left.createdAt - right.createdAt),
      issue: coreSnapshot.issue,
      issueMessage: coreSnapshot.issueMessage,
      published: coreSnapshot.published,
      ...(coreSnapshot.seedFailures ? { seedFailures: coreSnapshot.seedFailures } : {}),
      ...(coreSnapshot.seedDeliveries ? { seedDeliveries: coreSnapshot.seedDeliveries } : {}),
    };
  }

  retry(): void {
    this.core.retry();
  }

  /**
   * Publishes the result of an authoritative HTTP structural mutation. The
   * command is deliberately stateless: it invalidates the other open surfaces
   * without becoming durable workspace content or a second write protocol.
   */
  publishCommand(
    command: SatWorkspaceCommandName,
    payload: Record<string, unknown>,
    expectedWorkspaceRevision?: string | null,
  ): boolean {
    const next = createSatWorkspaceCommand({
      documentName: this.documentName,
      actorId: this.core.self.actorId,
      command,
      payload,
      ...(expectedWorkspaceRevision === undefined ? {} : { expectedWorkspaceRevision }),
    });
    return this.core.sendWorkspaceCommand(next);
  }

  destroy(): void {
    for (const unobserve of this.richObservers.values()) unobserve();
    this.richObservers.clear();
    this.richProjections.clear();
    this.richDirty.clear();
    this.core.destroy();
  }

  reportReplaced(): void {
    this.core.reportReplaced();
  }

  getValue<T = unknown>(path: string): T | undefined {
    const value = this.values.get(path);
    return value as T | undefined;
  }

  setValue(path: string, value: unknown): void {
    if (this.session.readOnly || this.session.lifecyclePhase !== "active") return;
    const normalized = path.trim();
    if (!normalized) return;
    const root = this.ydoc.getMap<unknown>(FIELD_SET_WORKSPACE);
    const next = value === undefined ? undefined : stableJson(value);
    const current = root.get(normalized);
    if (next === undefined) {
      if (root.has(normalized)) root.delete(normalized);
      return;
    }
    if (current === next) return;
    root.set(normalized, next);
  }

  setValues(values: Record<string, unknown>): void {
    if (this.session.readOnly || this.session.lifecyclePhase !== "active") return;
    this.ydoc.transact(() => {
      for (const [path, value] of Object.entries(values)) this.setValue(path, value);
    }, "sat-authoring-workspace");
  }

  /**
   * Proposes the first shared value for one scalar workspace path.
   *
   * Local arbitration cannot work: two tabs opening the same empty room both
   * see `!root.has(path)`, and the later merge silently wins. The value is
   * therefore never written here. It is proposed, the room applies at most one
   * proposal per path, and the accepted value arrives back as an ordinary Yjs
   * update — which is also what makes the seed durable before any surface shows
   * it. A populated path is skipped locally so a stale mount cannot spend a
   * frame on a proposal the service would refuse.
   */
  seedValue(path: string, value: unknown, sourceQuestionRevision?: number): boolean {
    if (this.session.readOnly || this.session.lifecyclePhase !== "active") return false;
    const normalized = path.trim();
    if (!normalized) return false;
    if (this.ydoc.getMap<unknown>(FIELD_SET_WORKSPACE).has(normalized)) return false;
    return this.sendSeed({
      root: "scalar",
      path: normalized,
      value,
      ...(sourceQuestionRevision === undefined ? {} : { sourceQuestionRevision }),
    });
  }

  /**
   * Proposes the first server-arbitrated seed for one shared rich root.
   *
   * `ensureRichField` used to apply the seed locally when `fragment.length` was
   * zero, which is exactly the check two concurrent tabs both pass: both seeds
   * merged, and the root ended up holding one author's content plus the other's.
   * The room now owns that decision.
   */
  seedRichField(
    fieldPath: string,
    content: StructuredContent,
    sourceQuestionRevision?: number,
  ): boolean {
    if (this.session.readOnly || this.session.lifecyclePhase !== "active") return false;
    const normalized = fieldPath.trim();
    if (!normalized) return false;
    if (this.ydoc.getXmlFragment(richFragmentName(normalized)).length > 0) return false;
    return this.sendSeed({
      root: "rich",
      path: normalized,
      value: content,
      ...(sourceQuestionRevision === undefined ? {} : { sourceQuestionRevision }),
    });
  }

  /**
   * Builds and sends one seed frame. The frame rules — allowed paths, scalar
   * versus rich roots, size limits, and the deterministic seed id — live once,
   * in workspaceSeed.ts, so both halves of the protocol validate identically.
   */
  private sendSeed(input: {
    root: WorkspaceSeedRoot;
    path: string;
    value: unknown;
    sourceQuestionRevision?: number;
  }): boolean {
    let frame: WorkspaceSeedFrame;
    try {
      frame = createWorkspaceSeedFrame({ documentName: this.documentName, ...input });
    } catch (error) {
      // A proposal the shared validator refuses (unsupported path, malformed or
      // oversized value) is not sent: the service would ignore it, and a local
      // fallback here would resurrect the double-seed this path removes.
      //
      // It is also not SILENT any more. This catch used to be the only place a
      // seed could disappear with nothing written anywhere, which made a field
      // that can never initialize indistinguishable from one still loading.
      const detail = error instanceof Error ? error.message : "the shared validator refused it";
      this.core.recordSeedDelivery(input.path, "invalid-frame", detail);
      return false;
    }
    return this.core.sendWorkspaceSeed(frame);
  }

  /** Apply an explicit non-editor rich-field replacement to its shared root. */
  setRichField(fieldPath: string, content: StructuredContent): void {
    if (this.session.readOnly || this.session.lifecyclePhase !== "active") return;
    const normalized = fieldPath.trim();
    if (!normalized) return;
    prosemirrorJSONToYXmlFragment(
      getRichTextSchema(),
      documentFromStructuredContent(content),
      this.ydoc.getXmlFragment(richFragmentName(normalized)),
    );
  }

  fieldBinding(fieldPath: string): WorkspaceFieldBinding {
    let binding = this.fieldBindings.get(fieldPath);
    if (!binding) {
      binding = {
        fieldPath,
        extensions: collaborationExtensions({
          session: this.session,
          provider: this.core,
          field: richFragmentName(fieldPath),
        }),
        ready: this.core.snapshot().ready,
        readOnly: this.core.snapshot().readOnly,
      };
      this.fieldBindings.set(fieldPath, binding);
    }
    return {
      ...binding,
      ready: this.core.snapshot().ready,
      readOnly: this.core.snapshot().readOnly,
    };
  }

  setPresence(target: { surface: "builder" | "release" | "access"; questionId?: string; fieldPath?: string }): void {
    // A release/access page is not editing a question. Clear the previous
    // builder selection instead of attributing that question to the author on
    // every surface in the exam room.
    const nextTarget = {
      surface: target.surface,
      ...(target.questionId?.trim() ? { questionId: target.questionId.trim() } : {}),
      ...(target.fieldPath?.trim() ? { fieldPath: target.fieldPath.trim() } : {}),
    };
    this.activeQuestionId = nextTarget.questionId ?? null;
    const awareness = this.core.awarenessProvider.awareness;
    if (JSON.stringify(awareness?.getLocalState()?.["target"] ?? null) === JSON.stringify(nextTarget)) return;
    awareness?.setLocalStateField("target", nextTarget);
  }

  /**
   * Flushes the room and resolves once this tab's exact state is durable. The
   * workspace exposes it rather than the UI reaching into the core provider, so
   * navigation has one durability gate for the room that owns every field.
   */
  flushAndWaitForSaved(timeoutMs: number): Promise<CoeditFlushResult> {
    return this.core.flushAndWaitForSaved(timeoutMs);
  }

  get recovery(): WorkspaceRecovery {
    const recovery = this.core.session.recovery;
    return {
      ...recovery,
      // The workspace provider owns several named rich-text fragments, so the
      // core prompt recovery helper (which is correct for v1's `prompt` root)
      // cannot be used verbatim here. Export the selected question's actual
      // rich fragment before a replaced/closed room is discarded.
      exportPrompt: () => {
        const questionId = this.activeQuestionId ?? this.selectedQuestionId();
        if (!questionId) return null;
        const fragment = this.ydoc.getXmlFragment(
          richFragmentName(`question/${questionId}/prompt`),
        );
        return fragment.length > 0 ? fragment.toJSON() : null;
      },
      // `exportWorkspace` is a projection of the LIVE room; a preserved
      // pre-compaction copy is exported through `exportStaleCache`, which is
      // raw room content rather than one question's prompt fragment.
      exportWorkspace: () => Object.fromEntries(this.values),
    };
  }

  /**
   * Rebuilds the flat path → value map the UI reads.
   *
   * Scalar fields are cheap to re-read. Rich fragments are not: each one runs
   * the whole ProseMirror conversion, so a projection is cached per shared root
   * and recomputed only after Yjs reports that root — or anything inside it —
   * changed.
   */
  private readValues(): Record<string, unknown> {
    const root = this.ydoc.getMap<unknown>(FIELD_SET_WORKSPACE);
    this.values.clear();
    root.forEach((value, path) => {
      if (typeof value !== "string") {
        this.values.set(path, value);
        return;
      }
      try {
        this.values.set(path, JSON.parse(value) as unknown);
      } catch {
        // Invalid values are ignored at the UI boundary; the service applies
        // the same bounded JSON validation before acknowledging a store.
      }
    });

    // Rich fragments are shared roots too, not just editor implementation
    // details. Project them into the snapshot so an optional/collapsed editor
    // still reflects a collaborator's update immediately. The editor binding
    // remains the writer; this is read-only UI projection.
    for (const [name, entry] of this.ydoc.share) {
      if (!name.startsWith(RICH_ROOT_PREFIX)) continue;
      // A root synced from the room that this tab never touched is only a
      // placeholder until it is asked for as a fragment; asking is what makes
      // it readable here (see `materializeRichRoot`). Upgrading replaces the
      // map entry for the SAME key, which is safe mid-iteration.
      const shared = materializeRichRoot(this.ydoc, name, entry);
      if (!shared) continue;
      // Observe first, so a root that is empty now becomes dirty the moment its
      // seed (or a collaborator) puts content in it.
      this.observeRichRoot(name, shared);
      if (!isInitializedRichRoot(shared)) {
        // Never initialized: not content, so it is absent from the projection.
        // Any cached projection for this name is dropped too, so a stale value
        // from a previous life of the root cannot outlive its content.
        this.richProjections.delete(name);
        this.richDirty.delete(name);
        continue;
      }
      if (!this.richDirty.has(name) && this.richProjections.has(name)) {
        this.values.set(name, this.richProjections.get(name));
        continue;
      }
      try {
        const projected = this.projectRichFragment(this.ydoc, name);
        this.richProjections.set(name, projected);
        // Clean the root only after a successful projection: one that threw
        // stays dirty so the next pass retries instead of caching the failure.
        this.richDirty.delete(name);
        this.values.set(name, projected);
      } catch {
        // Malformed rich roots stay out of the UI projection. The durable Yjs
        // state remains available for the service's bounded recovery path.
      }
    }
    // Spreading a Map yields an empty object, so the record consumers read
    // must be built from its entries.
    return Object.fromEntries(this.values);
  }

  /**
   * Marks one rich root dirty the moment anything inside it changes. The deep
   * observer is required: an edit lands on a paragraph or text node, never on
   * the root that owns the cached projection.
   */
  private observeRichRoot(name: string, fragment: Y.XmlFragment): void {
    if (this.richObservers.has(name)) return;
    const handler = (): void => {
      this.richDirty.add(name);
    };
    fragment.observeDeep(handler);
    this.richObservers.set(name, () => fragment.unobserveDeep(handler));
  }

  private selectedQuestionId(): string | null {
    const value = this.values.get("ui/selectedQuestionId");
    return typeof value === "string" && value.trim() ? value : null;
  }
}

function richFragmentName(fieldPath: string): string {
  return `${RICH_ROOT_PREFIX}${fieldPath}`;
}

function stableJson(value: unknown): string {
  return JSON.stringify(value) ?? "null";
}

