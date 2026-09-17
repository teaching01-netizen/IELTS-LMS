import { backendPost } from "../../infrastructure/examAuthoringBackendGateway";
import { ApiError } from "../../../../shared/api-client/errors";
import type { CoeditTokenResponse } from "./contracts";
import { parseCoeditDocumentName, parseAnyDocumentName } from "./documentIdentity";
import { isCoeditDecimalString } from "./protocol";

/**
 * Raised when the SERVER cannot offer co-editing right now (capability off,
 * service not admitted). This is a normal, expected posture — not an error an
 * author should ever see — so the hook degrades to the legacy editor instead
 * of surfacing a failure banner.
 */
export class CoeditUnavailableError extends Error {
  readonly reason: string;
  constructor(reason: string) {
    super("Prompt collaboration is not available.");
    this.name = "CoeditUnavailableError";
    this.reason = reason;
  }
}

/**
 * Raised when the exam has no editable draft, so there is no room to open.
 *
 * A distinct type because it is the opposite of an outage: the service is fine
 * and the exam is simply not at a co-editable stage yet. Callers degrade to
 * "no room" silently instead of telling an author that collaboration is broken —
 * and, when they know that up front, they never ask at all.
 */
export class CoeditNoEditableDraftError extends Error {
  constructor() {
    super("This exam has no editable draft yet.");
    this.name = "CoeditNoEditableDraftError";
  }
}

/** Refuse a response whose document name is not the frozen opaque shape. */
function assertUsable(response: CoeditTokenResponse): CoeditTokenResponse {
  if (!response.token) throw new Error("Co-edit token response carried no token.");
  if (!parseCoeditDocumentName(response.documentName)) {
    throw new Error("Co-edit token response carried an invalid document name.");
  }
  if (!response.serviceUrl) throw new Error("Co-edit token response carried no service URL.");
  if (response.fieldSet !== "prompt") {
    throw new Error("Co-edit token response requested an unsupported field set.");
  }
  if (!response.actorId) {
    throw new Error("Co-edit token response carried no server-derived identity.");
  }
  if (response.mode !== "write" && response.mode !== "read") {
    throw new Error("Co-edit token response carried an unsupported mode.");
  }
  if (response.stateEpoch !== undefined && !isCoeditDecimalString(response.stateEpoch)) {
    throw new Error("Co-edit token response carried an invalid state epoch.");
  }
  if (response.commitSequence !== undefined && !isCoeditDecimalString(response.commitSequence)) {
    throw new Error("Co-edit token response carried an invalid commit sequence.");
  }
  if (
    response.workspaceRevision !== undefined &&
    (!Number.isSafeInteger(response.workspaceRevision) || response.workspaceRevision < 0)
  ) {
    throw new Error("Co-edit token response carried an invalid workspace revision.");
  }
  return response;
}

function assertWorkspaceUsable(response: CoeditTokenResponse): CoeditTokenResponse {
  if (!response.token) throw new Error("Co-edit token response carried no token.");
  const parsed = parseAnyDocumentName(response.documentName);
  if (!parsed || parsed.schemaVersion !== 2 || parsed.fieldSet !== "workspace") {
    throw new Error("Co-edit workspace token carried an invalid document name.");
  }
  if (!response.serviceUrl) throw new Error("Co-edit token response carried no service URL.");
  if (response.fieldSet !== "workspace") throw new Error("Co-edit workspace token requested an unsupported field set.");
  if (!response.actorId) throw new Error("Co-edit token response carried no server-derived identity.");
  if (response.mode !== "write" && response.mode !== "read") throw new Error("Co-edit token response carried an unsupported mode.");
  if (response.stateEpoch !== undefined && !isCoeditDecimalString(response.stateEpoch)) {
    throw new Error("Co-edit workspace token carried an invalid state epoch.");
  }
  if (response.commitSequence !== undefined && !isCoeditDecimalString(response.commitSequence)) {
    throw new Error("Co-edit workspace token carried an invalid commit sequence.");
  }
  if (
    response.workspaceRevision !== undefined &&
    (!Number.isSafeInteger(response.workspaceRevision) || response.workspaceRevision < 0)
  ) {
    throw new Error("Co-edit workspace token carried an invalid workspace revision.");
  }
  return response;
}

/**
 * Requests a co-edit token for one exam question.
 *
 * The server resolves the working draft, the question, the document row, and
 * the identity claims; the client supplies only the exam-question id it already
 * had authorized access to.
 */
export async function requestCoeditToken(examQuestionId: string): Promise<CoeditTokenResponse> {
  try {
    const response = await backendPost<CoeditTokenResponse>(
      `/v1/assessment-authoring/exam-questions/${encodeURIComponent(examQuestionId)}/coedit-token`,
      {}
    );
    return assertUsable(response);
  } catch (error) {
    if (error instanceof ApiError) {
      const reason =
        typeof error.details?.["coeditReason"] === "string"
          ? (error.details["coeditReason"] as string)
          : null;
      if (reason === "coedit_disabled" || error.status === 503) {
        throw new CoeditUnavailableError(reason ?? "coedit_unavailable");
      }
    }
    throw error;
  }
}

/**
 * Requests the single exam-level SAT authoring room.
 *
 * A 404 is the server naming a state, not a failure ("Only the current editable
 * SAT draft can be co-edited."), so it is declared expected — the request still
 * throws the typed error below, it just does not reach the console as a warning.
 */
export async function requestWorkspaceCoeditToken(examId: string): Promise<CoeditTokenResponse> {
  try {
    const response = await backendPost<CoeditTokenResponse>(
      `/v1/assessment-authoring/exams/${encodeURIComponent(examId)}/coedit-token`,
      {},
      { expectedStatuses: [404] },
    );
    return assertWorkspaceUsable(response);
  } catch (error) {
    if (error instanceof ApiError) {
      if (error.status === 404) throw new CoeditNoEditableDraftError();
      const reason = typeof error.details?.["coeditReason"] === "string"
        ? String(error.details["coeditReason"])
        : null;
      if (reason === "coedit_disabled" || error.status === 503) {
        throw new CoeditUnavailableError(reason ?? "coedit_unavailable");
      }
    }
    throw error;
  }
}

/**
 * Milliseconds before expiry at which the provider asks for a new token.
 *
 * The provider owns refresh scheduling (`PromptCoeditProvider.armTokenRefresh`
 * on a fixed interval plus a pre-expiry check in `requestToken`); a second
 * timer-based scheduler used to live here and nothing called it.
 */
export const COEDIT_TOKEN_REFRESH_LEAD_MS = 60_000;
