import { withStudentObservabilityDimensions } from "./studentObservability";

type DiagnosticEvent =
  | "mounted"
  | "interrupted"
  | "pagehide"
  | "unmounted"
  | "explicit_exit"
  | "route_error"
  | "render_error"
  | "unhandled_error"
  | "access_rejected"
  | "resume_result";
export interface SatDiagnostic {
  eventId: string;
  event: DiagnosticEvent;
  occurredAt: string;
  version: string;
  pageId: string;
  reason?: string;
  navigationType?: string;
  statusCode?: number;
  pendingMutationCount?: number;
}
type Transport = (
  scheduleId: string,
  attemptId: string,
  payload: SatDiagnostic
) => Promise<unknown>;
type Fields = Pick<SatDiagnostic, "reason" | "statusCode" | "pendingMutationCount">;
interface Queued {
  scheduleId: string;
  attemptId: string;
  payload: SatDiagnostic;
}
const QUEUE_KEY = "sat-diagnostics:v1";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MARKER_KEY = "sat-diagnostic-sitting:v1";
const EVENTS = new Set([
  "mounted",
  "interrupted",
  "pagehide",
  "unmounted",
  "explicit_exit",
  "route_error",
  "render_error",
  "unhandled_error",
  "access_rejected",
  "resume_result",
]);
const REASONS = new Set([
  "unknown",
  "chunk",
  "route",
  "render",
  "network",
  "server_error",
  "resumed",
  "terminal",
  "expired",
  "revoked",
  "ownership",
  "unauthenticated",
  "no-attempt",
  "transient-error",
  "explicit",
  "EXAM_ACCESS_EXPIRED",
  "EXAM_ACCESS_REVOKED",
  "SESSION_ALREADY_ACTIVE",
  "LEASE_FENCED",
  "ACTIVE_SESSION_SUPERSEDED",
  "UNAUTHORIZED",
]);
let memoryQueue: Queued[] = [];
interface DiagnosticOwner {
  scheduleId: string;
  attemptId: string;
  pageId: string;
  remaining: number;
  flush: () => void;
}
let current: DiagnosticOwner | null = null;
let recent: { owner: DiagnosticOwner; until: number } | null = null;

function safeFields(fields: Fields): Fields {
  return {
    ...(fields.reason ? { reason: REASONS.has(fields.reason) ? fields.reason : "unknown" } : {}),
    ...(Number.isInteger(fields.statusCode) &&
    fields.statusCode! >= 100 &&
    fields.statusCode! <= 599
      ? { statusCode: fields.statusCode }
      : {}),
    ...(Number.isInteger(fields.pendingMutationCount) &&
    fields.pendingMutationCount! >= 0 &&
    fields.pendingMutationCount! <= 1_000_000
      ? { pendingMutationCount: fields.pendingMutationCount }
      : {}),
  };
}
function queue(): Queued[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(QUEUE_KEY) ?? "[]");
    if (Array.isArray(raw))
      memoryQueue = raw
        .flatMap((item: Queued) => {
          const p = item?.payload;
          if (
            typeof item?.scheduleId !== "string" ||
            typeof item?.attemptId !== "string" ||
            !p ||
            typeof p.eventId !== "string" ||
            !UUID.test(p.eventId) ||
            typeof p.pageId !== "string" ||
            !UUID.test(p.pageId) ||
            !EVENTS.has(p.event) ||
            typeof p.version !== "string" ||
            !/^[\w.-]{1,128}$/.test(p.version) ||
            !Number.isFinite(Date.parse(p.occurredAt)) ||
            Date.now() - Date.parse(p.occurredAt) > 86_400_000 ||
            Date.parse(p.occurredAt) > Date.now() + 300_000
          )
            return [];
          // Reconstruct the allowlist even for storage edited by extensions/old clients.
          return [
            {
              scheduleId: item.scheduleId,
              attemptId: item.attemptId,
              payload: {
                eventId: p.eventId,
                event: p.event,
                pageId: p.pageId,
                version: p.version,
                occurredAt: p.occurredAt,
                ...safeFields(p),
                ...(p.navigationType &&
                ["navigate", "reload", "back_forward", "prerender", "unknown"].includes(
                  p.navigationType
                )
                  ? { navigationType: p.navigationType }
                  : {}),
              },
            },
          ];
        })
        .slice(-40);
  } catch {
    /* Storage denial must not affect the exam. */
  }
  return memoryQueue.filter(
    (item) => Date.now() - Date.parse(item.payload.occurredAt) <= 86_400_000
  );
}
function saveQueue(items: Queued[]): void {
  memoryQueue = items.slice(-40);
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(memoryQueue));
  } catch {
    /* Memory-only fallback. */
  }
}
export function queueSatResumeDiagnostic(
  scheduleId: string,
  attemptId: string,
  reason: string
): void {
  try {
    saveQueue([
      ...queue(),
      {
        scheduleId,
        attemptId,
        payload: {
          eventId: crypto.randomUUID(),
          pageId: crypto.randomUUID(),
          event: "resume_result",
          occurredAt: new Date().toISOString(),
          version:
            String(withStudentObservabilityDimensions()["version"])
              .replace(/[^\w.-]/g, "_")
              .slice(0, 128) || "unknown",
          ...safeFields({ reason }),
        },
      },
    ]);
  } catch {
    /* Retained only until this attempt has authorized delivery again. */
  }
}
export function recordSatDiagnostic(event: DiagnosticEvent, fields: Fields = {}): void {
  const owner =
    current ??
    ((event === "route_error" || event === "render_error") && recent && Date.now() < recent.until
      ? recent.owner
      : null);
  if (!owner) return;
  try {
    if (event === "explicit_exit") {
      try {
        sessionStorage.removeItem(MARKER_KEY);
      } catch {
        /* Best effort. */
      }
    }
    if (owner.remaining-- <= 0) return;
    const payload: SatDiagnostic = {
      eventId: crypto.randomUUID(),
      event,
      occurredAt: new Date().toISOString(),
      version:
        String(withStudentObservabilityDimensions()["version"])
          .replace(/[^\w.-]/g, "_")
          .slice(0, 128) || "unknown",
      pageId: owner.pageId,
      ...safeFields(fields),
    };
    if (event === "mounted" || event === "interrupted") {
      const navigation = performance.getEntriesByType?.("navigation")[0] as
        PerformanceNavigationTiming | undefined;
      payload.navigationType =
        navigation && ["navigate", "reload", "back_forward", "prerender"].includes(navigation.type)
          ? navigation.type
          : "unknown";
    }
    saveQueue([...queue(), { scheduleId: owner.scheduleId, attemptId: owner.attemptId, payload }]);
    owner.flush();
  } catch {
    /* Reporting must never interrupt exam delivery. */
  }
}

