import type * as Y from "yjs";
import {
  applyBinaryState,
  assertStateWithinLimit,
  currentStateHash,
  encodeStateAsUpdate,
  encodeStateVector,
  fromBase64,
  projectPrompt,
  projectPromptJson,
  projectWorkspace,
  projectWorkspaceJson,
  seedYDocFromPrompt,
  toBase64,
} from "./documentCodec.js";
import { FIELD_SET_WORKSPACE, parseAnyDocumentName } from "./documentIdentity.js";
import { GoAuthoringClient, GoRequestError } from "./goAuthoringClient.js";
import { metrics, log } from "./telemetry.js";

/**
 * Load and store hooks.
 *
 * The store hook is the ONLY writer of collaborative state, and it fails
 * loudly: throwing leaves the document dirty and in memory, so Hocuspocus
 * retries after the debounce instead of dropping the change. A failed store is
 * never converted into an acknowledgement.
 */
export interface CoeditCommit {
  stateHash: string;
  questionRevision: number;
  materializedRevision: number;
  acknowledgedAt: number;
}

export interface LoadHookInput {
  documentName: string;
  document: Y.Doc;
  context: Record<string, unknown> | undefined;
}

export interface StoreHookInput {
  documentName: string;
  document: Y.Doc;
  context: Record<string, unknown> | undefined;
}

/** Stateless acknowledgement payload broadcast to room peers. */
export interface CoeditAckPayload {
  type: "coedit.ack";
  documentName: string;
  stateHash: string;
  questionRevision: number;
  materializedRevision: number;
}

export class CoeditPersistence {
  private readonly go: GoAuthoringClient;
  private readonly commits = new Map<string, CoeditCommit>();
  private readonly inflight = new Map<string, Promise<CoeditCommit>>();
  private broadcaster: ((documentName: string, payload: string) => void) | null = null;

  constructor(go: GoAuthoringClient) {
    this.go = go;
  }

  /** The server installs its stateless broadcaster once it is listening. */
  setBroadcaster(fn: (documentName: string, payload: string) => void): void {
    this.broadcaster = fn;
  }

  lastCommit(documentName: string): CoeditCommit | null {
    return this.commits.get(documentName) ?? null;
  }

  async load(input: LoadHookInput): Promise<void> {
    const { documentName, document } = input;
    const isWorkspace = parseAnyDocumentName(documentName)?.fieldSet === FIELD_SET_WORKSPACE;
    const result = await this.go.load(documentName);

    if (result.lifecycleState === "closed") {
      metrics.incCounter("authoring_coedit_auth_total", { outcome: "closed" });
      throw new Error("coedit_document_closed");
    }

    const binary = fromBase64(result.ydocState);
    if (binary && binary.byteLength > 0) {
      // Binary reload path: the committed history is returned unchanged.
      applyBinaryState(document, binary);
      if (result.stateHash) {
        this.commits.set(documentName, {
          stateHash: result.stateHash,
          questionRevision: result.questionRevision,
          materializedRevision: result.materializedRevision,
          acknowledgedAt: Date.now(),
        });
      }
      return;
    }

    if (isWorkspace) {
      // Workspace rooms intentionally start empty. The browser seeds the
      // authoritative shell/question/access snapshots into named roots after
      // initial sync; the empty initialization still establishes an exact
      // durable acknowledgement so the first UI state is not falsely Saved.
      const state = encodeStateAsUpdate(document);
      assertStateWithinLimit(state);
      const stateHash = currentStateHash(document);
      await this.go.initialize({
        documentName,
        ydocState: toBase64(state),
        stateVector: toBase64(encodeStateVector(document)),
        stateHash,
        prompt: null,
        workspace: projectWorkspace(document),
        actorId: typeof input.context?.["actorId"] === "string" ? input.context["actorId"] as string : "",
      });
      this.commits.set(documentName, {
        stateHash,
        questionRevision: result.materializedRevision,
        materializedRevision: result.materializedRevision,
        acknowledgedAt: Date.now(),
      });
      metrics.incCounter("authoring_coedit_store_total", { outcome: "accepted" });
      return;
    }

    if (!result.seed) {
      // No binary state and no seed: the row is in a state this process cannot
      // resolve. Refusing is correct — an empty document must never be
      // rendered as an editable prompt.
      throw new Error("coedit_seed_unresolved");
    }

    // First seed: convert the HTTP prompt into the `prompt` fragment, then
    // commit the binary WITHOUT bumping the question revision, because the
    // materialized prompt is unchanged by seeding.
    const seeded = seedYDocFromPrompt(result.seed.prompt);
    try {
      applyBinaryState(document, encodeStateAsUpdate(seeded));
    } finally {
      seeded.destroy();
    }
    const state = encodeStateAsUpdate(document);
    assertStateWithinLimit(state);
    const actorId = typeof input.context?.["actorId"] === "string" ? (input.context["actorId"] as string) : "";
    await this.go.initialize({
      documentName,
      ydocState: toBase64(state),
      stateVector: toBase64(encodeStateVector(document)),
      stateHash: currentStateHash(document),
      prompt: projectPrompt(document),
      actorId,
    });
    this.commits.set(documentName, {
      stateHash: currentStateHash(document),
      questionRevision: result.seed.questionRevision,
      materializedRevision: result.seed.questionRevision,
      acknowledgedAt: Date.now(),
    });
    metrics.incCounter("authoring_coedit_store_total", { outcome: "accepted" });
  }

