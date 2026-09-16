/**
 * The one workspace-command envelope: vocabulary, builder, and validator.
 *
 * Rich and scalar fields travel through the shared Y.Doc. Structural actions
 * still use the existing HTTP mutations because the API owns authorization,
 * revision fencing, and persistence. After one of those mutations succeeds, the
 * authoring room relays this small stateless envelope so every open SAT surface
 * can invalidate its local query view without a refresh.
 *
 * Both halves of that relay validate the message — the browser provider parses
 * what it receives, and the Hocuspocus service parses what it forwards — so the
 * rules live HERE and both sides import them (the service already imports the
 * browser's rich-text schema the same way). Two copies with the same intent and
 * different limits is how a message becomes acceptable at one end and rejected
 * at the other, with the authors' invalidation silently missing at the far end.
 */

export const SAT_WORKSPACE_COMMANDS = [
  "question.created",
  "question.duplicated",
  "question.deleted",
  "question.reordered",
  "question.bulk_changed",
  "workbook.imported",
  "workbook.undone",
  "sample.loaded",
  "delivery.changed",
  "access.created",
  "access.updated",
  "access.lifecycle_changed",
  "access.duplicated",
  "exam.published",
] as const;

export type SatWorkspaceCommandName = (typeof SAT_WORKSPACE_COMMANDS)[number];

export interface SatWorkspaceCommand {
  type: "coedit.command";
  documentName: string;
  actorId: string;
  commandId: string;
  idempotencyKey: string;
  expectedWorkspaceRevision?: string;
  command: SatWorkspaceCommandName;
  payload: Record<string, unknown>;
  createdAt: number;
}

const COMMAND_SET = new Set<string>(SAT_WORKSPACE_COMMANDS);
const MAX_COMMAND_STRING = 256;
const MAX_COMMAND_BYTES = 64 * 1024;

export interface ParseSatWorkspaceCommandOptions {
  /** Only accept this room. Omitted means "any well-formed room name". */
  documentName?: string;
  /**
   * Only accept this actor. The service passes the connection's signed actor
   * id, so a browser cannot relay a notification as somebody else. Omitted (or
   * empty) means "no identity expectation", which is what the browser has.
   */
  actorId?: string;
}

function boundedString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= MAX_COMMAND_STRING;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** UTF-8 byte length. `TextEncoder` is the one encoder both runtimes have. */
function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function withinByteCap(value: unknown): boolean {
  try {
    return utf8Bytes(JSON.stringify(value)) <= MAX_COMMAND_BYTES;
  } catch {
    // Cyclic or otherwise unencodable payloads are not commands.
    return false;
  }
}

/**
 * Parses a command envelope from either half of the room.
 *
 * `raw` is the wire string when the caller has bytes (the service) and an
 * already-parsed value when the transport already decoded it (the browser
 * provider). Invalid, oversized, foreign-room, and wrong-actor messages all
 * yield null: the caller ignores them rather than guessing.
 */
export function parseSatWorkspaceCommand(
  raw: unknown,
  options: ParseSatWorkspaceCommandOptions = {},
): SatWorkspaceCommand | null {
  let value: unknown = raw;
  if (typeof raw === "string") {
    if (utf8Bytes(raw) > MAX_COMMAND_BYTES) return null;
    try {
      value = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!isRecord(value)) return null;
  if (
    value["type"] !== "coedit.command" ||
    !boundedString(value["documentName"]) ||
    !boundedString(value["actorId"]) ||
    !boundedString(value["commandId"]) ||
    !boundedString(value["idempotencyKey"]) ||
    !boundedString(value["command"]) ||
    !COMMAND_SET.has(value["command"]) ||
    !isRecord(value["payload"]) ||
    typeof value["createdAt"] !== "number" ||
    !Number.isSafeInteger(value["createdAt"])
  ) {
    return null;
  }
  if (options.documentName !== undefined && value["documentName"] !== options.documentName) return null;
  if (options.actorId && value["actorId"] !== options.actorId) return null;
  const expected = value["expectedWorkspaceRevision"];
  if (expected !== undefined && !boundedString(expected)) return null;
  if (!withinByteCap(value["payload"])) return null;
  return {
    type: "coedit.command",
    documentName: value["documentName"],
    actorId: value["actorId"],
    commandId: value["commandId"],
    idempotencyKey: value["idempotencyKey"],
    ...(expected === undefined ? {} : { expectedWorkspaceRevision: expected }),
    command: value["command"] as SatWorkspaceCommandName,
    payload: value["payload"],
    createdAt: value["createdAt"],
  };
}

export function createSatWorkspaceCommand(input: {
  documentName: string;
  actorId: string;
  command: SatWorkspaceCommandName;
  payload: Record<string, unknown>;
  expectedWorkspaceRevision?: string | null;
}): SatWorkspaceCommand {
  const commandId = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const expected = input.expectedWorkspaceRevision?.trim();
  return {
    type: "coedit.command",
    documentName: input.documentName,
    actorId: input.actorId,
    commandId,
    idempotencyKey: commandId,
    ...(expected ? { expectedWorkspaceRevision: expected } : {}),
    command: input.command,
    payload: input.payload,
    createdAt: Date.now(),
  };
}

export function isSatWorkspaceCommandName(value: unknown): value is SatWorkspaceCommandName {
  return typeof value === "string" && COMMAND_SET.has(value);
}
