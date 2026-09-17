import { useCallback, useEffect, useState } from "react";
import type { QueryClient } from "@tanstack/react-query";
import { assessmentKeys } from "../api/assessmentQueries";
import type { QuestionSaveStatus } from "../hooks/useQuestionAutosave";
import type {
  CoeditLifecycleIssue,
  CoeditRecovery,
  SatAuthoringCollaborationValue,
  UsePromptCoeditingResult,
  WorkspaceRecovery,
} from "../realtime/coedit";
import { COEDIT_RECOVERY_COPY, type CoeditRecoveryIssue } from "./collaboration/collaborationCopy";
import {
  coeditDisplayStatusFor,
  coeditSaveStatusFor,
  type CoeditSaveDisplayStatus,
} from "./spine/coeditSaveTruth";

/**
 * Everything the workspace shows ABOUT collaboration: which room owns the
 * prompt, one combined save truth, the recovery a room that cannot continue
 * must offer, and the presence the author publishes to the exam room.
 *
 * It is policy, not rendering: the workspace passes the two room facts in and
 * reads named values out, so no save-status rule or lifecycle branch lives in
 * the middle of the render body.
 */
export interface CoeditRecoveryAndPresenceInput {
  examId: string;
  queryClient: QueryClient;
  /** The exam-level room, when the route mounted one. */
  workspaceCollaboration: SatAuthoringCollaborationValue | null;
  /** The question-scoped prompt room hook. */
  coedit: UsePromptCoeditingResult;
  /** The exam-level room is mounted for this session. */
  workspaceUiActive: boolean;
  /** A room really exists (its provider produced a session). */
  coeditRoomOpen: boolean;
  /** Co-edit chrome is active, including the pre-session preparation window. */
  coeditUiActive: boolean;
  selectedExamQuestionId: string | null;
  autosaveStatus: QuestionSaveStatus;
  /** Recorded by the lifecycle/publish signals owned by the workspace. */
  publishedFrozen: boolean;
  setPublishedFrozen: (frozen: boolean) => void;
}

/** What the recovery surface can offer, already decided. */
export interface CoeditRecoverySurfaceState {
  issue: CoeditRecoveryIssue;
  /** Explanation to show, from the single copy table. */
  body: string;
  /** True when the room ended and a replacement draft exists to open. */
  roomEnded: boolean;
}

/**
 * The recovery surface a lifecycle issue warrants, or null when it warrants
 * none.
 *
 * Pure, and deliberately not a render-body condition: a published room's work
 * is durable, and issue vocabulary that is not in the recovery set (offline,
 * reconnecting, token expiry) must never claim the author's work is at risk.
 */
export function coeditRecoverySurfaceFor(input: {
  issue: CoeditLifecycleIssue;
  published: boolean;
  coeditUiActive: boolean;
}): CoeditRecoverySurfaceState | null {
  if (!input.coeditUiActive || input.published) return null;
  const issue = input.issue;
  if (
    issue !== "closed" &&
    issue !== "replaced" &&
    issue !== "oversized" &&
    issue !== "rejected" &&
    issue !== "stale_cache"
  ) {
    return null;
  }
  return {
    issue,
    body: COEDIT_RECOVERY_COPY[issue],
    roomEnded: issue === "closed" || issue === "replaced",
  };
}

export interface CoeditRecoveryAndPresence {
  handleRealtimeLifecycle: (
    signal: "draft-replaced" | "published" | "exam-changed",
  ) => void;
  /** The room's own save truth, in the legacy vocabulary, for `combineSaveStatus`. */
  coeditSaveStatus: ReturnType<typeof coeditSaveStatusFor> | null;
  coeditRecovery: WorkspaceRecovery | CoeditRecovery | null;
  /** The recovery banner to render, or null. */
  coeditRecoverySurface: CoeditRecoverySurfaceState | null;
  coeditDisplayStatus: CoeditSaveDisplayStatus | null;
  collaborationReadOnly: boolean;
  collaborationPublished: boolean;
  collaborationLifecyclePhase: string | null;
  collaborationIsReadOnly: boolean | null;
  hasCollaborationSession: boolean;
}

