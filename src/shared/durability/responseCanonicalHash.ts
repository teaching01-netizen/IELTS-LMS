import type { ResponsePayload } from "./types";

export interface FrozenResponseManifestEntry {
  questionId: string;
  writeId: string;
  clientVersion: number;
  contentHash: string;
}

function goJSONString(value: string): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function canonicalJSON(value: unknown, inArray = false): string {
  if (value === null || value === undefined) return inArray ? "null" : "null";
  if (typeof value === "string") return goJSONString(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("A frozen response contains a non-finite number.");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJSON(entry, true)).join(",")}]`;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const fields = Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
      .map((key) => `${goJSONString(key)}:${canonicalJSON(record[key])}`);
    return `{${fields.join(",")}}`;
  }
  throw new Error("A frozen response contains a value that cannot be represented as JSON.");
}

function normalizedSatTextAnnotation(value: unknown): Record<string, unknown> {
  const item = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const rawAnchor = item["anchor"] && typeof item["anchor"] === "object"
    ? (item["anchor"] as Record<string, unknown>)
    : {};
  const anchor: Record<string, unknown> = {
    nodeId: typeof rawAnchor["nodeId"] === "string" ? rawAnchor["nodeId"] : "",
    startOffset: typeof rawAnchor["startOffset"] === "number" ? rawAnchor["startOffset"] : 0,
    endOffset: typeof rawAnchor["endOffset"] === "number" ? rawAnchor["endOffset"] : 0,
    exact: typeof rawAnchor["exact"] === "string" ? rawAnchor["exact"] : "",
  };
  if (typeof rawAnchor["prefix"] === "string" && rawAnchor["prefix"] !== "") anchor["prefix"] = rawAnchor["prefix"];
  if (typeof rawAnchor["suffix"] === "string" && rawAnchor["suffix"] !== "") anchor["suffix"] = rawAnchor["suffix"];
  const result: Record<string, unknown> = {
    id: typeof item["id"] === "string" ? item["id"] : "",
    kind: typeof item["kind"] === "string" ? item["kind"] : "",
    anchor,
    createdAt: typeof item["createdAt"] === "string" ? item["createdAt"] : "",
    updatedAt: typeof item["updatedAt"] === "string" ? item["updatedAt"] : "",
  };
  if (typeof item["color"] === "string" && item["color"] !== "") result["color"] = item["color"];
  if (typeof item["note"] === "string" && item["note"] !== "") result["note"] = item["note"];
  return result;
}

function normalizedResponsePayload(payload: ResponsePayload): Record<string, unknown> {
  const annotations = payload.annotations.map((value) => {
    const kind = typeof value["kind"] === "string" ? value["kind"] : "";
    const result: Record<string, unknown> = {
      id: value["id"],
      kind,
    };
    if (kind === "sat_annotations") {
      const items = Array.isArray(value["annotations"]) ? value["annotations"] : [];
      result["version"] = typeof value["version"] === "number" ? value["version"] : 0;
      result["legacyQuestionNote"] = typeof value["legacyQuestionNote"] === "string"
        ? value["legacyQuestionNote"]
        : "";
      result["annotations"] = items.map(normalizedSatTextAnnotation);
    } else {
      if (typeof value["start"] === "number") result["start"] = value["start"];
      if (typeof value["end"] === "number") result["end"] = value["end"];
      if (typeof value["text"] === "string" && value["text"] !== "") result["text"] = value["text"];
    }
    return result;
  });
  return {
    answer: payload.answer ?? null,
    markedForReview: payload.markedForReview,
    eliminatedOptions: payload.eliminatedOptions ?? [],
    annotations,
  };
}

async function sha256Canonical(value: unknown): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error("Secure response hashing is unavailable on this device.");
  const bytes = new TextEncoder().encode(canonicalJSON(value));
  const digest = await subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Matches attempts.HashResponsePayload in the Go V2 mutation service. */
export function hashResponsePayload(payload: ResponsePayload): Promise<string> {
  return sha256Canonical(normalizedResponsePayload(payload));
}

/** Manifest hashing matches the sorted Go []ModuleCloseAnswer projection. */
export function hashFrozenResponseManifest(
  manifest: readonly FrozenResponseManifestEntry[],
): Promise<string> {
  return sha256Canonical([...manifest].sort((a, b) =>
    a.questionId < b.questionId ? -1 : a.questionId > b.questionId ? 1 : 0,
  ));
}
