import * as Y from "yjs";
import {
  CodecError,
  applyBinaryState,
  assertStateWithinLimit,
  contentSignature,
  currentStateHash,
  encodeStateAsUpdate,
  encodeStateVector,
  fromBase64,
  projectPrompt,
  projectPromptJson,
  projectWorkspace,
  projectWorkspaceJson,
  rebuildWorkspaceDocument,
  seedYDocFromPrompt,
  toBase64,
} from "./documentCodec.js";
import { FIELD_SET_WORKSPACE, parseAnyDocumentName } from "./documentIdentity.js";
import { GoAuthoringClient, GoRequestError } from "./goAuthoringClient.js";
import { metrics, log } from "./telemetry.js";
import {
  COEDIT_SEED_CONFLICT_REASON,
  type CoeditDecimalString,
} from "../../../src/features/exam-authoring/realtime/coedit/protocol.js";

/**
 * Load and store hooks.
 *
 * The store hook is the ONLY writer of collaborative state, and it fails
 * loudly: throwing leaves the document dirty and in memory, so Hocuspocus
 * retries after the debounce instead of dropping the change. A failed store is
 * never converted into an acknowledgement.
 */
export interface CoeditCommit {
  /** Durable SHA-256 provenance hash (the MySQL `state_hash` column). */
  stateHash: string;
  /**
   * Base64 of the committed document's state vector. This is the identity a
   * client compares its own vector against before it may say Saved.
   */
  stateVector: string;
  questionRevision: number;
  materializedRevision: number;
  /** Additive lifecycle metadata; absent on legacy Go responses. */
  stateEpoch?: CoeditDecimalString;
  commitSequence?: CoeditDecimalString;
  workspaceRevision?: number;
  acknowledgedAt: number;
}

/** Durable lifecycle metadata returned alongside a loaded room. */
export interface CoeditLoadMetadata {
  documentName: string;
  lifecycleState: string;
  closedReason: string | null;
  freezeOperationId?: string;
  freezeExpiresAt?: number;
  stateEpoch?: CoeditDecimalString;
  commitSequence?: CoeditDecimalString;
  workspaceRevision?: number;
}

/**
 * Domain reasons a verbatim retry can NEVER satisfy: the row's committed state
 * hash moved past the commit this service holds (typically a service restart
 * that emptied the in-memory commit map, or a second replica). The room must
 * resync before it can save again — retrying the same store would repeat the
 * refusal forever, which is why these are reported as non-retryable with the
 * `requiresResync` flag instead of a bare `retryable: true`.
 */
const SAVE_RESYNC_REASONS: ReadonlySet<string> = new Set([
  "coedit_previous_hash_mismatch",
  "coedit_revision_conflict",
  COEDIT_SEED_CONFLICT_REASON,
]);

/**
 * State-vector size at which a load rebuilds the room's document.
 *
 * A Yjs state vector is a per-writer client-id ledger: 5-8 bytes for every
 * session that has ever edited the room, independent of how much content the
 * room holds. A long-lived draft therefore accumulates residue until it is
 * either this room's largest field or, past the column width, unsavable. The
 * vector is only as small as a fresh document when the document IS fresh, so
 * the load path is the one place this can be fixed: no client is attached yet,
 * and the durable projections (the materialized prompt for v1, the workspace
 * JSON for v2) describe everything a rebuild needs.
 *
 * The threshold is deliberately below the persisted limit rather than at it:
 * waiting for the limit would mean compacting exactly when a room is already
 * failing to save.
 */
const COMPACTION_STATE_VECTOR_THRESHOLD_BYTES = 2 << 10;

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

/** One store's encoded payload, produced once and reused for the wire call. */
interface CoeditStorePayload {
  state: Uint8Array;
  vector: Uint8Array;
  stateHash: string;
  prompt: unknown;
  workspace: unknown | null;
}

interface CompactionCandidate {
  state: Uint8Array;
  vector: Uint8Array;
  stateHash: string;
}