export function startSatDiagnostics(context: {
  scheduleId: string;
  attemptId: string;
  send: Transport;
}): () => void {
  let running = false;
  let failures = 0;
  const flush = () => {
    if (running || failures >= 3) return;
    running = true;
    void (async () => {
      try {
        // offcut: bounded incident metadata only; this is not an answer outbox
        for (let count = 0; count < 40; count++) {
          const next = queue().find(
            (item) => item.scheduleId === context.scheduleId && item.attemptId === context.attemptId
          );
          if (!next) break;
          await context.send(context.scheduleId, context.attemptId, next.payload);
          saveQueue(queue().filter((item) => item.payload.eventId !== next.payload.eventId));
        }
      } catch {
        failures++;
      } finally {
        running = false;
      }
    })();
  };
  const owner = { ...context, pageId: crypto.randomUUID(), remaining: 40, flush };
  current = owner;
  try {
    const previous = JSON.parse(sessionStorage.getItem(MARKER_KEY) ?? "null");
    if (
      previous?.scheduleId === context.scheduleId &&
      previous?.attemptId === context.attemptId &&
      previous?.active &&
      Date.now() - previous.updatedAt < 86_400_000
    ) {
      recordSatDiagnostic("interrupted", { reason: "unknown" });
    }
    sessionStorage.setItem(
      MARKER_KEY,
      JSON.stringify({
        scheduleId: context.scheduleId,
        attemptId: context.attemptId,
        pageId: owner.pageId,
        active: true,
        updatedAt: Date.now(),
      })
    );
  } catch {
    /* Diagnostics cannot require browser storage. */
  }
  const onError = () => recordSatDiagnostic("unhandled_error", { reason: "unknown" });
  const onPageHide = () => recordSatDiagnostic("pagehide");
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onError);
  window.addEventListener("pagehide", onPageHide);
  window.addEventListener("online", flush);
  recordSatDiagnostic("mounted");
  return () => {
    if (current === owner) {
      recordSatDiagnostic("unmounted");
      recent = { owner, until: Date.now() + 5_000 };
      try {
        const marker = JSON.parse(sessionStorage.getItem(MARKER_KEY) ?? "null");
        if (marker?.pageId === owner.pageId) sessionStorage.removeItem(MARKER_KEY);
      } catch {
        /* Best effort. */
      }
    }
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onError);
    window.removeEventListener("pagehide", onPageHide);
    window.removeEventListener("online", flush);
    if (current === owner) current = null;
  };
}
