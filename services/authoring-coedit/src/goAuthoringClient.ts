import { SERVICE_SIGNATURE_HEADER, SERVICE_TIMESTAMP_HEADER, signServiceRequest } from "./authToken.js";
import { metrics } from "./telemetry.js";
import type { CoeditDecimalString } from "../../../src/features/exam-authoring/realtime/coedit/protocol.js";

/**
 * Bounded, authenticated calls to the private Go endpoints.
 *
 * Every call is signed with AUTHORING_COEDIT_SERVICE_SECRET and carries a
 * request timeout. There are no automatic retries: the Hocuspocus store hook
 * is the retry mechanism, and a retry inside this client would multiply the
 * store attempts a single edit can produce.
 */
export const GO_PATHS = {
  load: "/internal/authoring-coedit/load",
  initialize: "/internal/authoring-coedit/initialize",
  store: "/internal/authoring-coedit/store",
  finalStore: "/internal/authoring-coedit/final-store",
  rebase: "/internal/authoring-coedit/rebase",
} as const;

export interface GoSeed {
  prompt: unknown;
  questionRevision: number;
  seedRevision: number;
}

export interface GoLoadResult {
  documentName: string;
  lifecycleState: string;
  ydocState: string | null;
  stateVector: string | null;
  stateHash: string;
  materializedRevision: number;
  questionRevision: number;
  schemaVersion: number;
  fieldSet: string;
  closedReason: string | null;
  seed: GoSeed | null;
  /** Additive lifecycle metadata; omitted by pre-epoch Go deployments. */
  freezeOperationId?: string;
  freezeExpiresAt?: number;
  stateEpoch?: CoeditDecimalString;
  commitSequence?: CoeditDecimalString;
  workspaceRevision?: number;
}

export interface GoStoreResult {
  documentName: string;
  stateHash: string;
  questionRevision: number;
  materializedRevision: number;
  committed: boolean;
  duplicate: boolean;
  freezeOperationId?: string;
  freezeExpiresAt?: number;
  stateEpoch?: CoeditDecimalString;
  commitSequence?: CoeditDecimalString;
  workspaceRevision?: number;
}

export class GoRequestError extends Error {
  readonly status: number;
  readonly reason: string | null;
  readonly retryable: boolean;
  constructor(status: number, reason: string | null, message: string, retryable: boolean) {
    super(message);
    this.name = "GoRequestError";
    this.status = status;
    this.reason = reason;
    this.retryable = retryable;
  }
}

export interface GoAuthoringClientOptions {
  baseUrl: string;
  serviceSecret: string;
  timeoutMs?: number;
  now?: () => number;
  fetchImpl?: typeof fetch;
}

const DEFAULT_TIMEOUT_MS = 10_000;

export class GoAuthoringClient {
  private readonly options: GoAuthoringClientOptions;

  constructor(options: GoAuthoringClientOptions) {
    this.options = options;
  }

  load(documentName: string): Promise<GoLoadResult> {
    return this.request<GoLoadResult>("POST", GO_PATHS.load, { documentName }, "load");
  }

  initialize(body: {
    documentName: string;
    ydocState: string;
    stateVector: string;
    stateHash: string;
    prompt: unknown;
    workspace?: unknown;
    actorId: string;
  }): Promise<GoStoreResult> {
    return this.request<GoStoreResult>("POST", GO_PATHS.initialize, body, "initialize");
  }

  store(body: {
    documentName: string;
    previousStateHash: string;
    stateHash: string;
    ydocState: string;
    stateVector: string;
    prompt: unknown;
    workspace?: unknown;
    actorId: string;
    freezeOperationId?: string;
  }): Promise<GoStoreResult> {
    return this.request<GoStoreResult>("POST", GO_PATHS.store, body, "store");
  }

  finalStore(body: {
    documentName: string;
    previousStateHash: string;
    stateHash: string;
    ydocState: string;
    stateVector: string;
    prompt: unknown;
    workspace?: unknown;
    actorId: string;
    freezeOperationId: string;
  }): Promise<GoStoreResult> {
    return this.request<GoStoreResult>("POST", GO_PATHS.finalStore, body, "final-store");
  }

  rebase(body: {
    documentName: string;
    expectedStateHash: string;
    expectedStateEpoch: CoeditDecimalString;
    stateHash: string;
    ydocState: string;
    stateVector: string;
  }): Promise<GoStoreResult> {
    return this.request<GoStoreResult>("POST", GO_PATHS.rebase, body, "rebase");
  }

  private async request<T>(
    method: string,
    path: string,
    body: unknown,
    stage: "load" | "initialize" | "store" | "final-store" | "rebase",
  ): Promise<T> {
    const payload = JSON.stringify(body ?? {});
    const nowSeconds = Math.floor((this.options.now?.() ?? Date.now()) / 1000);
    const { timestamp, signature } = signServiceRequest(
      this.options.serviceSecret,
      method,
      path,
      payload,
      nowSeconds,
    );
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    const fetchImpl = this.options.fetchImpl ?? fetch;
    try {
      const response = await fetchImpl(`${this.options.baseUrl}${path}`, {
        method,
        headers: {
          "content-type": "application/json",
          [SERVICE_TIMESTAMP_HEADER]: timestamp,
          [SERVICE_SIGNATURE_HEADER]: signature,
        },
        body: payload,
        signal: controller.signal,
      });
      if (!response.ok) {
        const reason = await readCoeditReason(response);
        // A lifecycle fence, stale epoch, or closed document is a CLIENT
        // outcome: retrying it verbatim would just repeat the refusal. In
        // particular, a 5xx carrying a durable lifecycle reason must not be
        // mistaken for a transient network failure.
        const retryable = response.status >= 500;
        const lifecycleRefusal = reason !== null && NON_RETRYABLE_REASONS.has(reason);
        metrics.incCounter("authoring_coedit_store_total", {
          outcome: retryable ? "unavailable" : "rejected",
        });
        throw new GoRequestError(
          response.status,
          reason,
          `Go ${stage} endpoint returned ${response.status}.`,
          retryable && !lifecycleRefusal,
        );
      }
      return (await response.json()) as T;
    } catch (error) {
      if (error instanceof GoRequestError) throw error;
      metrics.incCounter("authoring_coedit_store_total", { outcome: "unavailable" });
      throw new GoRequestError(0, null, `Go ${stage} endpoint is unreachable.`, true);
    } finally {
      clearTimeout(timeout);
    }
  }
}

const NON_RETRYABLE_REASONS: ReadonlySet<string> = new Set([
  "coedit_document_closed",
  "coedit_document_frozen",
  "coedit_epoch_mismatch",
  "coedit_final_store_required",
  "coedit_freeze_conflict",
  "coedit_previous_hash_mismatch",
  "coedit_revision_conflict",
  "coedit_seed_conflict",
  "coedit_stale_cache",
]);

async function readCoeditReason(response: Response): Promise<string | null> {
  try {
    const parsed = (await response.json()) as { error?: { details?: { coeditReason?: unknown } } };
    const reason = parsed?.error?.details?.coeditReason;
    return typeof reason === "string" ? reason : null;
  } catch {
    return null;
  }
}
