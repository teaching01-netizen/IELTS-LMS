import {
  useCallback,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import type { QueryClient } from "@tanstack/react-query";
import type { QuestionRevision } from "../contracts/assessment";
import { SAVE_CONFLICT_COPY } from "../realtime/connectionCopy";
import type { DivergenceEvent } from "../realtime";
import type { FieldWriter, SatAuthoringCollaborationValue } from "../realtime/coedit";
import {
  useQuestionAutosave,
  type QuestionFlushResult,
  type QuestionSaveStatus,
} from "../hooks/useQuestionAutosave";
import { authoringEffects } from "../api/authoringQueryEffects";
import { useAuthoringSaveRouting } from "./useAuthoringSaveRouting";
import {
  COEDIT_MUTATION_FLUSH_TIMEOUT_MS,
  COEDIT_ROUTE_FLUSH_TIMEOUT_MS,
  coeditRoomBlockMessage,
} from "./collaboration/coeditNavigationGate";

/**
 * Who owns saving this question?
 *
 * WHY THIS EXISTS
 * ---------------
 * That question used to have no single answer. The workspace carried the
 * persistence STATE as a scatter of refs — a freeze flag, a remote-deletion
 * flag, a network-pause flag, a refetch guard, a prompt-free baseline, a
 * recovered-draft key, a draft mirror — each declared wherever its first reader
 * happened to sit, with comments explaining that hook order was load-bearing.
 * The save PIPELINE was split across three modules (routing, autosave, flush),
 * and every path that had to go durable re-derived which of them to consult.
 *
 * This hook is the one answer. It owns:
 *
 *   - which writer owns the open question's fields (`mode`)
 *   - the write pipeline: routing → autosave → the durable store
 *   - the save TRUTH the UI renders (status, offline, divergence, pending)
 *   - durability before navigation, in-page and across a route change
 *   - the refusal message when a move is not allowed, and the notice channel
 *     the surrounding surfaces report through
 *
 * What it does NOT own, on purpose: what an edit MEANS (the workspace decides
 * whether an edit is a room write, a prompt-only change, or a queued autosave),
 * and how a failure is DISPLAYED. Those are composition and presentation, and
 * they stay with the component that renders them.
 *
 * The refs are returned rather than hidden because three seams that are
 * deliberately outside persistence still read them: the divergence reducer owns
 * the pause flag, the realtime reconciler owns the remote-deletion flag, and the
 * draft-lifecycle projection writes the freeze/pause flags this module's save
 * router reads. They are persistence's state; those seams are persistence's
 * inputs. The draft's own mirrors and its adoption guard are NOT here: they
 * belong to the draft owner, which is the only module that reads them.
 */

/** Which writer persists the open question's fields. */
export type QuestionPersistenceMode = "http" | "prompt-room" | "workspace-room";

/** The legacy writer vocabulary, translated into the persistence vocabulary. */
export function toPersistenceMode(writer: FieldWriter): QuestionPersistenceMode {
  if (writer === "workspace") return "workspace-room";
  if (writer === "prompt-room") return "prompt-room";
  return "http";
}

export interface AuthoringPersistenceInput {
  examId: string;
  queryClient: QueryClient;
  /** The open draft, as the draft owner holds it. */
  draft: QuestionRevision | null;
  setDraft: Dispatch<SetStateAction<QuestionRevision | null>>;
  selectedExamQuestionId: string | null;
  /** The durable-key namespace of the open question, or null. */
  questionDraftKey: string | null;
  /** The exam-level workspace room is mounted for this session. */
  workspaceRoomActive: boolean;
  /** The question-scoped prompt room owns the prompt. */
  promptRoomActive: boolean;
  workspaceCollaboration: SatAuthoringCollaborationValue | null;
  /** Dispatched on the author's OWN save so it never reads as remote work. */
  divergenceDispatchRef: MutableRefObject<(event: DivergenceEvent) => void>;
  /** Applied to the given question's caches once a save lands. */
  applySavedRevision: (examQuestionId: string, saved: QuestionRevision) => void;
  /**
   * Offered a recovered device-local draft while a room owns the question.
   * Returning true means the caller has taken over presenting it (the room
   * renders its own content, so adopting into local state would be invisible).
   */
  holdRecoveredDraft?: ((examQuestionId: string, recovered: QuestionRevision) => boolean) | undefined;
  /**
   * The device-draft key the open question's unsaved work was recovered for.
   * The draft owner creates it (its adoption rule reads it): recovering a copy
   * and acknowledging it are the two writes, both from this module's paths.
   */
  recoveredQuestionDraftKeyRef: MutableRefObject<string | null>;
  /**
   * The draft owner's acknowledgment that a recovered key no longer guards the
   * server document. The hold path below takes custody of a recovered copy
   * without adopting it, and the adoption rule must stop treating that key as
   * an unanswered recovery — or the server question can never hydrate the base
   * editor and the recovery banner stays hidden behind a loading skeleton.
   */
  acknowledgeRecoveredDraftKey: (draftKey: string) => void;
}

export interface AuthoringPersistence {
  mode: QuestionPersistenceMode;
  status: QuestionSaveStatus;
  isOffline: boolean;
  hasPendingChanges: boolean;
  lastSavedAt: Date | null;
  /** The server holds a newer revision: network writes are held back. */
  conflict: boolean;
  /** Why the last attempted move was refused, or a notice, or null. */
  navigationError: string | null;
  setNavigationError: (message: string | null) => void;
  /** Persistence state other seams read (see the hook docs). */
  mutationFrozenRef: MutableRefObject<boolean>;
  deletedRemotelyRef: MutableRefObject<boolean>;
  networkSavePausedRef: MutableRefObject<boolean>;
  promptFreeBaselineRef: MutableRefObject<QuestionRevision | null>;
  /** Queue the open revision for autosave. */
  scheduleAutosave: (revision: QuestionRevision) => void;
  /** Make the open revision durable now, and report whether it landed. */
  flushNow: (revision: QuestionRevision) => Promise<QuestionFlushResult>;
  retry: (revision: QuestionRevision) => void;
  acknowledgeServerRevision: () => void;
  /**
   * Make the open revision durable and then advance: the queue's "Save & next"
   * depends on the write landing BEFORE the next question is created.
   */
  commitAndAdvance: (revision: QuestionRevision) => Promise<QuestionFlushResult>;
  /** The author's write path, for callers that need to bypass autosave. */
  saveDraft: (revision: QuestionRevision) => Promise<QuestionRevision | void>;
  flushBeforeNavigation: (intent?: "selection" | "mutation") => Promise<boolean>;
  flushBeforeRouteChange: () => Promise<boolean>;
}

export function useAuthoringPersistence(
  input: AuthoringPersistenceInput
): AuthoringPersistence {
  const {
    examId,
    queryClient,
    draft,
    setDraft,
    selectedExamQuestionId,
    questionDraftKey,
    workspaceRoomActive,
    promptRoomActive,
    workspaceCollaboration,
    divergenceDispatchRef,
    applySavedRevision,
    holdRecoveredDraft,
    recoveredQuestionDraftKeyRef,
    acknowledgeRecoveredDraftKey,
  } = input;

  /**
   * The refusal/notice channel.
   *
   * It is deliberately ONE channel: a refused move, a failed save, a recovered
   * draft and a completed copy are all "what just happened to your work", and
   * the surfaces that render them are the same. Splitting it would give the
   * author two places to look for the same sentence.
   */
  const [navigationError, setNavigationError] = useState<string | null>(null);
  // A published draft or a remotely deleted question freezes the mutation path
  // WITHOUT touching the author's typed content.
  const mutationFrozenRef = useRef(false);
  const deletedRemotelyRef = useRef(false);
  // A known-newer remote revision stops NETWORK autosave while the durable local
  // write continues. A ref (not state) because the divergence that sets it is
  // derived from the autosave this feeds.
  const networkSavePausedRef = useRef(false);
  // The last server-acknowledged revision the prompt-free field diff measures
  // against.
  const promptFreeBaselineRef = useRef<QuestionRevision | null>(null);

  // Single ownership (resolveFieldWriter): exactly one writer persists the open
  // question's fields, and the routing decision and the write it permits are
  // resolved together so no call site re-decides them.
  const { fieldWriter, saveDraft } = useAuthoringSaveRouting({
    examId,
    queryClient,
    selectedExamQuestionId,
    questionDraftKey,
    workspaceRoomActive,
    promptRoomActive,
    promptFreeBaselineRef,
    mutationFrozenRef,
    deletedRemotelyRef,
    divergenceDispatchRef,
    recoveredQuestionDraftKeyRef,
    setDraft,
    updateSummaryCache: applySavedRevision,
  });

  const autosave = useQuestionAutosave({
    save: saveDraft,
    durableKey: questionDraftKey,
    // NOT adopted silently. The shared autosave primitive defaults this to true
    // (a recovered copy is written back and saved); the authoring workspace
    // turns it off deliberately, because a device draft that came back after a
    // reload is the author's unsaved work and must be SURFACED as such — the
    // `onRecover` handler below holds it for the room or installs it beside a
    // notice that says where it came from. The alternative reads as a silent
    // overwrite of a question the author may have been reading.
    autoSaveRecovered: false,
    networkPausedRef: networkSavePausedRef,
    onRecover: (recovered) => {
      if (!questionDraftKey) return;
      if (selectedExamQuestionId && holdRecoveredDraft?.(selectedExamQuestionId, recovered)) {
        // A room owns the visible editor, so this must not be adopted silently:
        // the copy is held by the recovery owner and offered beside the editor.
        // The hold IS the resolution of the recovery for the adoption rule, so
        // the key is acknowledged rather than armed — arming it would make the
        // adoption rule block the server document forever, and the author would
        // see a loading skeleton where the editor and the recovery banner
        // should both be visible.
        acknowledgeRecoveredDraftKey(questionDraftKey);
        setNavigationError(null);
        return;
      }
      recoveredQuestionDraftKeyRef.current = questionDraftKey;
      setDraft(recovered);
      // A device-local draft came back after a reload. That is its own state,
      // not a remote conflict: nobody else's save is implied.
      setNavigationError(`${SAVE_CONFLICT_COPY.recovered} ${SAVE_CONFLICT_COPY.recoveredHint}`);
    },
  });

  /**
   * The in-page barrier, run before a question/module switch and before every
   * HTTP structural mutation.
   *
   * `mutation` is the default because most callers are about to change the exam
   * over HTTP (create, duplicate, delete, reorder, bulk, import, validate), and
   * the room cannot see those writes: running one while the room has not
   * committed the same exam applies it to a revision the author has already
   * moved past.
   *
   * `selection` is a move INSIDE the room. The previous question's content stays
   * in the Y.Doc and in its IndexedDB copy whether or not the network has
   * acknowledged it, so waiting on the service here would only make switching
   * slower — and would make it impossible offline, which is the state this layer
   * exists to survive.
   */
  const flushBeforeNavigation = useCallback(
    async (intent: "selection" | "mutation" = "mutation") => {
      // Shared scalar and rich fields are sent through the exam-level room. Do
      // not gate navigation on the legacy question autosave queue, which should
      // remain empty while this provider owns the workspace.
      if (workspaceCollaboration) {
        if (intent === "selection") return true;
        const result = await workspaceCollaboration.flushAndWaitForSaved(
          COEDIT_MUTATION_FLUSH_TIMEOUT_MS
        );
        // Read the snapshot AFTER the wait: a refusal, a freeze, or a fresh
        // acknowledgement all arrive while it is pending.
        const block = coeditRoomBlockMessage(
          workspaceCollaboration.workspaceSnapshot,
          result.outcome
        );
        if (block === null) return true;
        setNavigationError(block);
        return false;
      }
      if (!draft || autosave.status === "saved") return true;
      const result = await autosave.flushNow(draft);
      if (result.ok) return true;
      setNavigationError(
        // Fenced and diverged are the same condition with the same answer, so
        // they share one sentence: review the newer version, or take your work
        // with you. Neither accuses the save of failing.
        autosave.status === "conflict" ||
          networkSavePausedRef.current ||
          autosave.isNetworkPaused
          ? SAVE_CONFLICT_COPY.fencedBeforeLeaving
          : autosave.isOffline
            ? "You are offline. This draft is saved on this device; reconnect before leaving so it can sync."
            : SAVE_CONFLICT_COPY.failed
      );
      return false;
    },
    [autosave, draft, workspaceCollaboration]
  );

  /**
   * The route barrier, run before leaving the authoring surface.
   *
   * The next screen (exam preview, release, exam library) reads the committed
   * MySQL projection rather than the room, so nothing less than a durable
   * acknowledgement of THIS tab's state proves it will show the author's work.
   * A refusal is not navigated past. Query invalidation is awaited before the
   * route changes so the preview cannot mount on a cached exam detail still
   * inside its five-minute staleTime.
   */
  const flushBeforeRouteChange = useCallback(async (): Promise<boolean> => {
    if (!workspaceCollaboration) return flushBeforeNavigation("mutation");
    const result = await workspaceCollaboration.flushAndWaitForSaved(COEDIT_ROUTE_FLUSH_TIMEOUT_MS);
    const block = coeditRoomBlockMessage(
      workspaceCollaboration.workspaceSnapshot,
      result.outcome
    );
    if (block !== null) {
      setNavigationError(block);
      return false;
    }
    // A refetch failure must not strand the author here: the room is durable,
    // which is the promise; freshness is best-effort on top of it.
    await authoringEffects.refreshBeforeRouteChange(queryClient, examId);
    return true;
  }, [examId, flushBeforeNavigation, queryClient, workspaceCollaboration]);

  return {
    mode: toPersistenceMode(fieldWriter),
    status: autosave.status,
    isOffline: autosave.isOffline,
    hasPendingChanges: autosave.hasPendingChanges,
    lastSavedAt: autosave.lastSavedAt,
    conflict: autosave.status === "conflict",
    navigationError,
    setNavigationError,
    mutationFrozenRef,
    deletedRemotelyRef,
    networkSavePausedRef,
    promptFreeBaselineRef,
    scheduleAutosave: autosave.scheduleAutosave,
    flushNow: autosave.flushNow,
    retry: autosave.retry,
    acknowledgeServerRevision: autosave.acknowledgeServerRevision,
    commitAndAdvance: autosave.commitAndAdvance,
    saveDraft,
    flushBeforeNavigation,
    flushBeforeRouteChange,
  };
}