export function useCoeditRecoveryAndPresence(
  input: CoeditRecoveryAndPresenceInput,
): CoeditRecoveryAndPresence {
  const {
    examId,
    queryClient,
    workspaceCollaboration,
    coedit,
    workspaceUiActive,
    coeditRoomOpen,
    coeditUiActive,
    selectedExamQuestionId,
    autosaveStatus,
    publishedFrozen,
    setPublishedFrozen,
  } = input;

  const coeditSession = coedit.session;
  /**
   * The exam room, when there is one.
   *
   * A room that was never opened because the exam has no editable draft is
   * `disabled`: its empty snapshot is not a view-only room, and reading it as one
   * would let it veto saves the HTTP editors are perfectly entitled to make.
   */
  const room =
    workspaceCollaboration && workspaceCollaboration.status !== "disabled"
      ? workspaceCollaboration
      : null;
  // The save clock only advances while something is pending, so an idle
  // workspace does not re-render four times a second.
  const [coeditSaveClock, setCoeditSaveClock] = useState(() => Date.now());

  // The save truth of the prompt comes from the co-edit acknowledgement, not
  // from the legacy autosave counter, which knows nothing about the CRDT. Both
  // are combined below by taking the LEAST advanced of the two, so neither can
  // claim "Saved" for work the other is still holding.
  const coeditSaveStatus = !workspaceUiActive && coeditRoomOpen
    ? coeditSaveStatusFor(coeditSession?.saveState.name ?? "idle")
    : null;

  // A room that cannot continue must say so and offer the recovery the design
  // requires ("Offline and recovery behavior", docs/sat-authoring-coedit.md):
  // copy/export the prompt before a replacement draft is opened.
  const coeditRecovery = workspaceCollaboration?.recovery ?? coeditSession?.recovery ?? null;
  const coeditRecoverySurface = coeditRecovery
    ? coeditRecoverySurfaceFor({
        issue: coeditRecovery.issue,
        published: coeditRecovery.published === true,
        coeditUiActive,
      })
    : null;

  const handleRealtimeLifecycle = useCallback(
    (signal: "draft-replaced" | "published" | "exam-changed") => {
      // Re-fetch the shell so the workspace re-resolves the current draft; the
      // draft binding change re-mounts the socket against the new draft.
      void queryClient.invalidateQueries({ queryKey: assessmentKeys.shell(examId) });
      if (signal === "published") {
        setPublishedFrozen(true);
      }
      if (signal === "draft-replaced") {
        // `draft.replaced` is the durable signal for a replacement (design:
        // "Draft replacement and workbook replacement/undo"). Routing it into
        // the room makes the export offer appear even if the close frame was
        // lost, which is the case the socket alone cannot cover.
        if (workspaceCollaboration) workspaceCollaboration.reportReplaced();
        else coedit.reportReplaced();
      }
    },
    [coedit, examId, queryClient, setPublishedFrozen, workspaceCollaboration]
  );

  const coeditPendingSince = workspaceCollaboration?.pendingSince ?? coeditSession?.pendingSince ?? null;
  useEffect(() => {
    if (coeditPendingSince === null) return undefined;
    setCoeditSaveClock(Date.now());
    const timer = globalThis.setInterval(() => setCoeditSaveClock(Date.now()), 250);
    return () => globalThis.clearInterval(timer);
  }, [coeditPendingSince]);

  const coeditDisplayStatus: CoeditSaveDisplayStatus | null = room
    ? room.status === "error" &&
      room.lifecyclePhase === "active" &&
      !room.workspaceSnapshot.readOnly
      ? "error"
      : room.status === "preparing"
        ? "saving"
        : coeditDisplayStatusFor({
            saveState: room.workspaceSnapshot.saveState,
            connectionPhase: room.connectionPhase,
            hasEstablishedConnection: room.workspaceSnapshot.hasEstablishedConnection,
            lifecyclePhase: room.lifecyclePhase,
            readOnly: room.workspaceSnapshot.readOnly,
            pendingSince: room.pendingSince ?? null,
            now: coeditSaveClock,
          })
    : coeditUiActive
      ? coedit.error !== null &&
        (!coeditSession ||
          (coeditSession.lifecyclePhase === "active" && !coeditSession.readOnly))
        ? "error"
        : coeditDisplayStatusFor({
            saveState: coeditSession?.saveState ?? null,
            connectionPhase: coeditSession?.connectionPhase ?? "connecting",
            hasEstablishedConnection: coeditSession?.hasEstablishedConnection ?? false,
            lifecyclePhase: coeditSession?.lifecyclePhase ?? (publishedFrozen ? "frozen" : "active"),
            readOnly: Boolean(coeditSession?.readOnly ?? publishedFrozen),
            pendingSince: coeditPendingSince,
            autosaveStatus,
            now: coeditSaveClock,
          })
      : null;
  const collaborationReadOnly = room
    ? room.workspaceSnapshot.readOnly || room.lifecyclePhase !== "active"
    : Boolean(coeditSession?.readOnly || publishedFrozen);
  const collaborationPublished = Boolean(
    room?.workspaceSnapshot.published || coeditSession?.recovery.published,
  );
  const collaborationLifecyclePhase =
    room?.lifecyclePhase ?? coeditSession?.lifecyclePhase ?? null;
  const collaborationIsReadOnly =
    room?.workspaceSnapshot.readOnly ?? coeditSession?.readOnly ?? null;
  const hasCollaborationSession = Boolean(room || coeditSession);

  // The author's own presence in the exam room: which question the builder is
  // looking at. Published from here so a route cannot forget to announce it.
  const publishPresence = workspaceCollaboration?.setPresence;
  useEffect(() => {
    if (!publishPresence) return;
    publishPresence({
      surface: "builder",
      ...(selectedExamQuestionId ? { questionId: selectedExamQuestionId } : {}),
    });
  }, [publishPresence, selectedExamQuestionId]);

  return {
    handleRealtimeLifecycle,
    coeditSaveStatus,
    coeditRecovery,
    coeditRecoverySurface,
    coeditDisplayStatus,
    collaborationReadOnly,
    collaborationPublished,
    collaborationLifecyclePhase,
    collaborationIsReadOnly,
    hasCollaborationSession,
  };
}
