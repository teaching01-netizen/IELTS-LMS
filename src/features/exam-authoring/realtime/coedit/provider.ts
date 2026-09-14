import { HocuspocusProvider } from "@hocuspocus/provider";
import * as Y from "yjs";
import type {
  CoeditCollaborator,
  CoeditConnectionPhase,
  CoeditLifecycleIssue,
  CoeditLifecyclePhase,
  CoeditSaveState,
  CoeditSelfIdentity,
  PromptCoeditingSession,
} from "./contracts";
import {
  COEDIT_REPLACED_LIFECYCLE,
  INITIAL_SAVE_STATE,
  coeditLifecycleFromCloseReason,
  colorForActor,
  parseCoeditSaveFailureMessage,
  parseCoeditLifecycleMessage,
} from "./contracts";
import { attachIndexedDbPersistence, type CoeditLocalPersistence } from "./indexedDbPersistence";
import { collaboratorsFromAwareness, sanitizeLocalAwarenessState } from "./presence";
import { deriveSaveState, stateVectorHash } from "./saveState";
import { COEDIT_TOKEN_REFRESH_LEAD_MS } from "./tokenApi";
import {
  parseSatWorkspaceCommand,
  type SatWorkspaceCommand,
} from "./workspaceCommands";

/** Stateless acknowledgement the service broadcasts after a committed store. */
export interface CoeditCommitAck {
  type: "coedit.ack";
  documentName: string;
  stateHash: string;
  questionRevision: number;
  materializedRevision: number;
}

/** Interval at which the provider re-sends its (refreshed) token. */
export const COEDIT_TOKEN_REFRESH_INTERVAL_MS = 60_000;

export interface PromptCoeditToken {
  token: string;
  expiresAt: number;
}

export interface PromptCoeditProviderOptions {
  documentName: string;
  field: string;
  serviceUrl: string;
  token: PromptCoeditToken;
  /** Server-derived local identity (echoed from the token response). */
  self: { actorId: string; displayName: string };
  readOnly: boolean;
  /** Re-mints the token; called before expiry and on authentication failure. */
  refreshToken: () => Promise<PromptCoeditToken>;
  /** Reports content-free lifecycle problems to the UI. */
  onLifecycle?: (issue: CoeditLifecycleIssue, message: string | null) => void;
  /** Receives an authenticated, stateless structural command for workspace rooms. */
  onWorkspaceCommand?: (command: SatWorkspaceCommand) => void;
}

