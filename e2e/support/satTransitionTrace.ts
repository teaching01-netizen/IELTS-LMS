import type { Page } from "@playwright/test";

/**
 * Records the SAT transition protocol from inside the student page:
 *
 * - every delivery request that participates in a section boundary
 *   (`state`, `bootstrap`, response saves, module start/enter/visible/close,
 *   break start/enter/visible) with its body, status and `Retry-After`;
 * - every `data-sat-break-phase` transition with a timestamp;
 * - `student-observability-metric` events, including the break-end first-read
 *   scheduler metric.
 *
 * The random stub exists because the break-end first read is jittered by
 * `Math.random()`. Pinning it makes the expected delay exact instead of a
 * statistical assertion. It never touches `crypto.randomUUID`, which the
 * controller prefers for close ids.
 */

export interface SatTransitionRequest {
  url: string;
  path: string;
  method: string;
  at: number;
  body: unknown;
  status: number | null;
  retryAfter: string | null;
}

export interface SatTransitionPhase {
  phase: string;
  at: number;
}

export interface SatTransitionTrace {
  requests: SatTransitionRequest[];
  phases: SatTransitionPhase[];
  metrics: Array<Record<string, unknown>>;
  random: number | null;
}

export interface SatTransitionTraceOptions {
  /** Pin `Math.random()` for the whole page; omit to leave it untouched. */
  random?: number;
}

export function installSatTransitionTrace(options: SatTransitionTraceOptions = {}): void {
  // This function is serialized into the page, so every value it uses must be
  // declared inside it. A module-scope regex would be `undefined` in the
  // browser and would throw on the first fetch, breaking the app bootstrap.
  const deliveryPath =
    /\/api\/v1\/assessment-delivery\/schedules\/[^/]+\/(?:state|bootstrap|responses\/[^/]+|modules\/.+|breaks\/.+)$/;
  const win = window as unknown as {
    __satTransitionTrace: SatTransitionTrace;
  };
  const trace: SatTransitionTrace = {
    requests: [],
    phases: [],
    metrics: [],
    random: typeof options.random === "number" ? options.random : null,
  };
  win.__satTransitionTrace = trace;

  if (typeof options.random === "number") {
    const fixed = options.random;
    Math.random = () => fixed;
  }

  const originalFetch = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const rawUrl =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    let path = rawUrl;
    try {
      path = new URL(rawUrl, window.location.origin).pathname;
    } catch {
      // Keep the raw url; the record is still useful for diagnostics.
    }
    const method = (
      init?.method ??
      (typeof input === "object" && input !== null && "method" in input ? input.method : "GET")
    ).toUpperCase();
    let body: unknown = null;
    if (typeof init?.body === "string") {
      try {
        body = JSON.parse(init.body) as unknown;
      } catch {
        body = init.body;
      }
    }
    const relevant = deliveryPath.test(path);
    const record: SatTransitionRequest = {
      url: rawUrl,
      path,
      method,
      at: Date.now(),
      body,
      status: null,
      retryAfter: null,
    };
    if (relevant) trace.requests.push(record);
    return originalFetch(input as RequestInfo, init).then((response) => {
      if (relevant) {
        record.status = response.status;
        record.retryAfter = response.headers.get("retry-after");
      }
      return response;
    });
  };

  window.addEventListener("student-observability-metric", (event) => {
    const detail = (event as CustomEvent).detail as Record<string, unknown> | undefined;
    if (detail && typeof detail["name"] === "string") trace.metrics.push(detail);
  });

  const recordPhase = () => {
    const surface = document.querySelector("[data-sat-break-phase]");
    const phase = surface?.getAttribute("data-sat-break-phase") ?? null;
    if (typeof phase !== "string" || phase.length === 0) return;
    if (trace.phases.at(-1)?.phase === phase) return;
    trace.phases.push({ phase, at: Date.now() });
  };
  // Poll instead of observing every DOM mutation: the exam surface mutates
  // constantly (timer, inputs), and a second full-document observer measurably
  // slows the very handoff this suite times. 100 ms is well inside every
  // budget asserted here.
  recordPhase();
  window.setInterval(recordPhase, 100);
}

export async function readSatTransitionTrace(page: Page): Promise<SatTransitionTrace> {
  return page.evaluate(
    () => (window as unknown as { __satTransitionTrace: SatTransitionTrace }).__satTransitionTrace
  );
}

/** Request records for one endpoint suffix, in arrival order. */
export function requestSuffix(
  trace: SatTransitionTrace,
  suffix: string
): SatTransitionRequest[] {
  return trace.requests.filter((request) => request.path.endsWith(suffix));
}