  /**
   * Runs the store hook for one document.
   *
   * Concurrency: Hocuspocus serializes store hooks per document through its
   * save mutex, and this map adds a second guard so an explicit flush during a
   * freeze cannot race a debounced store.
   */
  async store(input: StoreHookInput): Promise<CoeditCommit> {
    const existing = this.inflight.get(input.documentName);
    if (existing) return existing;
    const running = this.runStore(input).finally(() => {
      this.inflight.delete(input.documentName);
    });
    this.inflight.set(input.documentName, running);
    return running;
  }

  private async runStore(input: StoreHookInput): Promise<CoeditCommit> {
    const { documentName, document } = input;
    const started = Date.now();
    const state = encodeStateAsUpdate(document);
    assertStateWithinLimit(state);
    const vector = encodeStateVector(document);
    const stateHash = currentStateHash(document);
    const isWorkspace = parseAnyDocumentName(documentName)?.fieldSet === FIELD_SET_WORKSPACE;
    const promptJson = isWorkspace ? null : projectPromptJson(document);
    const workspaceJson = isWorkspace ? projectWorkspaceJson(document) : null;
    const previous = this.commits.get(documentName);
    const actorId =
      typeof input.context?.["actorId"] === "string" ? (input.context["actorId"] as string) : "";

    try {
      const result = await this.go.store({
        documentName,
        previousStateHash: previous?.stateHash ?? "",
        stateHash,
        ydocState: toBase64(state),
        stateVector: toBase64(vector),
        prompt: promptJson === null ? null : JSON.parse(promptJson) as unknown,
        ...(workspaceJson === null ? {} : { workspace: JSON.parse(workspaceJson) as unknown }),
        actorId,
      });
      const commit: CoeditCommit = {
        stateHash: result.stateHash,
        questionRevision: result.questionRevision,
        materializedRevision: result.materializedRevision,
        acknowledgedAt: Date.now(),
      };
      this.commits.set(documentName, commit);
      metrics.incCounter("authoring_coedit_store_total", {
        outcome: result.duplicate ? "accepted" : "accepted",
      });
      this.observeDuration(Date.now() - started);
      // Stateless acknowledgement. A client marks Saved only when this hash
      // equals the hash of its CURRENT state vector.
      const payload: CoeditAckPayload = {
        type: "coedit.ack",
        documentName,
        stateHash: result.stateHash,
        questionRevision: result.questionRevision,
        materializedRevision: result.materializedRevision,
      };
      this.broadcaster?.(documentName, JSON.stringify(payload));
      return commit;
    } catch (error) {
      const reason = error instanceof GoRequestError ? error.reason : null;
      this.broadcaster?.(
        documentName,
        JSON.stringify({
          type: "coedit.save_failed",
          documentName,
          retryable: error instanceof GoRequestError ? error.retryable : true,
        }),
      );
      metrics.incCounter("authoring_coedit_store_total", {
        outcome: reason ? "rejected" : "unavailable",
      });
      log("warn", "coedit store failed", {
        event: "store_failed",
        reason: reason ?? "unavailable",
        durationMs: Date.now() - started,
      });
      // Rethrow: Hocuspocus keeps the document dirty and retries. A swallow
      // here would strand the author with a permanently unsaved prompt.
      throw error;
    }
  }

  private observeDuration(ms: number): void {
    metrics.incCounter("authoring_coedit_store_duration_seconds", {
      le: bucketFor(ms),
    });
  }

  /** Clears the in-memory commit record for a closed room. */
  forget(documentName: string): void {
    this.commits.delete(documentName);
    this.inflight.delete(documentName);
  }
}

const DURATION_BUCKETS_MS = [50, 100, 250, 500, 1000, 2000, 5000, 10000];

function bucketFor(ms: number): string {
  for (const bucket of DURATION_BUCKETS_MS) {
    if (ms <= bucket) return String(bucket);
  }
  return "+Inf";
}