/** Stateless acknowledgement payload broadcast to room peers. */
export interface CoeditAckPayload {
  type: "coedit.ack";
  documentName: string;
  /** The exact committed state vector the client's own vector must equal. */
  stateVector: string;
  stateHash: string;
  questionRevision: number;
  materializedRevision: number;
  stateEpoch?: CoeditDecimalString;
  commitSequence?: CoeditDecimalString;
  workspaceRevision?: number;
}

type OptionalDurabilityFields = {
  stateEpoch?: CoeditDecimalString;
  commitSequence?: CoeditDecimalString;
  workspaceRevision?: number;
};

function optionalDurabilityFields(input: {
  stateEpoch?: CoeditDecimalString | undefined;
  commitSequence?: CoeditDecimalString | undefined;
  workspaceRevision?: number | undefined;
}): OptionalDurabilityFields {
  const fields: OptionalDurabilityFields = {};
  if (input.stateEpoch !== undefined) fields.stateEpoch = input.stateEpoch;
  if (input.commitSequence !== undefined) fields.commitSequence = input.commitSequence;
  if (input.workspaceRevision !== undefined) fields.workspaceRevision = input.workspaceRevision;
  return fields;
}

export class CoeditPersistence {
  private readonly go: GoAuthoringClient;
  private readonly commits = new Map<string, CoeditCommit>();
  private readonly inflight = new Map<string, Promise<CoeditCommit>>();
  /**
   * Authentication loads happen before Hocuspocus creates a document. Keep
   * that exact durable snapshot for the subsequent load hook so auth does not
   * create a second Go read (and so both decisions observe one row version).
   */
  private readonly preloaded = new Map<string, Awaited<ReturnType<GoAuthoringClient["load"]>>>();
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

  /**
   * Hydrates only the durable acknowledgement for an unloaded room. Lifecycle
   * manifests must still be complete when Hocuspocus has evicted a document;
   * there is no Y.Doc to flush in that case, so Go's committed load metadata is
   * the authoritative snapshot.
   */
  async refreshCommit(documentName: string): Promise<CoeditLoadMetadata> {
    const result = await this.go.load(documentName);
    const metadata = loadMetadata(result);
    if (result.lifecycleState === "closed") throw new Error("coedit_document_closed");
    if (!result.stateHash) {
      // A room that has no durable binary must not retain an older in-memory
      // commit and accidentally publish that stale manifest after unload.
      this.commits.delete(documentName);
      return metadata;
    }
    this.commits.set(documentName, {
      stateHash: result.stateHash,
      stateVector: result.stateVector ?? "",
      questionRevision: result.questionRevision,
      materializedRevision: result.materializedRevision,
      ...optionalDurabilityFields(result),
      acknowledgedAt: Date.now(),
    });
    return metadata;
  }

  /** Loads the durable lifecycle row once during authentication. */
  async preloadLifecycle(documentName: string): Promise<CoeditLoadMetadata> {
    try {
      const result = await this.go.load(documentName);
      this.preloaded.set(documentName, result);
      return loadMetadata(result);
    } catch (error) {
      // The Go load endpoint deliberately returns a domain error for closed
      // rows. Surface that state to authentication without treating it as an
      // unavailable dependency.
      if (error instanceof GoRequestError && error.reason === "coedit_document_closed") {
        return {
          documentName,
          lifecycleState: "closed",
          closedReason: "document_closed",
        };
      }
      throw error;
    }
  }

  discardPreloaded(documentName: string): void {
    this.preloaded.delete(documentName);
  }

