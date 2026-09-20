import { HocuspocusProvider } from "@hocuspocus/provider";
import * as Y from "yjs";
import type {
  CoeditCollaborator,
  CoeditConnectionPhase,
  CoeditDecimalString,
  CoeditLifecycleIssue,
  CoeditLifecyclePhase,
  CoeditSaveState,
  CoeditSelfIdentity,
  PromptCoeditingSession,
} from "./contracts";
import {
  COEDIT_REPLACED_LIFECYCLE,
  COEDIT_STALE_CACHE_MESSAGE,
  INITIAL_SAVE_STATE,
  coeditLifecycleFromCloseReason,
  coeditRecoveryFromSaveFailure,
  colorForActor,
  parseCoeditSaveFailureMessage,
  parseCoeditLifecycleMessage,
  type CoeditFlushResult,
  type CoeditStaleCacheExport,
} from "./contracts";
import { attachIndexedDbPersistence, type CoeditLocalPersistence } from "./indexedDbPersistence";
import { compareCoeditDecimalStrings, isCoeditDecimalString } from "./protocol";
import { collaboratorsFromAwareness, sanitizeLocalAwarenessState } from "./presence";
import { deriveSaveState } from "./saveState";
import { encodeStateVectorBase64 } from "./stateVector";
import { createCoeditStoreRequest } from "./storeRequest";
import { COEDIT_TOKEN_REFRESH_LEAD_MS } from "./tokenApi";
import {
  parseSatWorkspaceCommand,
  type SatWorkspaceCommand,
} from "./workspaceCommands";
import {
  parseWorkspaceSeedResultFrame,
  type WorkspaceSeedFrame,
  type WorkspaceSeedOutcome,
} from "./workspaceSeed";
import {
  auditEpochCaches,
  clearEpochCache,
  type CoeditStaleCacheReport,
} from "./indexedDbPersistence";

/** Stateless acknowledgement the service broadcasts after a committed store. */
export interface CoeditCommitAck {
  type: "coedit.ack";
  documentName: string;
  /**
   * Base64 state vector of the committed document. This is the identity the
   * client compares its own vector against; a digest would be a second
   * implementation that can silently disagree with the service's.
   */
  stateVector: string;
  /** Durable SHA-256 provenance hash, stored by Go. Never used to decide Saved. */
  stateHash: string;
  questionRevision: number;
  materializedRevision: number;
  /** Additive lifecycle metadata; older service acknowledgements omit it. */
  stateEpoch?: CoeditDecimalString;
  commitSequence?: CoeditDecimalString;
  workspaceRevision?: number;
}

/**
 * Why a snapshot was published.
 *
 * `content` means the shared document itself changed: only then can projected
 * workspace values (rich fragments, scalar fields) be stale. `presence` is an
 * awareness frame (a caret or selection move) and `status` is transport/save
 * bookkeeping — neither can change content, so consumers use this to skip the
 * expensive re-projection that awareness traffic would otherwise trigger on
 * every keystroke of every collaborator.
 */
export type CoeditChangeReason = "content" | "presence" | "status";

/** Interval at which the provider re-sends its (refreshed) token. */
export const COEDIT_TOKEN_REFRESH_INTERVAL_MS = 60_000;

/**
 * How long the local half of readiness waits for the IndexedDB replay before it
 * is treated as unavailable.
 *
 * y-indexeddb emits `synced` only after its open promise resolves, so a browser
 * that cannot open the store never settles `whenSynced` at all. Waiting forever
 * would mean the first seed is never proposed and an empty exam room renders
 * empty forever; a bounded wait degrades to a merge instead (the service still
 * arbitrates the seed, and the replay arrives as the recovery copy it is).
 */
export const COEDIT_LOCAL_REPLAY_GRACE_MS = 5_000;

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
  /**
   * Durable compaction epoch the room is on, from the token response. Absent
   * means a legacy epoch-zero server; the local cache namespace is `0` in that
   * case, which is also the namespace a pre-namespacing cache belongs to.
   */
  stateEpoch?: CoeditDecimalString;
}