function numericRevision(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string" || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Mutable provider view published to React on every observable change. */
export interface PromptCoeditSnapshot {
  ready: boolean;
  connected: boolean;
  connectionPhase: CoeditConnectionPhase;
  hasEstablishedConnection: boolean;
  lifecyclePhase: CoeditLifecyclePhase;
  pendingSince?: number;
  lastAckedRevision?: string;
  readOnly: boolean;
  saveState: CoeditSaveState;
  collaborators: CoeditCollaborator[];
  issue: CoeditLifecycleIssue;
  issueMessage: string | null;
  published: boolean;
}

/**
 * Owns one collaborative prompt room for the lifetime of the selected
 * question.
 *
 * Deliberately NOT a React hook: the workspace mounts and destroys it
 * explicitly so pending provider output can be flushed (or safely retained in
 * IndexedDB) before teardown, and so StrictMode's double mount cannot open two
 * rooms against one document.
 */
export class PromptCoeditProvider {
  readonly ydoc: Y.Doc;
  readonly field: string;
  readonly documentName: string;

  private readonly options: PromptCoeditProviderOptions;
  private readonly local: CoeditLocalPersistence;
  private readonly hocuspocus: HocuspocusProvider;
  private readonly listeners = new Set<(snapshot: PromptCoeditSnapshot) => void>();

  private token: PromptCoeditToken;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private refreshInFlight = false;
  private disposed = false;

  private ready = false;
  private connected = false;
  private connectionPhase: CoeditConnectionPhase = "connecting";
  private hasEstablishedConnection = false;
  private lifecyclePhase: CoeditLifecyclePhase = "active";
  private published = false;
  private readOnly: boolean;
  private issue: CoeditLifecycleIssue = "none";
  private issueMessage: string | null = null;
  private acknowledgedStateHash: string | null = null;
  private questionRevision: number | null = null;
  private lastError: { message: string; retryable: boolean } | null = null;
  private localStateHash: string | null = null;
  private storeInFlight = false;
  private pendingSince: number | null = null;
  private lastAckedRevision: string | null = null;
  private readonly pendingWorkspaceCommands = new Map<string, string>();
  private static readonly MAX_PENDING_WORKSPACE_COMMANDS = 128;

  constructor(options: PromptCoeditProviderOptions) {
    this.options = options;
    this.documentName = options.documentName;
    this.field = options.field;
    this.token = options.token;
    this.readOnly = options.readOnly;
    this.ydoc = new Y.Doc();
    this.local = attachIndexedDbPersistence(this.documentName, this.ydoc);

    this.hocuspocus = new HocuspocusProvider({
      url: options.serviceUrl,
      name: this.documentName,
      document: this.ydoc,
      token: () => this.requestToken(),
      onSynced: () => {
        // Only after initial sync may the editor mount. An empty Yjs document
        // must never be rendered as an editable prompt while seed status is
        // unresolved.
        this.ready = true;
        this.localStateHash = this.getStateVectorHash();
        if (this.localStateHash === this.acknowledgedStateHash) {
          this.pendingSince = null;
          this.storeInFlight = false;
        } else if (this.storeInFlight) {
          this.pendingSince ??= Date.now();
        }
        this.recompute();
      },
      onAuthenticationFailed: () => {
        // A refused session cannot produce the acknowledgement the in-flight
        // store was waiting for: leaving the flag set would keep the save state
        // at `syncing` ("Saving…") for work the service never accepted.
        this.storeInFlight = false;
        if (this.isTerminal) {
          // A closed or replaced room refuses every token by design. Reporting
          // an expiry here would overwrite the recovery the author needs with a
          // reason that is not true.
          this.recompute();
          return;
        }
        this.issue = "token_expired";
        this.issueMessage = "The collaboration session expired; requesting a new session.";
        this.options.onLifecycle?.(this.issue, this.issueMessage);
        void this.refreshNow();
        this.recompute();
      },
      onStatus: ({ status }) => {
        this.connected = status === "connected";
        this.connectionPhase =
          status === "connected"
            ? "connected"
            : status === "disconnected"
              ? "disconnected"
              : "connecting";
        if (this.connected) this.hasEstablishedConnection = true;
        if (this.connected && this.issue === "offline") {
          this.issue = "none";
          this.issueMessage = null;
        }
        if (this.connected) this.flushWorkspaceCommands();
        this.recompute();
      },
      onAwarenessUpdate: () => this.recompute(),
      onStateless: ({ payload }) => this.handleStateless(payload),
      onDisconnect: () => {
        this.connected = false;
        this.connectionPhase = "disconnected";
        // Local edits continue while the network is unavailable; the Y.Doc and
        // IndexedDB keep the work, and the save state becomes unsaved rather
        // than falsely saved.
        this.issue = this.issue === "none" ? "offline" : this.issue;
        this.recompute();
      },
      onClose: ({ event }) => {
        this.connected = false;
        this.connectionPhase = "disconnected";
        // A close that carries the service's lifecycle prefix is a decision,
        // not a dropped socket: the room is over, and the design requires the
        // prompt to be offered for copy/export before a replacement draft is
        // opened. Every other close stays on the reconnecting/offline path.
        const lifecycle = coeditLifecycleFromCloseReason(event?.reason);
        if (lifecycle) {
          this.enterTerminal(lifecycle.issue, lifecycle.message, lifecycle.published === true);
        }
        else this.recompute();
      },
    });

    this.ydoc.on("update", this.onDocumentUpdate);
    this.armTokenRefresh();
  }

  /**
   * The awareness-capable provider the caret extension binds to.
   *
   * Exposed only to editorBinding.ts inside this package: UI components must
   * not reach the transport directly.
   */
  get awarenessProvider(): HocuspocusProvider {
    return this.hocuspocus;
  }

  /** Re-open a transport after an inline Retry action. */
  retry(): void {
    if (this.disposed) return;
    this.lastError = null;
    if (!this.isTerminal) {
      this.issue = "none";
      this.issueMessage = null;
    }
    void this.hocuspocus.connect().catch(() => undefined);
    this.recompute();
  }

  /** Relay one already-authorized HTTP mutation to the other open surfaces. */
  sendWorkspaceCommand(command: SatWorkspaceCommand): boolean {
    if (this.disposed || this.isTerminal) return false;
    let payload: string;
    try {
      payload = JSON.stringify(command);
    } catch {
      return false;
    }
    if (!this.connected) {
      // The HTTP mutation has already committed. Keep its invalidation signal
      // until this room reconnects so a brief network race cannot leave other
      // open authoring surfaces stale forever.
      this.pendingWorkspaceCommands.set(command.commandId, payload);
      while (this.pendingWorkspaceCommands.size > PromptCoeditProvider.MAX_PENDING_WORKSPACE_COMMANDS) {
        const oldest = this.pendingWorkspaceCommands.keys().next().value;
        if (typeof oldest !== "string") break;
        this.pendingWorkspaceCommands.delete(oldest);
      }
      return true;
    }
    return this.relayWorkspaceCommand(command.commandId, payload);
  }

  /** Apply a lifecycle read-only decision without remounting editors. */
  setReadOnly(readOnly: boolean): void {
    if (this.disposed || this.isTerminal) return;
    this.readOnly = readOnly;
    this.recompute();
  }

  get self(): CoeditSelfIdentity {
    return {
      actorId: this.options.self.actorId,
      displayName: this.options.self.displayName || "You",
      color: colorForActor(this.options.self.actorId || "self"),
    };
  }

  get session(): PromptCoeditingSession {
    return {
      ydoc: this.ydoc,
      field: this.field,
      self: this.self,
      ready: this.ready,
      connected: this.connected,
      connectionPhase: this.connectionPhase,
      hasEstablishedConnection: this.hasEstablishedConnection,
      lifecyclePhase: this.lifecyclePhase,
      ...(this.pendingSince === null ? {} : { pendingSince: this.pendingSince }),
      ...(this.lastAckedRevision === null ? {} : { lastAckedRevision: this.lastAckedRevision }),
      readOnly: this.readOnly,
      saveState: this.currentSaveState(),
      collaborators: this.currentCollaborators(),
      recovery: {
        issue: this.issue,
        message: this.issueMessage,
        published: this.published,
        canExport: (this.issue === "closed" || this.issue === "replaced") && !this.published,
        exportPrompt: () => {
          const fragment = this.ydoc.getXmlFragment(this.field);
          return fragment.length > 0 ? this.ydoc.getXmlFragment(this.field).toJSON() : null;
        },
        discardLocal: async () => {
          await this.local.destroy();
        },
        reload: () => {
          void this.refreshNow();
        },
      },
      destroy: () => this.destroy(),
    };
  }

  subscribe(listener: (snapshot: PromptCoeditSnapshot) => void): () => void {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => {
      this.listeners.delete(listener);
    };
  }

  snapshot(): PromptCoeditSnapshot {
    return {
      ready: this.ready,
      connected: this.connected,
      connectionPhase: this.connectionPhase,
      hasEstablishedConnection: this.hasEstablishedConnection,
      lifecyclePhase: this.lifecyclePhase,
      ...(this.pendingSince === null ? {} : { pendingSince: this.pendingSince }),
      ...(this.lastAckedRevision === null ? {} : { lastAckedRevision: this.lastAckedRevision }),
      readOnly: this.readOnly,
      saveState: this.currentSaveState(),
      collaborators: this.currentCollaborators(),
      issue: this.issue,
      issueMessage: this.issueMessage,
      published: this.published,
    };
  }

  /** The local state-vector hash, or null before the first local observation. */
  getStateVectorHash(): string | null {
    return stateVectorHash(Y.encodeStateVector(this.ydoc));
  }

  /** True when the acknowledged hash matches the CURRENT local state vector. */
  isLocallySaved(): boolean {
    const current = this.getStateVectorHash();
    return current !== null && current === this.acknowledgedStateHash;
  }

  /** Awaits the local IndexedDB replay (used before unmount decisions). */
  whenLocalSynced(): Promise<void> {
    return this.local.whenSynced;
  }

  /**
   * Flushes pending provider output by nudging a final token send, then tears
   * the room down. The Y.Doc and its IndexedDB copy are deliberately left in
   * place until the workspace either confirms a committed hash or the user
   * discards.
   */
  destroy(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    this.ydoc.off("update", this.onDocumentUpdate);
    this.pendingWorkspaceCommands.clear();
    try {
      this.hocuspocus.destroy();
    } catch {
      // Teardown is best-effort: a throw here must not strand React state.
    }
    this.listeners.clear();
  }

  /** Deletes the local cache after the workspace confirms a committed hash. */
  async discardLocalState(): Promise<void> {
    await this.local.destroy();
  }

  /**
   * The existing durable `draft.replaced` authoring event, applied to this
   * room. The socket close carries the same decision, but a durable event can
   * arrive when the close frame cannot — and the author still needs the
   * prompt export before the new draft opens.
   */
  reportReplaced(): void {
    if (this.disposed || this.isTerminal) return;
    this.enterTerminal(COEDIT_REPLACED_LIFECYCLE.issue, COEDIT_REPLACED_LIFECYCLE.message);
  }

  /** True once a lifecycle decision has ended the room for good. */
  private get isTerminal(): boolean {
    return this.issue === "closed" || this.issue === "replaced";
  }

  /**
   * Ends the room with the reason the author is shown, and freezes the editor:
   * the room no longer accepts writes, so a keystroke is never silently lost.
   */
  private enterTerminal(
    issue: Extract<CoeditLifecycleIssue, "closed" | "replaced">,
    message: string,
    published = false,
  ): void {
    this.issue = issue;
    this.issueMessage = message;
    this.lifecyclePhase = "frozen";
    this.published = published;
    this.readOnly = true;
    this.storeInFlight = false;
    this.options.onLifecycle?.(issue, message);
    this.recompute();
  }

  private readonly onDocumentUpdate = () => {
    if (this.disposed) return;
    this.localStateHash = this.getStateVectorHash();
    // Once the edit has been applied to the Y.Doc AND the transport is up, it
    // has been accepted by Hocuspocus and is awaiting the Go/MySQL commit — the
    // design's `Syncing` rung. While the transport is down it stays `Unsaved`
    // (the disconnected branch of deriveSaveState outranks this), so the editor
    // never claims a server has seen work it has not.
    if (this.localStateHash === this.acknowledgedStateHash) {
      this.pendingSince = null;
      this.storeInFlight = false;
    } else {
      this.pendingSince ??= Date.now();
      this.storeInFlight = this.connected;
    }
    this.recompute();
  };

  private currentSaveState(): CoeditSaveState {
    return deriveSaveState({
      localStateHash: this.localStateHash,
      acknowledgedStateHash: this.acknowledgedStateHash,
      questionRevision: this.questionRevision,
      connected: this.connected,
      inFlight: this.storeInFlight,
      error: this.lastError,
      lifecycle:
        this.issue === "closed" || this.issue === "replaced" || this.issue === "frozen"
          ? "error"
          : null,
    });
  }

  private currentCollaborators(): CoeditCollaborator[] {
    const awareness = this.hocuspocus.awareness;
    if (!awareness) return [];
    return collaboratorsFromAwareness(
      awareness.getStates() as Map<number, Record<string, unknown>>,
      awareness.clientID ?? null,
    );
  }

  private flushWorkspaceCommands(): void {
    if (!this.connected || this.disposed || this.isTerminal) return;
    for (const [commandId, payload] of this.pendingWorkspaceCommands) {
      if (!this.relayWorkspaceCommand(commandId, payload)) break;
    }
  }

  private relayWorkspaceCommand(commandId: string, payload: string): boolean {
    try {
      this.hocuspocus.sendStateless(payload);
      this.pendingWorkspaceCommands.delete(commandId);
      return true;
    } catch {
      return false;
    }
  }

  private recompute(): void {
    if (this.disposed) return;
    const snapshot = this.snapshot();
    // Local awareness is sanitized before publishing so a browser-defined
    // property can never be advertised as collaborator identity.
    const awareness = this.hocuspocus.awareness;
    if (awareness) {
      const current = (awareness.getLocalState() ?? {}) as Record<string, unknown>;
      const sanitized = sanitizeLocalAwarenessState(current);
      if (JSON.stringify(sanitized) !== JSON.stringify(current)) {
        awareness.setLocalState(sanitized);
      }
    }
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }

  private handleStateless(payload: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(payload);
    } catch {
      return;
    }
    const lifecycle = parseCoeditLifecycleMessage(parsed);
    if (lifecycle) {
      if (lifecycle.documentName !== this.documentName) return;
      this.lifecyclePhase = lifecycle.phase === "freezing" ? "freezing" : "active";
      if (!this.isTerminal) {
        this.readOnly = lifecycle.phase === "freezing" ? true : this.options.readOnly;
        if (lifecycle.phase === "active" && this.issue === "frozen") {
          this.issue = "none";
          this.issueMessage = null;
        }
      }
      this.recompute();
      return;
    }
    const saveFailure = parseCoeditSaveFailureMessage(parsed);
    if (saveFailure) {
      if (saveFailure.documentName !== this.documentName) return;
      this.lastError = {
        message: "The latest changes could not be saved.",
        retryable: saveFailure.retryable,
      };
      this.storeInFlight = false;
      this.recompute();
      return;
    }
    const workspaceCommand = parseSatWorkspaceCommand(parsed, this.documentName);
    if (workspaceCommand) {
      this.options.onWorkspaceCommand?.(workspaceCommand);
      this.recompute();
      return;
    }
    if (
      parsed === null ||
      typeof parsed !== "object" ||
      (parsed as { type?: unknown }).type !== "coedit.ack"
    ) return;
    const ack = parsed as Partial<CoeditCommitAck>;
    if (
      typeof ack.documentName !== "string" ||
      ack.documentName !== this.documentName ||
      typeof ack.stateHash !== "string" ||
      !ack.stateHash
    ) return;
    // Identity check: an acknowledgement for another room must never move this
    // editor to Saved.
    // Revisions are monotonic at the persistence boundary. A late initial-sync
    // or duplicate acknowledgement must not put an older committed hash back
    // into the provider after a newer acknowledgement already arrived.
    const ackRevision =
      numericRevision(ack.materializedRevision) ?? numericRevision(ack.questionRevision);
    const previousRevision = numericRevision(this.lastAckedRevision);
    if (
      ackRevision !== null &&
      previousRevision !== null &&
      ackRevision <= previousRevision
    ) return;
    this.acknowledgedStateHash = ack.stateHash;
    this.questionRevision =
      typeof ack.questionRevision === "number" ? ack.questionRevision : this.questionRevision;
    if (ackRevision !== null) this.lastAckedRevision = String(ackRevision);
    // Acknowledging an older state does not clear pending work. The exact
    // current state vector must be acknowledged before the UI may say Saved.
    const currentHash = this.getStateVectorHash();
    if (currentHash === ack.stateHash) {
      this.pendingSince = null;
      this.storeInFlight = false;
    } else {
      this.pendingSince ??= Date.now();
      this.storeInFlight = this.connected;
    }
    this.lastError = null;
    this.issue = this.issue === "service_unavailable" ? "none" : this.issue;
    this.recompute();
  }

  private armTokenRefresh(): void {
    this.refreshTimer = setInterval(() => {
      void this.refreshNow();
    }, COEDIT_TOKEN_REFRESH_INTERVAL_MS);
  }

  private async refreshNow(): Promise<void> {
    if (this.disposed || this.refreshInFlight) return;
    this.refreshInFlight = true;
    try {
      const next = await this.options.refreshToken();
      // Identity is re-checked: a refresh that changes the document identity
      // must close the connection, not silently rebind the room.
      if (next.token) {
        this.token = next;
        await this.hocuspocus.sendToken();
      }
    } catch {
      this.lastError = {
        message: "The collaboration session could not be refreshed.",
        retryable: true,
      };
      this.storeInFlight = false;
      if (!this.isTerminal) this.issue = "token_expired";
    } finally {
      this.refreshInFlight = false;
      this.recompute();
    }
  }

  private async requestToken(): Promise<string> {
    if (Date.now() < this.token.expiresAt * 1000 - COEDIT_TOKEN_REFRESH_LEAD_MS) {
      return this.token.token;
    }
    try {
      this.token = await this.options.refreshToken();
      return this.token.token;
    } catch {
      this.lastError = {
        message: "The collaboration session expired.",
        retryable: true,
      };
      this.storeInFlight = false;
      if (!this.isTerminal) this.issue = "token_expired";
      this.recompute();
      return this.token.token;
    }
  }
}

export { INITIAL_SAVE_STATE };
