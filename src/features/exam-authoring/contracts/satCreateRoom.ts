import type { AssessmentAccessLink, CreateAssessmentAccessLinkRequest } from "./accessLinks";
import type { SatPublishScope } from "./assessment";

/**
 * One-action SAT room creation. The server captures (or reuses) the immutable
 * release and creates the room in one transaction; the client never publishes.
 */

/** The room-level fields; the server, not the client, chooses the release. */
export type SatRoomFields = Omit<CreateAssessmentAccessLinkRequest, "publishedVersionId">;

export interface CreateSatRoomRequest {
  /** Minted once per submission and reused for every retry of that submission. */
  operationKey: string;
  /** Exam entity revision the client prepared against. */
  expectedExamRevision: number;
  /** The working draft the client saw; "" asserts there is none. */
  expectedDraftVersionId: string;
  /** Draft content revision the client saw (omitted when there is no draft). */
  expectedDraftRevision?: number;
  room: SatRoomFields;
}

export interface SatRoomVersion {
  id: string;
  number: number;
  scope: SatPublishScope;
  /** True when this operation sealed the release (false: an existing one was reused). */
  createdNow: boolean;
}

export interface SatRoomReceipt {
  room: AssessmentAccessLink;
  version: SatRoomVersion;
  exam: { revision: number };
}

export interface SatRoomIssue {
  code: string;
  path: string;
  message: string;
  assetId?: string;
}

/** Stable machine codes of the create-room endpoint. */
export type SatRoomErrorCode =
  | "EXAM_NOT_READY"
  | "EXAM_REVISION_CHANGED"
  | "ROOM_INVALID"
  | "OPERATION_KEY_CONFLICT"
  | "OPERATION_NOT_FOUND"
  | "EXAM_SCOPE_UNAVAILABLE"
  | "SAT_CLASSROOM_DISABLED";

/**
 * The flow's lifecycle. One discriminated union instead of parallel booleans:
 * "created" can never coexist with "unknown", and only `unknown` carries a key
 * that must be reused.
 */
export type CreateRoomState =
  | { status: "editing" }
  | { status: "syncing" }
  | { status: "creating"; operationKey: string }
  | { status: "created"; operationKey: string; receipt: SatRoomReceipt }
  | { status: "invalid"; message: string; issues: SatRoomIssue[] }
  | { status: "conflict"; message: string; currentExamRevision: number | null }
  | { status: "unknown"; operationKey: string; message: string }
  | { status: "failed"; message: string };