function numericRevision(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string" || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Mutable provider view published to React on every observable change. */
export interface PromptCoeditSnapshot {
  /** The network half of readiness: the room reached initial sync. */
  ready: boolean;
  /**
   * The local half of readiness: IndexedDB replayed, or the grace period
   * expired.
   *
   * Together with `ready` this is the barrier a seed proposal may not cross. A
   * seed sent before the recovery copy lands can be merged over by it, which is
   * exactly the double-seed this protocol exists to prevent.
   */
  localReady: boolean;
  connected: boolean;
  connectionPhase: CoeditConnectionPhase;
  hasEstablishedConnection: boolean;
  lifecyclePhase: CoeditLifecyclePhase;
  pendingSince?: number;
  lastAckedRevision?: string;
  stateEpoch?: CoeditDecimalString;
  commitSequence?: CoeditDecimalString;
  workspaceRevision?: number;
  /**
   * The effective posture right now: the token is read-only, or the room was
   * frozen while this tab was open.
   */
  readOnly: boolean;
  /**
   * Whether this session's TOKEN allows writing, regardless of a later freeze.
   *
   * Deliberately distinct from `readOnly`: a frozen room is read-only but its
   * author may still be holding local edits that must not leave silently, while
   * an observer never authored anything the room could be holding. Clients that
   * decide whether unsynced local content needs protecting read this, not
   * `readOnly`.
   */
  writeCapable: boolean;
  saveState: CoeditSaveState;
  collaborators: CoeditCollaborator[];
  issue: CoeditLifecycleIssue;
  issueMessage: string | null;
  published: boolean;
  /**
   * Seed outcomes the room reported, keyed by the workspace path they were
   * proposed for. Absent while every proposal is still outstanding or applied,
   * which keeps the common case out of the snapshot's identity.
   *
   * This is what turns "the root never appeared" from an eternal wait into a
   * fact an editor can render recovery for.
   */
  seedFailures?: Record<string, { outcome: WorkspaceSeedOutcome; retryable: boolean }>;
  /**
   * How far each seed proposal got on its way to the room, by workspace path.
   * Absent until a proposal is made.
   *
   * A proposal that never reached the service used to look exactly like one the
   * service refused, and exactly like one still in flight: all three are just
   * "the root is not there yet". This is the DELIVERY half of that fact; the
   * `seedFailures` report above is the arbitration half.
   */
  seedDeliveries?: Record<string, CoeditSeedDeliveryState>;
}

/**
 * How far a seed proposal got on its way to the room.
 *
 * Presence in the ledger IS the "proposed" fact, and only TERMINAL states are
 * stored: an intermediate `proposed` value would be overwritten by the terminal
 * one on every pass, so the ledger would alternate, each alternation would
 * publish a snapshot, and the snapshot would re-run the effect that proposes.
 *
 *   relayed       — put on the wire
 *   queued        — held until the transport comes up
 *   invalid-frame — the shared validator refused to build it; never sent
 *   relay-failed  — the transport threw, or the frame was dropped unsent
 */
export type CoeditSeedDelivery = "relayed" | "queued" | "invalid-frame" | "relay-failed";

export interface CoeditSeedDeliveryState {
  delivery: CoeditSeedDelivery;
  /** Content-free explanation when the delivery is not a plain `relayed`. */
  detail: string | null;
}

/** The workspace path inside a queued seed frame, or null for any other frame. */
function seedPathOfPayload(payload: string): string | null {
  try {
    const parsed = JSON.parse(payload) as { type?: unknown; path?: unknown };
    return parsed.type === "coedit.seed" && typeof parsed.path === "string" && parsed.path
      ? parsed.path
      : null;
  } catch {
    return null;
  }
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
  private readonly listeners = new Set<
    (snapshot: PromptCoeditSnapshot, reason: CoeditChangeReason) => void
  >();

  /**
   * Seed outcomes the service reported, by workspace path. Applied seeds are
   * removed rather than recorded: the common case must not grow this map, and
   * "the room holds this root" is already visible in the document itself.
   */
  private readonly seedFailures = new Map<
    string,
    { outcome: WorkspaceSeedOutcome; retryable: boolean }
  >();

  /**
   * How far each seed proposal got, by workspace path.
   *
   * Records the LAST attempt, so a retry that reaches the wire clears an
   * earlier failure rather than leaving a stale verdict on screen.
   */
  private readonly seedDeliveries = new Map<string, CoeditSeedDeliveryState>();

  private token: PromptCoeditToken;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private refreshInFlight = false;
  private disposed = false;

  private ready = false;
  private networkSynced = false;
  private connected = false;
  private connectionPhase: CoeditConnectionPhase = "connecting";
  private hasEstablishedConnection = false;
  private lifecyclePhase: CoeditLifecyclePhase = "active";
  private published = false;
  private readOnly: boolean;
  private issue: CoeditLifecycleIssue = "none";
  private issueMessage: string | null = null;
  private acknowledgedStateVector: string | null = null;
  private questionRevision: number | null = null;
  private lastError: { message: string; retryable: boolean } | null = null;
  private localStateVector: string | null = null;
  private storeInFlight = false;
  private pendingSince: number | null = null;
  private lastAckedRevision: string | null = null;
  /**
   * Newest durable commit sequence this tab has been acknowledged for. Tracked
   * separately from `lastAckedRevision` because a UI-only workspace commit
   * shares the materialized revision while still being strictly newer work.
   */
  private lastAckedCommitSequence: CoeditDecimalString | null = null;
  /** Durable epoch of the room, advanced by acknowledgements. */
  private stateEpoch: CoeditDecimalString;
  /**
   * Epoch this tab's local cache was created under. It never changes: the
   * attachment is bound to the namespace the session opened in, so a mid-session
   * compaction can never make this tab write into, or merge, the new epoch.
   */
  private readonly cacheEpoch: CoeditDecimalString;
  /** Preserved older-epoch copies; never merged, exportable, explicitly discarded. */
  private staleCaches: CoeditStaleCacheReport[] = [];
  private staleCacheAudited = false;
  /** Flushes waiting for the state to become decidable. */
  private readonly flushWaiters = new Set<(result: CoeditFlushResult) => void>();
  private localReady = false;
  private localReadyTimer: ReturnType<typeof setTimeout> | null = null;
  /**
   * Outbound stateless frames awaiting a transport, keyed by their own
   * idempotency id (a command id or a seed id). One queue, because both kinds
   * describe a decision already made locally and re-proposing either one after
   * a reconnect is a duplicate, not a second decision.
   */
  private readonly pendingStatelessFrames = new Map<string, string>();
  private static readonly MAX_PENDING_STATELESS_FRAMES = 128;

  constructor(options: PromptCoeditProviderOptions) {
    this.options = options;
    this.documentName = options.documentName;
    this.field = options.field;
    this.token = options.token;
    this.readOnly = options.readOnly;
    this.stateEpoch = options.stateEpoch ?? "0";
    this.cacheEpoch = this.stateEpoch;
    this.ydoc = new Y.Doc();
    this.local = attachIndexedDbPersistence({
      documentName: this.documentName,
      stateEpoch: this.cacheEpoch,
      ydoc: this.ydoc,
    });

    this.hocuspocus = new HocuspocusProvider({
      url: options.serviceUrl,
      name: this.documentName,
      document: this.ydoc,
      token: () => this.requestToken(),
      onSynced: () => {
        this.networkSynced = true;
        // Initial sync is itself proof that the socket is live and
        // authenticated, so the connectivity fact is derived from it as well as
        // from the status callback. Relying on `onStatus` alone is a silent
        // single point of failure: if it never reports "connected" for this
        // client, `connected` stays false, every stateless frame is held, and a
        // seed proposal never reaches the room while the editor waits for a
        // root that was never asked for.
        if (!this.connected) {
          this.connected = true;
          this.connectionPhase = "connected";
          this.hasEstablishedConnection = true;
          if (this.issue === "offline") {
            this.issue = "none";
            this.issueMessage = null;
          }
        }
        // Flush on sync as well as on a status transition: the common case is a
        // seed proposed in the same window the room opened, and a frame queued
        // after the last transition would otherwise wait for a transition that
        // may never come.
        this.flushStatelessFrames();
        this.openReadinessBarrier();
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
          this.recompute("status");
          return;
        }
        this.issue = "token_expired";
        this.issueMessage = "The collaboration session expired; requesting a new session.";
        this.options.onLifecycle?.(this.issue, this.issueMessage);
        void this.refreshNow();
        this.recompute("status");
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
        if (this.connected) this.flushStatelessFrames();
        this.recompute("status");
      },
      onAwarenessUpdate: () => this.recompute("presence"),
      onStateless: ({ payload }) => this.handleStateless(payload),
      onDisconnect: () => {
        this.connected = false;
        this.connectionPhase = "disconnected";
        // Local edits continue while the network is unavailable; the Y.Doc and
        // IndexedDB keep the work, and the save state becomes unsaved rather
        // than falsely saved.
        this.issue = this.issue === "none" ? "offline" : this.issue;
        this.recompute("status");
      },
      onClose: ({ event }) => {
        this.connected = false;
        this.connectionPhase = "disconnected";
        // A close that carries the service's lifecycle prefix is a decision,
        // not a dropped socket: the room is over, and the design requires the
        // prompt to be offered for copy/export before a replacement draft is
        // opened ("Offline and recovery behavior",
        // docs/sat-authoring-coedit.md). Every other close stays on the
        // reconnecting/offline path.
        const lifecycle = coeditLifecycleFromCloseReason(event?.reason);
        if (lifecycle) {
          this.enterTerminal(lifecycle.issue, lifecycle.message, lifecycle.published === true);
        }
        else this.recompute("status");
      },
    });

    this.ydoc.on("update", this.onDocumentUpdate);
    this.markLocalReadyWhenReplayed();
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

  /**
   * Re-opens the transport and asks the room to store what this tab holds.
   *
   * A reconnect alone was not a retry: the service stores a document only when
   * an update re-arms its store debounce, so pressing Retry after a failed save
   * left the status at "Still saving…" with nothing in flight until the author
   * happened to type again. The request is the honest half of the action — it
   * makes the work this tab is holding the subject of the next store, and the
   * ordinary acknowledgement or refusal frame decides the status from there.
   */
  retry(): void {
    if (this.disposed) return;
    this.lastError = null;
    if (!this.isTerminal) {
      this.issue = "none";
      this.issueMessage = null;
    }
    void this.hocuspocus.connect().catch(() => undefined);
    this.requestStore();
    this.recompute("status");
  }

  /**
   * Asks the service to store this room's current state, if there is anything
   * to store.
   *
   * Returns false when the request is meaningless — a torn-down or terminal
   * room, a session that may not write, or local state the room has already
   * acknowledged (nothing is pending, so a store would only send it back). A
   * request made while the socket is down is queued under the room's own key, so
   * pressing Retry offline asks once and the frame goes out on reconnect.
   */
  private requestStore(): boolean {
    if (this.disposed || this.isTerminal || this.readOnly || this.options.readOnly) return false;
    const current = this.currentStateVector();
    if (this.acknowledgedStateVector !== null && current === this.acknowledgedStateVector) return false;
    let payload: string;
    try {
      payload = JSON.stringify(createCoeditStoreRequest(this.documentName));
    } catch {
      return false;
    }
    return this.sendStatelessFrame(`store:${this.documentName}`, payload);
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
    return this.sendStatelessFrame(command.commandId, payload);
  }

  /**
   * Proposes one server-arbitrated workspace seed.
   *
   * A seed is not a local write. Two authors opening the same empty room both
   * see an empty root, so the ROOM decides which proposal becomes content; the
   * accepted value comes back as an ordinary Yjs update. The frame is keyed by
   * its deterministic seed id, so re-proposing the same seed while offline
   * replaces the queued copy instead of sending a second one when the room
   * reconnects.
   */
  sendWorkspaceSeed(frame: WorkspaceSeedFrame): boolean {
    if (this.disposed || this.isTerminal) {
      this.recordSeedDelivery(frame.path, "relay-failed", "the room is no longer open");
      return false;
    }
    let payload: string;
    try {
      payload = JSON.stringify(frame);
    } catch {
      this.recordSeedDelivery(frame.path, "invalid-frame", "the proposal is not serializable");
      return false;
    }
    // Read the transport state BEFORE the send: `sendStatelessFrame` either
    // relays now or holds the frame, and the two mean different things to an
    // editor that is waiting on the result.
    const queued = !this.connected;
    if (!this.sendStatelessFrame(frame.seedId, payload)) {
      this.recordSeedDelivery(frame.path, "relay-failed", "the transport refused the proposal");
      return false;
    }
    this.recordSeedDelivery(
      frame.path,
      queued ? "queued" : "relayed",
      queued ? "waiting for the collaboration socket" : null,
    );
    return true;
  }

  /**
   * Records how far one seed proposal got. Content-free, and published with the
   * snapshot so a field that is waiting can say WHICH wait it is in.
   *
   * `proposed` and `relayed` clear any previous detail: a retry that reached the
   * wire must not leave an earlier refusal on screen.
   */
  recordSeedDelivery(
    path: string,
    delivery: CoeditSeedDelivery,
    detail: string | null = null,
  ): void {
    const normalized = path.trim();
    if (!normalized) return;
    const previous = this.seedDeliveries.get(normalized);
    if (previous && previous.delivery === delivery && previous.detail === detail) return;
    this.seedDeliveries.set(normalized, { delivery, detail });
    if (!this.disposed) this.recompute("status");
  }

  /**
   * Sends one stateless frame, or holds it until the transport is up. Both
   * callers have already committed to the frame locally (a mutation that
   * committed, or a proposal the service will arbitrate), so dropping it on a
   * brief network race would silently lose the signal it carries.
   */
  private sendStatelessFrame(frameId: string, payload: string): boolean {
    if (!this.connected) {
      this.pendingStatelessFrames.set(frameId, payload);
      this.evictOutboundOverflow();
      return true;
    }
    return this.relayStatelessFrame(frameId, payload);
  }

  /**
   * Keeps the off-line outbound queue bounded without losing a seed.
   *
   * Evicting the oldest entry blindly dropped exactly the frames an editor was
   * waiting on: a seed whose proposal never leaves the browser is a field that
   * can never initialize. Non-seed frames (commands, store requests) are
   * signals that a later state subsumes, so they are evicted first — and if a
   * seed must go, its path records that it did.
   */
  private evictOutboundOverflow(): void {
    while (this.pendingStatelessFrames.size > PromptCoeditProvider.MAX_PENDING_STATELESS_FRAMES) {
      const frameIds = [...this.pendingStatelessFrames.keys()];
      const victim = frameIds.find((frameId) => !frameId.startsWith("seed-")) ?? frameIds[0];
      if (typeof victim !== "string") return;
      const payload = this.pendingStatelessFrames.get(victim);
      this.pendingStatelessFrames.delete(victim);
      const path = payload === undefined ? null : seedPathOfPayload(payload);
      if (path !== null) {
        this.recordSeedDelivery(path, "relay-failed", "dropped from the outbound queue");
      }
    }
  }

  /** Apply a lifecycle read-only decision without remounting editors. */
  setReadOnly(readOnly: boolean): void {
    if (this.disposed || this.isTerminal) return;
    this.readOnly = readOnly;
    this.recompute("status");
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
      writeCapable: !this.options.readOnly,
      saveState: this.currentSaveState(),
      collaborators: this.currentCollaborators(),
      stateEpoch: this.stateEpoch,
      ...(this.lastAckedCommitSequence === null
        ? {}
        : { commitSequence: this.lastAckedCommitSequence }),
      flushAndWaitForSaved: (timeoutMs: number) => this.flushAndWaitForSaved(timeoutMs),
      recovery: {
        issue: this.issue,
        message: this.issueMessage,
        published: this.published,
        // A closed/replaced room offers the export unless it was published
        // (the work is durable). A refused or oversized write is the other
        // case where local content is not durable, so it must offer it too.
        canExport:
          ((this.issue === "closed" || this.issue === "replaced") && !this.published) ||
          this.issue === "rejected" ||
          this.issue === "oversized",
        exportPrompt: () => {
          const fragment = this.ydoc.getXmlFragment(this.field);
          return fragment.length > 0 ? this.ydoc.getXmlFragment(this.field).toJSON() : null;
        },
        discardLocal: async () => {
          await this.local.destroy();
        },
        canExportStaleCache: this.staleCaches.length > 0,
        exportStaleCache: () => this.staleCacheExports(),
        discardStaleCache: () => this.discardStaleCaches(),
        reload: () => {
          void this.refreshNow();
        },
      },
      destroy: () => this.destroy(),
    };
  }

  subscribe(
    listener: (snapshot: PromptCoeditSnapshot, reason: CoeditChangeReason) => void,
  ): () => void {
    this.listeners.add(listener);
    listener(this.snapshot(), "content");
    return () => {
      this.listeners.delete(listener);
    };
  }

  snapshot(): PromptCoeditSnapshot {
    return {
      ready: this.ready,
      localReady: this.localReady,
      connected: this.connected,
      connectionPhase: this.connectionPhase,
      hasEstablishedConnection: this.hasEstablishedConnection,
      lifecyclePhase: this.lifecyclePhase,
      ...(this.pendingSince === null ? {} : { pendingSince: this.pendingSince }),
      ...(this.lastAckedRevision === null ? {} : { lastAckedRevision: this.lastAckedRevision }),
      stateEpoch: this.stateEpoch,
      ...(this.lastAckedCommitSequence === null
        ? {}
        : { commitSequence: this.lastAckedCommitSequence }),
      readOnly: this.readOnly,
      writeCapable: !this.options.readOnly,
      saveState: this.currentSaveState(),
      collaborators: this.currentCollaborators(),
      issue: this.issue,
      issueMessage: this.issueMessage,
      published: this.published,
      ...(this.seedFailures.size === 0 ? {} : { seedFailures: this.seedFailureMap() }),
      ...(this.seedDeliveries.size === 0
        ? {}
        : { seedDeliveries: Object.fromEntries(this.seedDeliveries) }),
    };
  }

  /** The reported seed failures as a plain record for the snapshot. */
  private seedFailureMap(): Record<string, { outcome: WorkspaceSeedOutcome; retryable: boolean }> {
    return Object.fromEntries(this.seedFailures);
  }

  /**
   * Base64 of the local state vector — the exact state "Saved" is judged
   * against. Empty for an empty document, so it is never absent.
   */
  currentStateVector(): string {
    return encodeStateVectorBase64(this.ydoc);
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
    if (this.localReadyTimer !== null) {
      clearTimeout(this.localReadyTimer);
      this.localReadyTimer = null;
    }
    // A flush waiting on a transport that is being torn down would otherwise
    // hang until its own deadline: the room is over, and that is the outcome.
    for (const waiter of [...this.flushWaiters]) waiter(this.flushOutcomeFor("ended"));
    this.flushWaiters.clear();
    this.ydoc.off("update", this.onDocumentUpdate);
    this.pendingStatelessFrames.clear();
    try {
      this.hocuspocus.destroy();
    } catch {
      // Teardown is best-effort: a throw here must not strand React state.
    }
    this.listeners.clear();
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
    this.recompute("status");
  }

  private readonly onDocumentUpdate = () => {
    if (this.disposed) return;
    this.localStateVector = this.currentStateVector();
    // Once the edit has been applied to the Y.Doc AND the transport is up, it
    // has been accepted by Hocuspocus and is awaiting the Go/MySQL commit — the
    // design's `Syncing` rung. While the transport is down it stays `Unsaved`
    // (the disconnected branch of deriveSaveState outranks this), so the editor
    // never claims a server has seen work it has not.
    if (this.localStateVector === this.acknowledgedStateVector) {
      this.pendingSince = null;
      this.storeInFlight = false;
    } else {
      this.pendingSince ??= Date.now();
      this.storeInFlight = this.connected;
    }
    // The only frame that can change projected workspace content.
    this.recompute("content");
  };

  private currentSaveState(): CoeditSaveState {
    return deriveSaveState({
      localStateVector: this.localStateVector,
      acknowledgedStateVector: this.acknowledgedStateVector,
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

  private flushStatelessFrames(): void {
    if (!this.connected || this.disposed || this.isTerminal) return;
    for (const [frameId, payload] of this.pendingStatelessFrames) {
      if (!this.relayStatelessFrame(frameId, payload)) break;
      // A seed that was waiting is on the wire now, and the field waiting on it
      // should stop reporting a transport problem.
      const path = seedPathOfPayload(payload);
      if (path !== null) this.recordSeedDelivery(path, "relayed");
    }
  }

  private relayStatelessFrame(frameId: string, payload: string): boolean {
    try {
      this.hocuspocus.sendStateless(payload);
      this.pendingStatelessFrames.delete(frameId);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Resolves the local half of readiness — from a completed replay, or from the
   * bounded grace period when IndexedDB cannot replay at all.
   */
  private markLocalReadyWhenReplayed(): void {
    if (this.local.localSynced === true) {
      this.localReady = true;
      this.openReadinessBarrier();
      return;
    }
    const settle = (): void => {
      if (this.localReadyTimer !== null) {
        clearTimeout(this.localReadyTimer);
        this.localReadyTimer = null;
      }
      if (this.localReady || this.disposed) return;
      this.localReady = true;
      this.openReadinessBarrier();
    };
    void this.local.whenSynced.then(settle).catch(() => undefined);
    this.localReadyTimer = setTimeout(() => {
      // A store that never opens must not withhold the first seed, or the
      // editor itself, forever: the workspace would render empty with no way
      // for the author to fill it.
      settle();
    }, COEDIT_LOCAL_REPLAY_GRACE_MS);
    this.localReadyTimer.unref?.();
  }

  /**
   * Readiness is the AND of the two facts, in either order of arrival.
   *
   * The editor may only mount once BOTH hold. Replaying the local copy after an
   * editor had already written into the fragment would merge recovered content
   * underneath the author's first keystrokes, so the local half is not merely a
   * seed gate: it is part of what "ready" means.
   */
  private openReadinessBarrier(): void {
    if (this.ready || this.disposed || !this.networkSynced || !this.localReady) return;
    this.ready = true;
    this.localStateVector = this.currentStateVector();
    if (this.localStateVector === this.acknowledgedStateVector) {
      this.pendingSince = null;
      this.storeInFlight = false;
    } else if (this.storeInFlight) {
      this.pendingSince ??= Date.now();
    }
    this.recompute("status");
    void this.auditStaleCaches();
  }

  /**
   * Reconciles older-epoch local copies once, after the room is fully open.
   *
   * This is the only place that decides whether an unreachable copy is safe to
   * clear. It never merges one: a compacted room's rebuilt identity would treat
   * the old history as new content. A divergent copy is preserved and reported
   * (see `recovery.exportStaleCache`), which is what keeps unsynced local work
   * from being thrown away by a background step.
   */
  private async auditStaleCaches(): Promise<void> {
    if (this.staleCacheAudited) return;
    this.staleCacheAudited = true;
    let audit;
    try {
      audit = await auditEpochCaches({
        documentName: this.documentName,
        stateEpoch: this.cacheEpoch,
        ydoc: this.ydoc,
      });
    } catch {
      // An audit that could not run leaves every copy in place.
      return;
    }
    if (this.disposed || audit.divergent.length === 0) return;
    this.staleCaches = audit.divergent;
    // Reported as a recovery, not a save failure: the room's own content is
    // durable. What is at stake is the older copy on this device.
    if (this.issue === "none") {
      this.issue = "stale_cache";
      this.issueMessage = COEDIT_STALE_CACHE_MESSAGE;
      this.options.onLifecycle?.("stale_cache", this.issueMessage);
    }
    this.recompute("status");
  }

  /** Byte-exact exports of every preserved older-epoch copy. */
  private staleCacheExports(): CoeditStaleCacheExport[] | null {
    if (this.staleCaches.length === 0) return null;
    return this.staleCaches.map((report) => ({
      room: this.documentName,
      stateEpoch: report.stateEpoch,
      update: report.updateBase64,
      stateVector: report.stateVectorBase64,
    }));
  }

  /**
   * Deletes the preserved copies. Only an explicit user discard may call this:
   * these namespaces hold work the room does not have, so nothing here is
   * removed on the client's own initiative.
   */
  private async discardStaleCaches(): Promise<void> {
    const reports = this.staleCaches;
    this.staleCaches = [];
    for (const report of reports) {
      await clearEpochCache(report.cacheName).catch(() => undefined);
    }
    if (this.issue === "stale_cache") {
      this.issue = "none";
      this.issueMessage = null;
      this.options.onLifecycle?.("none", null);
    }
    this.recompute("status");
  }

  /**
   * Flushes what this tab is holding and waits for the EXACT state vector it
   * holds to become durable.
   *
   * A best-effort `destroy()` is not a durability guarantee, and the caller is
   * usually about to navigate away from content that reads from the committed
   * projection. So the transport's pending update buffer is flushed first, and
   * the promise resolves only when the acknowledgement covers the vector this
   * tab has right now. Anything else — a deadline, a lost socket, a refusal, a
   * preserved stale copy — is returned as its own outcome so the caller can
   * block and explain instead of claiming Saved.
   */
  async flushAndWaitForSaved(timeoutMs: number): Promise<CoeditFlushResult> {
    try {
      // Hocuspocus buffers outgoing updates for its `flushDelay` window; a
      // navigation should not have to outlive that timer.
      this.hocuspocus.flushPendingUpdates();
    } catch {
      // A torn-down transport cannot flush; the state check below decides.
    }
    const decided = this.flushResultNow();
    if (decided) return decided;
    return await new Promise<CoeditFlushResult>((resolve) => {
      const finish = (result: CoeditFlushResult): void => {
        this.flushWaiters.delete(finish);
        clearTimeout(timer);
        resolve(result);
      };
      const timer = setTimeout(() => {
        // The deadline is a classification, not a failure to report as saved.
        finish(this.flushOutcomeFor("pending"));
      }, Math.max(0, timeoutMs));
      timer.unref?.();
      this.flushWaiters.add(finish);
    });
  }

  /**
   * The flush outcome if it is already decidable, or null while genuinely
   * pending. Ordered so that proven durability always wins: an acknowledged
   * state is Saved even if the socket has since dropped.
   */
  private flushResultNow(): CoeditFlushResult | null {
    const current = this.currentStateVector();
    if (
      this.acknowledgedStateVector !== null &&
      current === this.acknowledgedStateVector
    ) {
      return this.flushOutcomeFor("saved");
    }
    if (this.isTerminal) return this.flushOutcomeFor("ended");
    if (this.issue === "rejected" || this.issue === "oversized") {
      return this.flushOutcomeFor("refused");
    }
    if (this.staleCaches.length > 0) return this.flushOutcomeFor("stale_cache");
    if (!this.connected) return this.flushOutcomeFor("offline");
    if (this.readOnly) return this.flushOutcomeFor("read_only");
    // The room was compacted while this tab was open: the local copy and the
    // durable state are in different epochs, and no acknowledgement of THIS
    // vector can arrive until the author's work is rebased by reopening.
    if (this.stateEpoch !== this.cacheEpoch) return this.flushOutcomeFor("stale_cache");
    return null;
  }

  private flushOutcomeFor(outcome: CoeditFlushResult["outcome"]): CoeditFlushResult {
    return { outcome, saved: outcome === "saved", stateVector: this.currentStateVector() };
  }

  /** Resolves every waiting flush whose outcome has become decidable. */
  private settleFlushes(): void {
    if (this.flushWaiters.size === 0) return;
    const result = this.flushResultNow();
    if (!result) return;
    for (const waiter of [...this.flushWaiters]) waiter(result);
    this.flushWaiters.clear();
  }

  private recompute(reason: CoeditChangeReason = "content"): void {
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
      listener(snapshot, reason);
    }
    this.settleFlushes();
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
      this.recompute("status");
      return;
    }
    const saveFailure = parseCoeditSaveFailureMessage(parsed);
    if (saveFailure) {
      if (saveFailure.documentName !== this.documentName) return;
      const recovery = coeditRecoveryFromSaveFailure(saveFailure);
      if (recovery) {
        // A refusal this editor cannot retry out of: the row's committed state
        // moved past this room's commit, the room refused the write, or the
        // document is over its size limit. The local work is real, so it is
        // offered for export instead of being looped against a fence that can
        // never be satisfied.
        const changed = this.issue !== recovery.issue;
        this.issue = recovery.issue;
        this.issueMessage = recovery.message;
        this.lastError = { message: recovery.message, retryable: false };
        this.storeInFlight = false;
        // Reported once per transition: a refused room sends this frame for
        // every refused update, and each one re-announcing would be noise.
        if (changed) this.options.onLifecycle?.(recovery.issue, recovery.message);
        this.recompute("status");
        return;
      }
      this.lastError = {
        message: "The latest changes could not be saved.",
        retryable: saveFailure.retryable,
      };
      this.storeInFlight = false;
      this.recompute("status");
      return;
    }
    const seedResult = parseWorkspaceSeedResultFrame(parsed, {
      documentName: this.documentName,
    });
    if (seedResult) {
      if (seedResult.outcome === "applied") {
        this.seedFailures.delete(seedResult.path);
      } else {
        this.seedFailures.set(seedResult.path, {
          outcome: seedResult.outcome,
          retryable: seedResult.retryable,
        });
      }
      this.recompute("status");
      return;
    }
    const workspaceCommand = parseSatWorkspaceCommand(parsed, {
      documentName: this.documentName,
    });
    if (workspaceCommand) {
      this.options.onWorkspaceCommand?.(workspaceCommand);
      this.recompute("status");
      return;
    }
    if (
      parsed === null ||
      typeof parsed !== "object" ||
      (parsed as { type?: unknown }).type !== "coedit.ack"
    ) return;
    const ack = parsed as Partial<CoeditCommitAck>;
    // Identity check: an acknowledgement for another room must never move this
    // editor to Saved, and an acknowledgement that carries no state vector
    // cannot prove durability at all, so it is ignored like a foreign name.
    if (
      typeof ack.documentName !== "string" ||
      ack.documentName !== this.documentName ||
      typeof ack.stateVector !== "string" ||
      ack.stateVector.length === 0
    ) return;
    // Ordering uses the durable commit sequence whenever both sides have one,
    // because the materialized revision cannot order UI-only commits: two
    // workspace commits that changed no question projection share a revision
    // while the later one is still strictly newer state. Only an OLDER sequence
    // is ignored — the same revision with a newer sequence is new work.
    const ackSequence = isCoeditDecimalString(ack.commitSequence) ? ack.commitSequence : null;
    if (ackSequence !== null && this.lastAckedCommitSequence !== null) {
      if (compareCoeditDecimalStrings(ackSequence, this.lastAckedCommitSequence) === null) return;
      if (compareCoeditDecimalStrings(ackSequence, this.lastAckedCommitSequence)! <= 0) return;
    } else {
      // A legacy service (or the first acknowledgement after opening) carries no
      // sequence: fall back to the monotonic revision rule.
      const ackRevision =
        numericRevision(ack.materializedRevision) ?? numericRevision(ack.questionRevision);
      const previousRevision = numericRevision(this.lastAckedRevision);
      if (
        ackRevision !== null &&
        previousRevision !== null &&
        ackRevision <= previousRevision
      ) return;
      // The revision ledger is advanced ONLY here. A revision is not a commit
      // identity for this room: two UI-only commits share one, so once the
      // sequence is available it is the sole ordering fact, and lowering this
      // ledger to the newest sequence-bearing revision would make the next
      // sequence-less acknowledgement of an EQUAL revision look older —
      // refusing a commit that is already durable and stranding the editor at
      // Sending. A stale ledger can only ever be lower than the truth, and the
      // fallback rule re-admits anything newer than it.
      if (ackRevision !== null) this.lastAckedRevision = String(ackRevision);
    }
    this.acknowledgedStateVector = ack.stateVector;
    this.questionRevision =
      typeof ack.questionRevision === "number" ? ack.questionRevision : this.questionRevision;
    if (ackSequence !== null) this.lastAckedCommitSequence = ackSequence;
    const ackEpoch = isCoeditDecimalString(ack.stateEpoch) ? ack.stateEpoch : null;
    if (
      ackEpoch !== null &&
      (compareCoeditDecimalStrings(ackEpoch, this.stateEpoch) ?? 0) > 0
    ) {
      // The room was compacted while this tab was open. The epoch is recorded so
      // the next open reads the right cache namespace; this tab's own cache is
      // NOT re-pointed, because the attachment holds the copy of what is on
      // screen and the next open audits it against the compacted room.
      this.stateEpoch = ackEpoch;
    }
    // Acknowledging an older state does not clear pending work. The exact
    // current state vector must be acknowledged before the UI may say Saved.
    const current = this.currentStateVector();
    if (current === ack.stateVector) {
      this.pendingSince = null;
      this.storeInFlight = false;
      if (this.issue === "rejected" || this.issue === "oversized") {
        // The exact current state is committed, so nothing is at risk any
        // more: a refusal recovery that stayed on screen after the work became
        // durable would be a false alarm the author cannot dismiss.
        this.issue = "none";
        this.issueMessage = null;
        // The UI half holds its own error state and only a lifecycle
        // transition clears it, so the recovery would leave while the save
        // area kept reporting the failure.
        this.options.onLifecycle?.("none", null);
      }
    } else {
      this.pendingSince ??= Date.now();
      this.storeInFlight = this.connected;
    }
    this.lastError = null;
    this.issue = this.issue === "service_unavailable" ? "none" : this.issue;
    this.recompute("status");
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
      this.recompute("status");
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
      this.recompute("status");
      return this.token.token;
    }
  }
}

export { INITIAL_SAVE_STATE };
