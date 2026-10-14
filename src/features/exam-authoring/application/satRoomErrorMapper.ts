import { ApiError } from "../../../shared/api-client/errors";
import type { SatRoomErrorCode, SatRoomIssue } from "../contracts/satCreateRoom";

/**
 * What a failed create-room POST means for the NEXT action. The status and the
 * machine code are read here once; no screen interprets them again.
 *
 *  - named validation/fence/permission refusals allow correction.
 *  - unknown: no answer, 5xx, or an unclassified response. The operation may have committed, so the same
 *    key and body must be reused until it is resolved.
 */
export type SatRoomFailure =
  | { kind: "not-ready"; message: string; issues: SatRoomIssue[]; currentExamRevision: number | null }
  | { kind: "conflict"; message: string; currentExamRevision: number | null }
  | { kind: "invalid"; message: string }
  | { kind: "forbidden"; message: string }
  | { kind: "rejected"; message: string }
  | { kind: "unknown"; message: string };

const COPY: Record<SatRoomErrorCode, string> = {
  EXAM_NOT_READY: "Room not created. Fix the exam issues below, then try again.",
  EXAM_REVISION_CHANGED: "The exam changed while this room was being prepared. Review the latest exam, then try again.",
  ROOM_INVALID: "Room not created. Check the room details.",
  OPERATION_KEY_CONFLICT: "This request was already used for a different room. Try again.",
  OPERATION_NOT_FOUND: "No room was created by that attempt.",
  EXAM_SCOPE_UNAVAILABLE: "The saved exam does not include the sections this room needs. Edit the exam once, then create the room.",
};

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

export function parseSatRoomIssues(details: Record<string, unknown> | undefined): SatRoomIssue[] {
  const raw = details?.["issues"];
  if (!Array.isArray(raw)) return [];
  const issues: SatRoomIssue[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const record = item as Record<string, unknown>;
    const message = typeof record["message"] === "string" ? record["message"] : "";
    if (!message) continue;
    issues.push({
      code: typeof record["code"] === "string" ? record["code"] : "",
      path: typeof record["path"] === "string" ? record["path"] : "",
      message,
      ...(typeof record["assetId"] === "string" ? { assetId: record["assetId"] } : {}),
    });
  }
  return issues;
}

export function classifySatRoomError(error: unknown): SatRoomFailure {
  if (!(error instanceof ApiError)) {
    return { kind: "unknown", message: "The connection was lost before the room could be confirmed." };
  }
  const code = error.code as SatRoomErrorCode | string;
  const currentExamRevision = numberOrNull(error.details?.["currentExamRevision"]);
  if (code === "EXAM_NOT_READY") {
    return { kind: "not-ready", message: COPY.EXAM_NOT_READY, issues: parseSatRoomIssues(error.details), currentExamRevision };
  }
  if (code === "EXAM_REVISION_CHANGED") {
    return { kind: "conflict", message: COPY.EXAM_REVISION_CHANGED, currentExamRevision };
  }
  if (code === "ROOM_INVALID" || code === "VALIDATION_ERROR" || code === "BAD_REQUEST") {
    return { kind: "invalid", message: error.message || COPY.ROOM_INVALID };
  }
  if (code === "EXAM_SCOPE_UNAVAILABLE") {
    return { kind: "rejected", message: COPY.EXAM_SCOPE_UNAVAILABLE };
  }
  if (code === "OPERATION_KEY_CONFLICT") {
    return { kind: "unknown", message: "This key belongs to a different request. Check the original room's status before creating another room." };
  }
  if (error.status === 403 || error.status === 401) {
    return { kind: "forbidden", message: "You do not have permission to create rooms for this exam." };
  }
  // A generic 4xx is not proof of rollback: legacy replay can fail after a
  // commit, and OPERATION_IN_PROGRESS must retain the original key.
  return { kind: "unknown", message: "The room could not be confirmed. Check its status before trying again." };
}
