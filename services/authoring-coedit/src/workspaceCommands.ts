/** Authenticated, stateless notifications for successful workspace commands. */

export const WORKSPACE_COMMANDS = new Set([
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
]);

const MAX_COMMAND_BYTES = 64 * 1024;
const MAX_STRING_LENGTH = 256;

export interface WorkspaceCommandEnvelope {
  type: "coedit.command";
  documentName: string;
  actorId: string;
  commandId: string;
  idempotencyKey: string;
  expectedWorkspaceRevision?: string;
  command: string;
  payload: Record<string, unknown>;
  createdAt: number;
}

function boundedString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= MAX_STRING_LENGTH;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Validates a command at the authenticated room boundary. Invalid or unknown
 * messages are ignored, while a read-only or mismatched actor cannot relay a
 * notification into another author's room.
 */
export function parseWorkspaceCommand(
  payload: string,
  expectedDocumentName: string,
  expectedActorId: string | undefined,
): WorkspaceCommandEnvelope | null {
  if (Buffer.byteLength(payload, "utf8") > MAX_COMMAND_BYTES) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(payload);
  } catch {
    return null;
  }
  if (!isRecord(raw)) return null;
  if (
    raw["type"] !== "coedit.command" ||
    raw["documentName"] !== expectedDocumentName ||
    !boundedString(raw["actorId"]) ||
    (expectedActorId && raw["actorId"] !== expectedActorId) ||
    !boundedString(raw["commandId"]) ||
    !boundedString(raw["idempotencyKey"]) ||
    !boundedString(raw["command"]) ||
    !WORKSPACE_COMMANDS.has(raw["command"]) ||
    !isRecord(raw["payload"]) ||
    typeof raw["createdAt"] !== "number" ||
    !Number.isSafeInteger(raw["createdAt"])
  ) {
    return null;
  }
  const expectedRevision = raw["expectedWorkspaceRevision"];
  if (expectedRevision !== undefined && !boundedString(expectedRevision)) return null;
  try {
    if (Buffer.byteLength(JSON.stringify(raw["payload"]), "utf8") > MAX_COMMAND_BYTES) return null;
  } catch {
    return null;
  }
  return {
    type: "coedit.command",
    documentName: expectedDocumentName,
    actorId: raw["actorId"],
    commandId: raw["commandId"],
    idempotencyKey: raw["idempotencyKey"],
    ...(expectedRevision === undefined ? {} : { expectedWorkspaceRevision: expectedRevision }),
    command: raw["command"],
    payload: raw["payload"],
    createdAt: raw["createdAt"],
  };
}
