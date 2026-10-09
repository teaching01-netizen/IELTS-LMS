import type { AccessLinkStatus } from "../../contracts/accessLinks";

/**
 * Three states are kept deliberately separate on the Delivery page:
 *  - publication (a version exists),
 *  - student ENTRY (can students use the link: derived from the link status),
 *  - SESSION (has the proctor-run exam started: derived from the runtime).
 * "Entry open" never implies "Running", and pausing entry never pauses a
 * running exam.
 */
export type SessionPhase = "ready" | "live" | "paused" | "finished" | "cancelled" | "unknown";

export interface AccessSessionInfo {
  phase: SessionPhase;
  /** The stored timing model (`runtime.timingModel`), when the server reports it. */
  timingModel: string | null;
  /** Students who have joined admission, including those without an attempt yet. */
  joined: number | null;
  ready?: number | null;
}

export type SessionActionKind =
  | "open-live"
  | "view-results"
  | "refresh"
  | "open-room"
  | "duplicate";

export interface SessionActionPlan {
  primary: { kind: SessionActionKind; label: string } | null;
  supporting: Array<{ kind: SessionActionKind; label: string }>;
}

/** Runtime status strings as the session summaries report them. */
export function sessionPhaseFromRuntime(status: string | null | undefined, scheduleStatus?: string | null): SessionPhase {
  // A cancelled schedule wins even when the runtime row lags behind; it is an
  // outcome of its own, never folded into Finished.
  if (status === "cancelled" || scheduleStatus === "cancelled") return "cancelled";
  if (status === "completed" || scheduleStatus === "completed") return "finished";
  if (status === "live") return "live";
  if (status === "paused") return "paused";
  if (status === "not_started" || status === "ready" || status === "scheduled") return "ready";
  return "unknown";
}

export const SESSION_PHASE_LABEL: Record<SessionPhase, string> = {
  ready: "Not started",
  live: "Running",
  paused: "Paused",
  finished: "Finished",
  cancelled: "Cancelled",
  unknown: "Status unavailable",
};

/** Student-entry state, independent of whether the session has started. */
export const ENTRY_STATE: Record<AccessLinkStatus, string> = {
  live: "Open",
  upcoming: "Opens later",
  paused: "Paused",
  ended: "Closed",
  revoked: "Revoked",
};

export function entryLabel(status: AccessLinkStatus): string {
  return `Check-in ${ENTRY_STATE[status].toLowerCase()}`;
}

const EXAM_RUN_LABEL: Record<SessionPhase, string> = {
  ready: "Exam not started",
  live: "Exam running",
  paused: "Exam paused",
  finished: "Exam finished",
  cancelled: "Exam cancelled",
  unknown: "Exam status unavailable",
};

/**
 * One line that keeps the two states apart: "Check-in open · Exam not started".
 * `entry` is null when the link's check-in state is unknown to this viewer, in
 * which case only the exam run state is stated (never a guess about check-in).
 */
export function sessionStatusLine(entry: AccessLinkStatus | null, phase: SessionPhase): string {
  return entry ? `${entryLabel(entry)} · ${EXAM_RUN_LABEL[phase]}` : EXAM_RUN_LABEL[phase];
}

/**
 * The visible actions for a session phase. Lists locate work; the session room
 * runs it, so starting and resuming are never offered here: those entry points
 * lead into the room, where the version, students and readiness are in view.
 * Staff who may not run sessions get no session actions at all (the
 * destination routes would refuse them), and a stale or unknown state offers a
 * refresh rather than a guess.
 */
export function sessionActionPlan(phase: SessionPhase, options: { canRun: boolean; stale: boolean }): SessionActionPlan {
  if (!options.canRun) return { primary: null, supporting: [] };
  if (options.stale || phase === "unknown") {
    return { primary: { kind: "refresh", label: "Refresh status" }, supporting: [] };
  }
  switch (phase) {
    case "ready":
    case "paused":
      return { primary: { kind: "open-room", label: "Open room" }, supporting: [] };
    case "live":
      return {
        primary: { kind: "open-live", label: "Open live room" },
        supporting: [{ kind: "view-results", label: "View results" }],
      };
    case "finished":
      return {
        primary: { kind: "view-results", label: "View results" },
        supporting: [{ kind: "duplicate", label: "Duplicate setup" }],
      };
    case "cancelled":
      return {
        primary: { kind: "open-room", label: "Review room" },
        supporting: [{ kind: "duplicate", label: "Duplicate setup" }],
      };
  }
}

/** What the page needs from its host to show and run sessions. Router-free on purpose. */
export interface AccessSessionBindings {
  /** The signed-in role may open the session room (admin / proctor routes). */
  canRun: boolean;
  infoFor: (scheduleId: string) => AccessSessionInfo | null;
  /** The last status read failed or never arrived. */
  stale: boolean;
  refreshing: boolean;
  onRefresh: () => void;
  onOpenRoom: (scheduleId: string) => void;
  onOpenResults: (scheduleId: string) => void;
}
