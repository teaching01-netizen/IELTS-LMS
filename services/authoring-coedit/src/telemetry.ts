/**
 * Content-free metrics and allow-listed structured logs.
 *
 * Rules, stated because they are easy to violate by accident:
 *
 *   - Label values come only from the closed vocabularies below. Anything
 *     outside them normalizes to `other`, so a caller passing an id cannot open
 *     a cardinality hole.
 *   - User, organization, exam, draft, question, document, revision, state
 *     hash, and question content NEVER become metric labels or log fields.
 *   - Tokens and service signatures are redacted at ingress: they never reach a
 *     log line, even in a debug path.
 */

export type CounterLabels = Record<string, string>;

const ALLOWED_LABELS = new Set([
  "outcome",
  "reason",
  "le",
  "stage",
  "mode",
]);

const ALLOWED_LOG_FIELDS = new Set([
  "level",
  "msg",
  "event",
  "outcome",
  "reason",
  "stage",
  "mode",
  "count",
  "durationMs",
  "port",
  "environment",
  "error",
  "attempt",
]);

const NORMALIZED_LABEL_VALUES: Record<string, readonly string[]> = {
  outcome: [
    "accepted",
    "rejected",
    "conflict",
    // A proposal that already produced durable content: the retry of a seed is
    // recognized as the same seed rather than as a second author.
    "duplicate",
    "closed",
    "frozen",
    "unavailable",
    "oversized",
    "expired",
    "lost",
    "error",
    "skipped",
    "other",
  ],
  reason: [
    "question_deleted",
    "draft_replaced",
    "exam_published",
    "workbook_replaced",
    "feature_disabled",
    "lease_expired",
    "client",
    "shutdown",
    "other",
  ],
  stage: ["load", "initialize", "store", "freeze", "unfreeze", "flush", "close", "other"],
  mode: ["write", "read", "other"],
};

function normalizeLabel(key: string, value: string): string {
  const vocabulary = NORMALIZED_LABEL_VALUES[key];
  if (!vocabulary) return value;
  return vocabulary.includes(value) ? value : "other";
}

function sanitizeLabels(labels: CounterLabels): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(labels)) {
    if (!ALLOWED_LABELS.has(key)) continue;
    const safeKey = key.replace(/[^a-zA-Z0-9_]/g, "_");
    const safeValue = normalizeLabel(key, String(value)).replace(/["\\\n]/g, "_");
    parts.push(`${safeKey}="${safeValue}"`);
  }
  parts.sort();
  return parts.length ? `{${parts.join(",")}}` : "";
}

interface Series {
  kind: "counter" | "gauge";
  help: string;
  labels?: CounterLabels;
  value: number;
}

const METRIC_HELP: Record<string, string> = {
  authoring_coedit_singleton_lock: "1 when this process holds the environment singleton lock.",
  authoring_coedit_connections_current: "Open co-edit WebSocket connections.",
  authoring_coedit_documents_current: "Active in-memory collaborative documents.",
  authoring_coedit_auth_total: "Co-edit authentication attempts by outcome.",
  authoring_coedit_store_total: "Co-edit store attempts by outcome.",
  authoring_coedit_store_duration_seconds: "Co-edit store duration histogram bucket.",
  authoring_coedit_state_bytes: "Collaborative document state size histogram bucket.",
  authoring_coedit_reconnect_total: "Client reconnects by outcome.",
  authoring_coedit_freeze_total: "Freeze lifecycle operations by outcome.",
  authoring_coedit_compaction_total:
    "Idle-load document compactions by outcome (a skipped compaction keeps the committed binary).",
  authoring_coedit_seed_total: "Authenticated workspace seed proposals by outcome.",
  authoring_coedit_shutdown_flush_total: "Shutdown flush outcomes.",
  authoring_coedit_lifecycle_close_total: "Room closes by reason.",
};

function metricKey(name: string, labels: CounterLabels): string {
  return `${name}${sanitizeLabels(labels)}`;
}

export class Metrics {
  private readonly series = new Map<string, Series>();

  incCounter(name: string, labels: CounterLabels = {}, delta = 1): void {
    const key = metricKey(name, labels);
    const existing = this.series.get(key);
    if (existing) {
      existing.value += delta;
      return;
    }
    this.series.set(key, {
      kind: "counter",
      help: METRIC_HELP[name] ?? name,
      labels,
      value: delta,
    });
  }

  setGauge(name: string, value: number, labels: CounterLabels = {}): void {
    const key = metricKey(name, labels);
    this.series.set(key, {
      kind: "gauge",
      help: METRIC_HELP[name] ?? name,
      labels,
      value,
    });
  }

  /** Prometheus text exposition. Only closed-vocabulary labels are rendered. */
  render(): string {
    const families = new Map<string, { kind: string; help: string; lines: string[] }>();
    for (const [key, series] of this.series) {
      const name = key.split("{")[0] ?? key;
      let family = families.get(name);
      if (!family) {
        family = { kind: series.kind, help: series.help, lines: [] };
        families.set(name, family);
      }
      family.lines.push(`${key} ${formatValue(series.value)}`);
    }
    const out: string[] = [];
    for (const [name, family] of [...families].sort(([a], [b]) => a.localeCompare(b))) {
      out.push(`# HELP ${name} ${family.help}`);
      out.push(`# TYPE ${name} ${family.kind}`);
      out.push(...family.lines.sort());
    }
    return out.join("\n") + "\n";
  }
}

function formatValue(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(6);
}

export const metrics = new Metrics();

/**
 * Allow-listed structured log line.
 *
 * Every field outside the allow-list is dropped rather than stringified, so a
 * caller cannot leak a token or question content by adding a property.
 */
export function log(
  level: "info" | "warn" | "error",
  msg: string,
  fields: Record<string, unknown> = {},
): void {
  const line: Record<string, unknown> = { level, msg };
  for (const [key, value] of Object.entries(fields)) {
    if (!ALLOWED_LOG_FIELDS.has(key)) continue;
    if (value === undefined) continue;
    line[key] =
      typeof value === "string" || typeof value === "number" || typeof value === "boolean"
        ? value
        : String(value);
  }
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(line));
}
