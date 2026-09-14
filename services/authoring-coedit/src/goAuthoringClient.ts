import { SERVICE_SIGNATURE_HEADER, SERVICE_TIMESTAMP_HEADER, signServiceRequest } from "./authToken.js";
import { metrics } from "./telemetry.js";

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
}

export interface GoStoreResult {
  documentName: string;
  stateHash: string;
  questionRevision: number;
  materializedRevision: number;
  committed: boolean;
  duplicate: boolean;
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
  }): Promise<GoStoreResult> {
    return this.request<GoStoreResult>("POST", GO_PATHS.store, body, "store");
  }

  private async request<T>(
    method: string,
    path: string,
    body: unknown,
    stage: "load" | "initialize" | "store",
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
        // A closed/frozen/fenced document is a CLIENT outcome: retrying it
        // verbatim would just repeat the refusal.
        const retryable = response.status >= 500;
        metrics.incCounter("authoring_coedit_store_total", {
          outcome: retryable ? "unavailable" : "rejected",
        });
        throw new GoRequestError(
          response.status,
          reason,
          `Go ${stage} endpoint returned ${response.status}.`,
          retryable,
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

async function readCoeditReason(response: Response): Promise<string | null> {
  try {
    const parsed = (await response.json()) as { error?: { details?: { coeditReason?: unknown } } };
    const reason = parsed?.error?.details?.coeditReason;
    return typeof reason === "string" ? reason : null;
  } catch {
    return null;
  }
}
