/**
 * The authoring shell lifecycle: one place where the HTTP answer becomes a
 * domain state.
 *
 * WHY THIS EXISTS
 * ---------------
 * The shell read used to answer 404 for "this exam has no editable draft yet",
 * so every consumer had to re-interpret a status code as a lifecycle state —
 * `!shell && isBackendNotFound(error)` in the workspace, a 404-tolerant retry
 * policy in the query layer, and an `expectedStatuses: [404]` escape hatch in
 * the adapter to silence the console warning. Those three had to agree with
 * each other, and a normal pre-draft exam still surfaced as a React Query
 * error with a production console stack.
 *
 * The backend now answers the lifecycle question directly (200 READY /
 * 200 NO_DRAFT / 404 EXAM_NOT_FOUND / 403 FORBIDDEN), and this module performs
 * the transport mapping exactly once. UI code switches on `state.kind`; it
 * never inspects a status code, and it never guesses.
 */
import type { AssessmentAuthoringShell, AssessmentAuthoringShellResult } from "../contracts/assessment";
import {
  hasBackendStatusCode,
  isBackendNotFound,
} from "../infrastructure/examAuthoringBackendGateway";
import { useAuthoringShell } from "../api/assessmentQueries";

/**
 * The lifecycle states a shell read can be in.
 *
 * These are mutually exclusive by construction. In particular there is no
 * "no draft AND exam missing" and no "error AND ready": the old shape needed
 * independent booleans/refs to express this, which is how a deleted-remotely,
 * editable, saving, published draft could all appear true at once.
 *
 * `loading` is a state rather than a separate boolean flag for the same
 * reason: it cannot coexist with any of the others.
 */
export type AuthoringShellState =
  | { kind: "loading" }
  | { kind: "ready"; shell: AssessmentAuthoringShell }
  | { kind: "no-draft" }
  | { kind: "exam-not-found" }
  | { kind: "forbidden" }
  | { kind: "error"; error: Error };

export interface AuthoringShellLifecycle {
  state: AuthoringShellState;
  /** Retry the read. This is a READ: it can never create a draft. */
  refetch: () => Promise<unknown>;
}

export type DraftOpenErrorKind = "exam-missing" | "forbidden" | "conflict" | "unknown";

export interface DraftOpenErrorInfo {
  kind: DraftOpenErrorKind;
  message: string;
}

/**
 * Classify a failed draft-open command.
 *
 * The open is a separate command from the read, so it has its own failure
 * vocabulary: a 409 here is a recoverable race between two openers (retry the
 * open, or refresh), which the read can never report. Status interpretation
 * lives here, once, so no screen decides what a 404 from the open means.
 */
export function toDraftOpenErrorInfo(error: unknown): DraftOpenErrorInfo {
  const message =
    error instanceof Error ? error.message : "The editable draft could not be opened.";
  if (isBackendNotFound(error)) {
    return { kind: "exam-missing", message };
  }
  if (hasBackendStatusCode(error, 403)) {
    return { kind: "forbidden", message };
  }
  if (hasBackendStatusCode(error, 409)) {
    return { kind: "conflict", message };
  }
  return { kind: "unknown", message };
}

/**
 * Map a successful shell response onto a lifecycle state.
 *
 * READY without a shell is unrepresentable on the wire. Reporting it as an
 * error (rather than downgrading it to NO_DRAFT) keeps a backend/proxy bug from
 * being silently rendered as "you have no draft" with an "Open draft" button
 * that would then clone on top of a draft that does exist.
 */
export function toAuthoringShellState(result: AssessmentAuthoringShellResult): AuthoringShellState {
  if (result.state === "NO_DRAFT") {
    return { kind: "no-draft" };
  }
  if (result.state === "READY" && result.shell) {
    return { kind: "ready", shell: result.shell };
  }
  return {
    kind: "error",
    error: new Error("The authoring shell response was incomplete."),
  };
}

/**
 * Map a failed shell read onto a lifecycle state.
 *
 * Only two failures are answers rather than faults — the exam does not exist,
 * and the caller may not read it — and both are classified here so no screen
 * has to decide what a 404 means.
 */
export function toAuthoringShellErrorState(error: unknown): AuthoringShellState {
  if (isBackendNotFound(error)) {
    return { kind: "exam-not-found" };
  }
  if (hasBackendStatusCode(error, 403)) {
    return { kind: "forbidden" };
  }
  return {
    kind: "error",
    error: error instanceof Error ? error : new Error("The authoring shell could not be loaded."),
  };
}

/**
 * The workspace's shell read. Refreshing, remounting, refocusing and
 * reconnecting all go through this and all stay reads.
 */
export function useAuthoringShellLifecycle(examId: string): AuthoringShellLifecycle {
  const query = useAuthoringShell(examId);
  // Cached data wins over a failed background refetch: the shell we already
  // hold is still the best available answer, and replacing it with an error
  // surface would throw away a workspace the user is actively editing.
  let state: AuthoringShellState;
  if (query.data) {
    state = toAuthoringShellState(query.data);
  } else if (query.error) {
    state = toAuthoringShellErrorState(query.error);
  } else {
    state = { kind: "loading" };
  }
  return { state, refetch: () => query.refetch() };
}
