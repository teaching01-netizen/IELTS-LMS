import { emitStudentObservabilityMetric } from "../../../../utils/studentObservability";

/**
 * Burst-plan asset host set (Track A A3).
 *
 * HAR enumeration during the 2026-11-04 burst audit observed a single
 * first-party host serving the College Board testing embed
 * (`https://www.desmos.com/testing/collegeboard/*` documents + bundles).
 * Additional hosts (fonts/CDN) MUST NOT be appended without a measured HAR
 * from a real Math open — unmeasured origins are not preconnected.
 */
export const DESMOS_ASSET_HOSTS = ["https://www.desmos.com"] as const;

function ensureLink(
  documentRef: Document,
  host: string,
  rel: "preconnect" | "dns-prefetch",
): void {
  const head = documentRef.head;
  if (!head) return;
  const existing = head.querySelector<HTMLLinkElement>(
    `link[rel="${rel}"][href="${host}"]`,
  );
  if (existing) return;
  const link = documentRef.createElement("link");
  link.rel = rel;
  link.href = host;
  if (rel === "preconnect") link.crossOrigin = "anonymous";
  link.dataset["satDesmosPreconnect"] = "true";
  head.append(link);
}

/**
 * Idempotent per-host warm-up: one `preconnect` + one `dns-prefetch` per
 * asset host. Safe to call on every Math open; extra calls are no-ops.
 * Emits a single timing beacon per document so the Math-window board can
 * correlate preconnect presence with ready_ms.
 */
export function ensureDesmosPreconnect(
  documentRef: Document = document,
  hosts: readonly string[] = DESMOS_ASSET_HOSTS,
): void {
  const head = documentRef.head;
  if (!head) return;
  const startedAt = typeof performance !== "undefined" ? performance.now() : 0;
  for (const host of hosts) {
    ensureLink(documentRef, host, "preconnect");
    ensureLink(documentRef, host, "dns-prefetch");
  }
  emitStudentObservabilityMetric("sat_desmos_preconnect", {
    hostCount: hosts.length,
    durationMs: typeof performance !== "undefined" ? Math.round(performance.now() - startedAt) : 0,
    saveData:
      typeof navigator !== "undefined" &&
      (navigator as Navigator & { connection?: { saveData?: boolean } }).connection
        ?.saveData === true,
  });
}
