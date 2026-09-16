import { parseAnyDocumentName } from "./documentIdentity";

/** A seed writes one scalar map entry or one rich XML root. */
export type WorkspaceSeedRoot = "scalar" | "rich";

export interface WorkspaceSeedInput {
  documentName: string;
  root: WorkspaceSeedRoot;
  path: string;
  value: unknown;
  sourceQuestionRevision?: number;
}

export interface WorkspaceSeedFrame extends WorkspaceSeedInput {
  type: "coedit.seed";
  seedId: string;
}

export interface ParseWorkspaceSeedOptions {
  /** Bind a parsed frame to the room currently handled by the connection. */
  documentName?: string;
}

/** A seed is smaller than a WebSocket frame and a single projected value is capped at 1 MiB. */
export const MAX_WORKSPACE_SEED_FRAME_BYTES = 2 << 20;
export const MAX_WORKSPACE_SEED_VALUE_BYTES = 1 << 20;
export const MAX_WORKSPACE_SEED_PATH_LENGTH = 256;
export const MAX_WORKSPACE_SEED_ID_LENGTH = 128;

const SAFE_ID = "[A-Za-z0-9_-]{1,128}";
const SCALAR_PATH = new RegExp(`^(?:question/${SAFE_ID}/scalar|delivery/${SAFE_ID}|access/${SAFE_ID})$`);
const RICH_PATH = new RegExp(
  `^question/${SAFE_ID}/(?:prompt|stimulus|rationale|choice/${SAFE_ID})$`,
);
const SEED_ID = /^seed-[0-9a-f]{32}$/;
const MAX_JSON_DEPTH = 64;

const FNV_OFFSET = 14_695_981_039_346_656_037n;
const FNV_PRIME = 1_099_511_628_211n;
const FNV_MASK = (1n << 64n) - 1n;
const SECOND_HASH_OFFSET = FNV_OFFSET ^ 11_400_714_819_323_198_485n;

export class WorkspaceSeedValidationError extends Error {
  readonly reason = "invalid_workspace_seed";

