/**
 * Ephemeral notifications for authoritative workspace commands.
 *
 * Rich and scalar fields travel through the shared Y.Doc. Structural actions
 * still use the existing HTTP mutations because the API owns authorization,
 * revision fencing, and persistence. After one of those mutations succeeds,
 * the authoring room relays this small stateless envelope so every open SAT
 * surface can invalidate its local query view without a refresh.
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
const MAX_COMMAND_PAYLOAD_BYTES = 64 * 1024;

function boundedString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= MAX_COMMAND_STRING;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Parse only validated, workspace-scoped command envelopes from the room. */
export function parseSatWorkspaceCommand(
  raw: unknown,
  expectedDocumentName?: string,
): SatWorkspaceCommand | null {
  if (!isRecord(raw)) return null;
  if (
    raw["type"] !== "coedit.command" ||
    !boundedString(raw["documentName"]) ||
    !boundedString(raw["actorId"]) ||
    !boundedString(raw["commandId"]) ||
    !boundedString(raw["idempotencyKey"]) ||
    !boundedString(raw["command"]) ||
    !isRecord(raw["payload"]) ||
    typeof raw["createdAt"] !== "number" ||
    !Number.isSafeInteger(raw["createdAt"])
  ) {
    return null;
  }
  if (expectedDocumentName && raw["documentName"] !== expectedDocumentName) return null;
  if (!COMMAND_SET.has(raw["command"])) return null;
  const expected = raw["expectedWorkspaceRevision"];
  if (expected !== undefined && !boundedString(expected)) return null;
  try {
    if (new TextEncoder().encode(JSON.stringify(raw["payload"])).byteLength > MAX_COMMAND_PAYLOAD_BYTES) {
      return null;
    }
  } catch {
    return null;
  }
  return {
    type: "coedit.command",
    documentName: raw["documentName"],
    actorId: raw["actorId"],
    commandId: raw["commandId"],
    idempotencyKey: raw["idempotencyKey"],
    ...(expected === undefined ? {} : { expectedWorkspaceRevision: expected }),
    command: raw["command"] as SatWorkspaceCommandName,
    payload: raw["payload"],
    createdAt: raw["createdAt"],
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