  async load(input: LoadHookInput): Promise<CoeditLoadMetadata> {
    const { documentName, document } = input;
    const isWorkspace = parseAnyDocumentName(documentName)?.fieldSet === FIELD_SET_WORKSPACE;
    const result = this.preloaded.get(documentName) ?? (await this.go.load(documentName));
    this.preloaded.delete(documentName);
    let metadata = loadMetadata(result);

    if (result.lifecycleState === "closed") {
      metrics.incCounter("authoring_coedit_auth_total", { outcome: "closed" });
      throw new Error("coedit_document_closed");
    }

    const binary = fromBase64(result.ydocState);
    if (binary && binary.byteLength > 0) {
      // Binary reload path. Compaction is first built off-document and then
      // durably rebased. The fresh Hocuspocus document only receives the
      // candidate after Go has advanced the epoch, so a failed rebase can
      // never leave memory claiming a state that MySQL did not commit.
      const durable = new Y.Doc();
      try {
        applyBinaryState(durable, binary);
        const candidate = this.compactedState(documentName, durable);
        let applied = binary;
        let committedHash = result.stateHash;
        let committedVector = toBase64(encodeStateVector(durable));
        let durability = optionalDurabilityFields(result);
        if (candidate && result.stateHash && result.stateEpoch !== undefined) {
          try {
            const rebased = await this.go.rebase({
              documentName,
              expectedStateHash: result.stateHash,
              expectedStateEpoch: result.stateEpoch,
              stateHash: candidate.stateHash,
              ydocState: toBase64(candidate.state),
              stateVector: toBase64(candidate.vector),
            });
            if (rebased.stateHash !== candidate.stateHash) {
              throw new Error("coedit_rebase_hash_mismatch");
            }
            const verified = new Y.Doc();
            try {
              applyBinaryState(verified, candidate.state);
              if (currentStateHash(verified) !== rebased.stateHash) {
                throw new Error("coedit_rebase_state_mismatch");
              }
            } finally {
              verified.destroy();
            }
            applied = candidate.state;
            committedHash = rebased.stateHash;
            committedVector = toBase64(candidate.vector);
            durability = {
              ...optionalDurabilityFields(result),
              ...optionalDurabilityFields(rebased),
            };
            metrics.incCounter("authoring_coedit_compaction_total", { outcome: "accepted" });
            log("info", "coedit document compacted", {
              event: "compaction",
              outcome: "accepted",
              stage: "load",
              count: binary.byteLength - candidate.state.byteLength,
            });
          } catch (error) {
            this.skipCompaction("rebase_failed", error);
          }
        } else if (candidate) {
          // A pre-epoch Go deployment cannot safely install a new Yjs client
          // identity. Keep the durable binary until the epoch-aware API is
          // present; memory-only replacement would create false acknowledgements.
          this.skipCompaction("epoch_unavailable");
        }
        applyBinaryState(document, applied);
        if (committedHash) {
          this.commits.set(documentName, {
            stateHash: committedHash,
            stateVector: committedVector,
            questionRevision: result.questionRevision,
            materializedRevision: result.materializedRevision,
            ...durability,
            acknowledgedAt: Date.now(),
          });
        }
        if (applied !== binary) {
          metadata = {
            ...metadata,
            stateEpoch: durability.stateEpoch ?? metadata.stateEpoch,
            commitSequence: durability.commitSequence ?? metadata.commitSequence,
            workspaceRevision: durability.workspaceRevision ?? metadata.workspaceRevision,
          };
        }
      } finally {
        durable.destroy();
      }
      return metadata;
    }

    if (isWorkspace) {
      // Workspace rooms intentionally start empty. The browser seeds the
      // authoritative shell/question/access snapshots into named roots after
      // initial sync; the empty initialization still establishes an exact
      // durable acknowledgement so the first UI state is not falsely Saved.
      const state = encodeStateAsUpdate(document);
      assertStateWithinLimit(state);
      const stateHash = currentStateHash(document);
      const initialized = await this.go.initialize({
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
        stateVector: toBase64(encodeStateVector(document)),
        questionRevision: result.materializedRevision,
        materializedRevision: result.materializedRevision,
        ...optionalDurabilityFields({
          stateEpoch: initialized.stateEpoch ?? result.stateEpoch,
          commitSequence: initialized.commitSequence ?? result.commitSequence,
          workspaceRevision: initialized.workspaceRevision ?? result.workspaceRevision,
        }),
        acknowledgedAt: Date.now(),
      });
      metrics.incCounter("authoring_coedit_store_total", { outcome: "accepted" });
      return {
        ...metadata,
        lifecycleState: "active",
        ...optionalDurabilityFields({
          stateEpoch: initialized.stateEpoch ?? result.stateEpoch,
          commitSequence: initialized.commitSequence ?? result.commitSequence,
          workspaceRevision: initialized.workspaceRevision ?? result.workspaceRevision,
        }),
      };
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
    const initialized = await this.go.initialize({
      documentName,
      ydocState: toBase64(state),
      stateVector: toBase64(encodeStateVector(document)),
      stateHash: currentStateHash(document),
      prompt: projectPrompt(document),
      actorId,
    });
    this.commits.set(documentName, {
      stateHash: currentStateHash(document),
      stateVector: toBase64(encodeStateVector(document)),
      questionRevision: result.seed.questionRevision,
      materializedRevision: result.seed.questionRevision,
      ...optionalDurabilityFields({
        stateEpoch: initialized.stateEpoch ?? result.stateEpoch,
        commitSequence: initialized.commitSequence ?? result.commitSequence,
        workspaceRevision: initialized.workspaceRevision ?? result.workspaceRevision,
      }),
      acknowledgedAt: Date.now(),
    });
    metrics.incCounter("authoring_coedit_store_total", { outcome: "accepted" });
    metadata = {
      ...metadata,
      lifecycleState: "active",
      ...optionalDurabilityFields({
        stateEpoch: initialized.stateEpoch ?? result.stateEpoch,
        commitSequence: initialized.commitSequence ?? result.commitSequence,
        workspaceRevision: initialized.workspaceRevision ?? result.workspaceRevision,
      }),
    };
    return metadata;
  }

  /**
   * Runs the store hook for one document.
   *
   * Concurrency: Hocuspocus serializes store hooks per document through its
   * save mutex, and this map adds a second guard so an explicit flush during a
   * freeze cannot race a debounced store.
   */
  async store(input: StoreHookInput): Promise<CoeditCommit> {
    return this.runStoreDeduplicated(input, input.documentName, false, "");
  }

  /**
   * Stores the last state observed by a Go-owned lifecycle freeze. It has a
   * separate inflight key so an explicit lifecycle flush cannot accidentally
   * receive an ordinary-store acknowledgement.
   */
  async finalStore(input: StoreHookInput, freezeOperationId: string): Promise<CoeditCommit> {
    const operationID = freezeOperationId.trim();
    if (!operationID) throw new Error("coedit_freeze_operation_required");
    return this.runStoreDeduplicated(
      input,
      `final:${operationID}:${input.documentName}`,
      true,
      operationID,
    );
  }

  private async runStoreDeduplicated(
    input: StoreHookInput,
    inflightKey: string,
    finalStore: boolean,
    freezeOperationId: string,
  ): Promise<CoeditCommit> {
    const existing = this.inflight.get(inflightKey);
    if (existing) return existing;
    const running = this.runStore(input, finalStore, freezeOperationId).finally(() => {
      this.inflight.delete(inflightKey);
    });
    this.inflight.set(inflightKey, running);
    return running;
  }

  private async runStore(input: StoreHookInput, finalStore: boolean, freezeOperationId: string): Promise<CoeditCommit> {
    const { documentName, document } = input;
    const started = Date.now();
    let encoded: CoeditStorePayload;
    try {
      encoded = this.projectStore(documentName, document);
    } catch (error) {
      this.reportRefusal(documentName, error);
      // Rethrow so Hocuspocus keeps the document dirty: an author who removes
      // content makes the next store succeed, and a swallowed error would
      // strand that edit in memory with no durable copy.
      throw error;
    }
    const { state, vector, stateHash } = encoded;
    const previous = this.commits.get(documentName);
    const actorId =
      typeof input.context?.["actorId"] === "string" ? (input.context["actorId"] as string) : "";

    try {
      const storeBody = {
        documentName,
        previousStateHash: previous?.stateHash ?? "",
        stateHash,
        ydocState: toBase64(state),
        stateVector: toBase64(vector),
        prompt: encoded.prompt,
        ...(encoded.workspace === null ? {} : { workspace: encoded.workspace }),
        actorId,
      };
      const result = finalStore
        ? await this.go.finalStore({ ...storeBody, freezeOperationId })
        : await this.go.store(storeBody);
      // The durable hash must be the hash of the state THIS store sent, not of
      // the document as it stands now. Comparing against the live document
      // made every save under active typing look like a mismatch (the author
      // types during the ~70ms round trip, so the document has already moved
      // on), and the failure was not benign: the commit below was skipped, so
      // the next store sent a stale `previousStateHash` that Go fences with
      // `coedit_previous_hash_mismatch` forever, and a seed that reached this
      // path rejected the stateless hook that ran it. What must never happen
      // is still enforced, twice: the acknowledgement carries the committed
      // state VECTOR, and a client shows Saved only when that vector equals
      // its own current one (deriveSaveState), so a document that advanced
      // mid-store stays pending until the next store commits it.
      if (result.stateHash !== stateHash) {
        throw new Error("coedit_commit_state_mismatch");
      }
      const commit: CoeditCommit = {
        stateHash: result.stateHash,
        stateVector: toBase64(vector),
        questionRevision: result.questionRevision,
        materializedRevision: result.materializedRevision,
        ...optionalDurabilityFields(result),
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
        stateVector: toBase64(vector),
        stateHash: result.stateHash,
        questionRevision: result.questionRevision,
        materializedRevision: result.materializedRevision,
        ...optionalDurabilityFields(result),
      };
      this.broadcaster?.(documentName, JSON.stringify(payload));
      return commit;
    } catch (error) {
      const reason = error instanceof GoRequestError ? error.reason : null;
      const requiresResync = reason !== null && SAVE_RESYNC_REASONS.has(reason);
      this.broadcastFailure(documentName, {
        // A stale-hash refusal is a CLIENT outcome, not a transient one: mark
        // it non-retryable so the editor stops looping and tells the author to
        // reload instead of silently retrying forever.
        retryable: requiresResync
          ? false
          : error instanceof GoRequestError
            ? error.retryable
            : true,
        reason,
        requiresResync,
      });
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

  /**
   * Returns a durable compaction candidate, or null to keep the committed
   * binary. The caller must rebase the candidate before applying it.
   *
   * Rules, in order, because each one is a way to lose an author's work:
   *
   *   1. Below the threshold, nothing happens.
   *   2. The rebuild must carry the SAME content, proven by comparing a
   *      signature over the raw stored values of every root before anything is
   *      swapped. A difference means the projection is lossy for this document
   *      — an unparseable scalar, an unprojected root — and the original is
   *      kept.
   *   3. The rebuild must actually be smaller, so a compaction can never grow
   *      a document it failed to shrink.
   *   4. A failure anywhere is a skipped compaction, never a failed load: the
   *      room loads the committed binary exactly as before.
   *
   * Residual, stated because it is not nothing: a client that reconnects
   * holding older history re-adds its own client ids to this room's vector, so
   * compaction bounds the growth from sessions this service has seen instead of
   * eliminating it. Deleting the residue for good needs per-session rooms,
   * which is a document-identity decision, not a load-time one. The tombstone
   * history a rebuild drops is the same trade: content is preserved exactly,
   * while a stale client's older edit of a field can resurface as a merge
   * instead of being recognised as already deleted.
   */
  private compactedState(documentName: string, source: Y.Doc): CompactionCandidate | null {
    const parsed = parseAnyDocumentName(documentName);
    try {
      if (encodeStateVector(source).byteLength <= COMPACTION_STATE_VECTOR_THRESHOLD_BYTES) return null;
      const original = contentSignature(source);
      if (original === null) return this.skipCompaction("unprojected_root");
      const rebuilt = this.rebuild(source, parsed?.fieldSet === FIELD_SET_WORKSPACE);
      try {
        if (contentSignature(rebuilt) !== original) return this.skipCompaction("content_mismatch");
        const state = encodeStateAsUpdate(rebuilt);
        if (state.byteLength >= encodeStateAsUpdate(source).byteLength) return this.skipCompaction("no_reduction");
        return {
          state,
          vector: encodeStateVector(rebuilt),
          stateHash: currentStateHash(rebuilt),
        };
      } finally {
        rebuilt.destroy();
      }
    } catch (error) {
      this.skipCompaction("error", error);
      return null;
    }
  }

  /** Rebuilds the room's document from its own canonical projection. */
  private rebuild(source: Y.Doc, isWorkspace: boolean): Y.Doc {
    if (isWorkspace) return rebuildWorkspaceDocument(projectWorkspace(source));
    // v1 rooms hold exactly the `prompt` fragment, and the materialized prompt
    // Go stores (and publishes) IS that fragment's projection, so the same
    // seeding boundary reconstructs it.
    return seedYDocFromPrompt(projectPrompt(source));
  }

  /** Counts a compaction that was refused, and keeps the committed binary. */
  private skipCompaction(reason: string, error?: unknown): null {
    metrics.incCounter("authoring_coedit_compaction_total", { outcome: "skipped" });
    log("warn", "coedit compaction skipped", {
      event: "compaction",
      outcome: "skipped",
      reason,
      stage: "load",
      ...(error === undefined ? {} : { error: (error as Error).message }),
    });
    return null;
  }

  /**
   * Everything one store needs, encoded once.
   *
   * Separated from the store call so a size refusal is reported with the same
   * failure frame as a Go refusal: the browser has no other way to learn that
   * its content was never durable.
   */
  private projectStore(documentName: string, document: Y.Doc): CoeditStorePayload {
    const state = encodeStateAsUpdate(document);
    assertStateWithinLimit(state);
    const isWorkspace = parseAnyDocumentName(documentName)?.fieldSet === FIELD_SET_WORKSPACE;
    const promptJson = isWorkspace ? null : projectPromptJson(document);
    const workspaceJson = isWorkspace ? projectWorkspaceJson(document) : null;
    return {
      state,
      vector: encodeStateVector(document),
      stateHash: currentStateHash(document),
      prompt: promptJson === null ? null : (JSON.parse(promptJson) as unknown),
      workspace: workspaceJson === null ? null : (JSON.parse(workspaceJson) as unknown),
    };
  }

  /**
   * Tells the room about a refusal the service raised before calling Go.
   *
   * Only a CodecError can reach here, and only a size refusal is actionable:
   * the content is real, but it cannot be persisted as one document, so the
   * author is offered the export instead of a retry that cannot succeed.
   */
  private reportRefusal(documentName: string, error: unknown): void {
    if (!(error instanceof CodecError)) return;
    this.broadcastFailure(documentName, {
      retryable: false,
      reason: error.reason,
      requiresResync: false,
    });
    metrics.incCounter("authoring_coedit_store_total", { outcome: "oversized" });
  }

  /** The private failure frame the editor maps onto a visible, actionable state. */
  private broadcastFailure(
    documentName: string,
    failure: { retryable: boolean; reason: string | null; requiresResync: boolean },
  ): void {
    this.broadcaster?.(
      documentName,
      JSON.stringify({
        type: "coedit.save_failed",
        documentName,
        retryable: failure.retryable,
        reason: failure.reason,
        requiresResync: failure.requiresResync,
      }),
    );
  }

  private observeDuration(ms: number): void {
    metrics.incCounter("authoring_coedit_store_duration_seconds", {
      le: bucketFor(ms),
    });
  }

  /** Clears the in-memory commit record for a closed room. */
  forget(documentName: string): void {
    this.commits.delete(documentName);
    this.preloaded.delete(documentName);
    for (const key of this.inflight.keys()) {
      if (key === documentName || key.endsWith(`:${documentName}`)) this.inflight.delete(key);
    }
  }
}

const DURATION_BUCKETS_MS = [50, 100, 250, 500, 1000, 2000, 5000, 10000];

function loadMetadata(result: Awaited<ReturnType<GoAuthoringClient["load"]>>): CoeditLoadMetadata {
  return {
    documentName: result.documentName,
    lifecycleState: result.lifecycleState,
    closedReason: result.closedReason,
    ...(result.freezeOperationId === undefined ? {} : { freezeOperationId: result.freezeOperationId }),
    ...(result.freezeExpiresAt === undefined ? {} : { freezeExpiresAt: result.freezeExpiresAt }),
    ...optionalDurabilityFields(result),
  };
}

function bucketFor(ms: number): string {
  for (const bucket of DURATION_BUCKETS_MS) {
    if (ms <= bucket) return String(bucket);
  }
  return "+Inf";
}