  constructor(message: string) {
    super(message);
    this.name = "WorkspaceSeedValidationError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  try {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}

function isJsonValue(value: unknown, depth = 0): boolean {
  if (depth > MAX_JSON_DEPTH) return false;
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every((entry) => isJsonValue(entry, depth + 1));
  if (!isRecord(value)) return false;
  return Object.entries(value).every(
    ([key, entry]) => key.length > 0 && isJsonValue(entry, depth + 1),
  );
}

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function jsonBytes(value: unknown): number | null {
  try {
    const encoded = JSON.stringify(value);
    return encoded === undefined ? null : utf8Bytes(encoded);
  } catch {
    return null;
  }
}

/** Canonical JSON makes object-key order irrelevant to seed idempotency. */
function canonicalJson(value: unknown, depth = 0): string | undefined {
  if (depth > MAX_JSON_DEPTH) return undefined;
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") return Number.isFinite(value) ? JSON.stringify(value) : undefined;
  if (Array.isArray(value)) {
    const entries = value.map((entry) => canonicalJson(entry, depth + 1));
    return entries.every((entry): entry is string => entry !== undefined)
      ? `[${entries.join(",")}]`
      : undefined;
  }
  if (!isRecord(value)) return undefined;
  const entries: string[] = [];
  for (const key of Object.keys(value).sort()) {
    const entry = canonicalJson(value[key], depth + 1);
    if (entry === undefined) return undefined;
    entries.push(`${JSON.stringify(key)}:${entry}`);
  }
  return `{${entries.join(",")}}`;
}

function seedMaterial(input: WorkspaceSeedInput): string {
  const value = canonicalJson(input.value);
  if (value === undefined) throw new WorkspaceSeedValidationError("Seed value is not JSON-safe.");
  return [
    JSON.stringify(input.documentName),
    JSON.stringify(input.root),
    JSON.stringify(input.path),
    JSON.stringify(input.sourceQuestionRevision ?? null),
    value,
  ].join("|");
}

function fnv1a64(value: string, offset: bigint): string {
  let hash = offset;
  for (const byte of new TextEncoder().encode(value)) {
    hash = ((hash ^ BigInt(byte)) * FNV_PRIME) & FNV_MASK;
  }
  return hash.toString(16).padStart(16, "0");
}

/**
 * Returns a deterministic idempotency fingerprint. This is not an
 * authorization primitive; the server still authenticates the actor and
 * validates the frame before applying it.
 */
export function workspaceSeedId(input: WorkspaceSeedInput): string {
  const material = seedMaterial(input);
  return `seed-${fnv1a64(material, FNV_OFFSET)}${fnv1a64(material, SECOND_HASH_OFFSET)}`;
}

export function workspaceSeedPathRoot(path: string): WorkspaceSeedRoot | null {
  if (SCALAR_PATH.test(path)) return "scalar";
  if (RICH_PATH.test(path)) return "rich";
  return null;
}

function sourceRevisionIsValid(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function hasOnlySeedKeys(value: Record<string, unknown>): boolean {
  return Object.keys(value).every((key) =>
    ["type", "documentName", "seedId", "root", "path", "value", "sourceQuestionRevision"].includes(key),
  );
}

/** Returns true only for a complete, room-safe, idempotent seed frame. */
export function isWorkspaceSeedFrame(
  value: unknown,
  options: ParseWorkspaceSeedOptions = {},
): value is WorkspaceSeedFrame {
  if (!isRecord(value) || !hasOnlySeedKeys(value)) return false;
  if (value["type"] !== "coedit.seed") return false;
  if (
    typeof value["documentName"] !== "string" ||
    value["documentName"] !== value["documentName"].trim() ||
    parseAnyDocumentName(value["documentName"])?.fieldSet !== "workspace"
  ) return false;
  if (options.documentName !== undefined && value["documentName"] !== options.documentName) return false;
  if (typeof value["seedId"] !== "string" || value["seedId"].length > MAX_WORKSPACE_SEED_ID_LENGTH || !SEED_ID.test(value["seedId"])) return false;
  if (value["root"] !== "scalar" && value["root"] !== "rich") return false;
  if (
    typeof value["path"] !== "string" ||
    value["path"] !== value["path"].trim() ||
    value["path"].length === 0 ||
    value["path"].length > MAX_WORKSPACE_SEED_PATH_LENGTH ||
    workspaceSeedPathRoot(value["path"]) !== value["root"]
  ) return false;
  if (!isJsonValue(value["value"]) || (value["root"] === "rich" && !isRecord(value["value"]))) return false;
  const valueSize = jsonBytes(value["value"]);
  if (valueSize === null || valueSize > MAX_WORKSPACE_SEED_VALUE_BYTES) return false;
  if ("sourceQuestionRevision" in value && !sourceRevisionIsValid(value["sourceQuestionRevision"])) return false;
  const serialized = jsonBytes(value);
  if (serialized === null || serialized > MAX_WORKSPACE_SEED_FRAME_BYTES) return false;
  try {
    return value["seedId"] === workspaceSeedId(value as unknown as WorkspaceSeedInput);
  } catch {
    return false;
  }
}

/** Builds a validated seed proposal for a single workspace root. */
export function createWorkspaceSeedFrame(input: WorkspaceSeedInput): WorkspaceSeedFrame {
  const frame: WorkspaceSeedFrame = {
    type: "coedit.seed",
    documentName: input.documentName,
    seedId: workspaceSeedId(input),
    root: input.root,
    path: input.path,
    value: input.value,
    ...(input.sourceQuestionRevision === undefined
      ? {}
      : { sourceQuestionRevision: input.sourceQuestionRevision }),
  };
  if (!isWorkspaceSeedFrame(frame)) {
    throw new WorkspaceSeedValidationError("Workspace seed frame is invalid or exceeds its limits.");
  }
  return frame;
}

/** Parses either a decoded frame or a wire JSON string. Invalid input is ignored. */
export function parseWorkspaceSeedFrame(
  raw: unknown,
  options: ParseWorkspaceSeedOptions = {},
): WorkspaceSeedFrame | null {
  let value: unknown = raw;
  if (typeof raw === "string") {
    if (utf8Bytes(raw) > MAX_WORKSPACE_SEED_FRAME_BYTES) return null;
    try {
      value = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  return isWorkspaceSeedFrame(value, options) ? value : null;
}
