import {
  prosemirrorJSONToYDoc,
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
import type { CoeditConnectionPhase, CoeditLifecycleIssue, CoeditLifecyclePhase, CoeditSaveState } from "./contracts";
import { FIELD_SET_WORKSPACE } from "./documentIdentity";
import { collaborationExtensions } from "./editorBinding";
import { PromptCoeditProvider, type PromptCoeditSnapshot } from "./provider";
import {
  createSatWorkspaceCommand,
  type SatWorkspaceCommand,
  type SatWorkspaceCommandName,
} from "./workspaceCommands";

export type WorkspaceCoeditingStatus = "disabled" | "preparing" | "ready" | "error";

export interface WorkspaceCoeditSnapshot {
  ready: boolean;
  connectionPhase: CoeditConnectionPhase;
  hasEstablishedConnection: boolean;
  lifecyclePhase: CoeditLifecyclePhase;
  pendingSince?: number;
  lastAckedRevision?: string;
  readOnly: boolean;
  saveState: CoeditSaveState;
  participants: CollaborationParticipant[];
  values: Record<string, unknown>;
  commands: SatWorkspaceCommand[];
  issue: CoeditLifecycleIssue;
  issueMessage: string | null;
  published: boolean;
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
  reload: () => void;
}

const EMPTY_VALUES: Record<string, unknown> = {};

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

  constructor(input: {
    documentName: string;
    serviceUrl: string;
    token: { token: string; expiresAt: number };
    self: { actorId: string; displayName: string };
    readOnly: boolean;
    refreshToken: () => Promise<{ token: string; expiresAt: number }>;
    onLifecycle?: (issue: CoeditLifecycleIssue, message: string | null) => void;
  }) {
    this.documentName = input.documentName;
    this.core = new PromptCoeditProvider({
      documentName: input.documentName,
      field: FIELD_SET_WORKSPACE,
      serviceUrl: input.serviceUrl,
      token: input.token,
      self: input.self,
      readOnly: input.readOnly,
      refreshToken: input.refreshToken,
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
    this.readValues();
  }

  get ydoc(): Y.Doc {
    return this.core.ydoc;
  }

  get session() {
    return this.core.session;
  }

  subscribe(listener: (snapshot: WorkspaceCoeditSnapshot) => void): () => void {
    return this.core.subscribe((snapshot) => listener(this.snapshot(snapshot)));
  }

  snapshot(coreSnapshot = this.core.snapshot()): WorkspaceCoeditSnapshot {
    this.readValues();
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
    return {
      ready: coreSnapshot.ready,
      connectionPhase: coreSnapshot.connectionPhase,
      hasEstablishedConnection: coreSnapshot.hasEstablishedConnection,
      lifecyclePhase: coreSnapshot.lifecyclePhase,
      ...(coreSnapshot.pendingSince === undefined ? {} : { pendingSince: coreSnapshot.pendingSince }),
      ...(coreSnapshot.lastAckedRevision === undefined ? {} : { lastAckedRevision: coreSnapshot.lastAckedRevision }),
      readOnly: coreSnapshot.readOnly,
      saveState: coreSnapshot.saveState,
      participants: [...participants.values()],
      values: { ...this.values },
      commands: [...this.commands.values()].sort((left, right) => left.createdAt - right.createdAt),
      issue: coreSnapshot.issue,
      issueMessage: coreSnapshot.issueMessage,
      published: coreSnapshot.published,
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
    this.core.destroy();
  }

  reportReplaced(): void {
    this.core.reportReplaced();
  }

  async discardLocalState(): Promise<void> {
    await this.core.discardLocalState();
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

  ensureValue(path: string, value: unknown): void {
    if (this.session.readOnly || this.session.lifecyclePhase !== "active") return;
    const root = this.ydoc.getMap<unknown>(FIELD_SET_WORKSPACE);
    if (!root.has(path)) this.setValue(path, value);
  }

  /** Seed once from an authoritative HTTP read; never overwrite remote work. */
  ensureRichField(fieldPath: string, content: StructuredContent): void {
    if (this.session.readOnly || this.session.lifecyclePhase !== "active") return;
    const fragmentName = richFragmentName(fieldPath);
    const fragment = this.ydoc.getXmlFragment(fragmentName);
    if (fragment.length > 0) return;
    const seeded = prosemirrorJSONToYDoc(
      getRichTextSchema(),
      documentFromStructuredContent(content),
      fragmentName,
    );
    try {
      Y.applyUpdate(this.ydoc, Y.encodeStateAsUpdate(seeded), "sat-authoring-workspace-seed");
    } finally {
      seeded.destroy();
    }
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
      exportWorkspace: () => ({ ...this.values }),
    };
  }

  private readValues(): void {
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
    for (const [name, shared] of this.ydoc.share) {
      if (!name.startsWith("rich:") || !(shared instanceof Y.XmlFragment)) continue;
      try {
        this.values.set(
          name,
          structuredContentFromDocument(
            yDocToProsemirrorJSON(this.ydoc, name) as Parameters<
              typeof structuredContentFromDocument
            >[0],
          ),
        );
      } catch {
        // Malformed rich roots stay out of the UI projection. The durable Yjs
        // state remains available for the service's bounded recovery path.
      }
    }
  }

  private selectedQuestionId(): string | null {
    const value = this.values.get("ui/selectedQuestionId");
    return typeof value === "string" && value.trim() ? value : null;
  }
}

function richFragmentName(fieldPath: string): string {
  return `rich:${fieldPath}`;
}

function stableJson(value: unknown): string {
  return JSON.stringify(value) ?? "null";
}

function snapshotFromCore(snapshot: PromptCoeditSnapshot): WorkspaceCoeditSnapshot {
  return {
    ready: snapshot.ready,
    connectionPhase: snapshot.connectionPhase,
    hasEstablishedConnection: snapshot.hasEstablishedConnection,
    lifecyclePhase: snapshot.lifecyclePhase,
    ...(snapshot.pendingSince === undefined ? {} : { pendingSince: snapshot.pendingSince }),
    ...(snapshot.lastAckedRevision === undefined ? {} : { lastAckedRevision: snapshot.lastAckedRevision }),
    readOnly: snapshot.readOnly,
    saveState: snapshot.saveState,
    participants: [],
    values: EMPTY_VALUES,
    commands: [],
    issue: snapshot.issue,
    issueMessage: snapshot.issueMessage,
    published: snapshot.published,
  };
}

export { snapshotFromCore };
