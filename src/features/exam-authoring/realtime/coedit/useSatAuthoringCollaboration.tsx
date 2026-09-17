import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useExamQuery } from "../../api/examQueries";
import type { StructuredContent } from "../../contracts/assessment";
import type { CoeditFlushResult, CoeditLifecycleIssue } from "./contracts";
import {
  CoeditNoEditableDraftError,
  CoeditUnavailableError,
  requestWorkspaceCoeditToken,
} from "./tokenApi";
import {
  SatAuthoringWorkspaceProvider,
  type WorkspaceCoeditSnapshot,
  type WorkspaceCoeditingStatus,
  type WorkspaceFieldBinding,
  type WorkspaceRecovery,
} from "./workspaceProvider";
import type { SatWorkspaceCommandName } from "./workspaceCommands";

export interface SatAuthoringCollaborationValue {
  examId: string;
  enabled: boolean;
  status: WorkspaceCoeditingStatus;
  error: string | null;
  workspaceSnapshot: WorkspaceCoeditSnapshot;
  connectionPhase: WorkspaceCoeditSnapshot["connectionPhase"];
  lifecyclePhase: WorkspaceCoeditSnapshot["lifecyclePhase"];
  pendingSince?: number;
  lastAckedRevision?: string;
  participants: WorkspaceCoeditSnapshot["participants"];
  retry: () => void;
  setValue: (path: string, value: unknown) => void;
  setValues: (values: Record<string, unknown>) => void;
  /**
   * Proposes the first value for an empty shared path. The room arbitrates it
   * (see `SatAuthoringWorkspaceProvider.seedValue`); `sourceQuestionRevision`
   * ties the proposal to the revision it was derived from. False means no
   * proposal was sent — a read-only session, or a path that is already
   * populated.
   */
  seedValue: (path: string, value: unknown, sourceQuestionRevision?: number) => boolean;
  seedRichField: (
    path: string,
    content: StructuredContent,
    sourceQuestionRevision?: number,
  ) => boolean;
  setRichField: (path: string, content: StructuredContent) => void;
  publishCommand: (
    command: SatWorkspaceCommandName,
    payload: Record<string, unknown>,
  ) => boolean;
  fieldBinding: (path: string) => WorkspaceFieldBinding | null;
  /**
   * Flushes the exam room and resolves once this tab's exact state is durable.
   * Navigation must await it: nothing else proves the room reached MySQL.
   */
  flushAndWaitForSaved: (timeoutMs: number) => Promise<CoeditFlushResult>;
  setPresence: (target: { surface: "builder" | "release" | "access"; questionId?: string; fieldPath?: string }) => void;
  recovery: WorkspaceRecovery | null;
  reportReplaced: () => void;
}

const EMPTY_SNAPSHOT: WorkspaceCoeditSnapshot = {
  ready: false,
  localReady: false,
  connectionPhase: "connecting",
  hasEstablishedConnection: false,
  lifecyclePhase: "active",
  readOnly: true,
  writeCapable: false,
  saveState: {
    name: "idle",
    localStateVector: null,
    acknowledgedStateVector: null,
    questionRevision: null,
    message: null,
    retryable: false,
  },
  participants: [],
  values: {},
  commands: [],
  issue: "none",
  issueMessage: null,
  published: false,
};

const SatAuthoringCollaborationContext = createContext<SatAuthoringCollaborationValue | null>(null);

export function SatAuthoringCollaborationProvider({ examId, children }: { examId: string; children: ReactNode }) {
  /**
   * Does this exam have an editable draft to co-edit?
   *
   * The room the boundary opens is the CURRENT EDITABLE SAT DRAFT's room, so an
   * exam without a draft pointer has no room at all — the token endpoint says so
   * itself (404, "Only the current editable SAT draft can be co-edited"). Asking
   * first and reading the refusal as an error turned a normal pre-draft exam into
   * a 404 and a warning in every console on the way in, so the room is only
   * requested once the exam read says there is something to open.
   *
   * `null` means "not answered yet": the exam read is the same one every SAT
   * authoring page already performs, and the room waits for it rather than
   * guessing. That wait is what makes this deterministic — a request fired in the
   * same tick as the exam read would race it and lose.
   */
  const examQuery = useExamQuery(examId);
  const hasEditableDraft = examQuery.isSuccess
    ? Boolean(examQuery.data?.currentDraftVersionId)
    : null;
  const [status, setStatus] = useState<WorkspaceCoeditingStatus>("preparing");
  const [snapshot, setSnapshot] = useState<WorkspaceCoeditSnapshot>(EMPTY_SNAPSHOT);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const providerRef = useRef<SatAuthoringWorkspaceProvider | null>(null);
  // Only a successful exam read may deny the room: an exam read that is loading
  // or failed is not evidence that a draft is missing, and acting on it would
  // disable collaboration for every exam behind one transient error.
  const noEditableDraft = hasEditableDraft === false;

  useEffect(() => {
    let active = true;
    let createdProvider: SatAuthoringWorkspaceProvider | null = null;
    let unsubscribe: (() => void) | null = null;
    providerRef.current = null;
    if (noEditableDraft) {
      // No draft, no room: this is the quiet posture (see the provider doc), not
      // a failure to report. Consumers read `status: "disabled"` as "no room"
      // and keep their own HTTP save path.
      setStatus("disabled");
      setSnapshot(EMPTY_SNAPSHOT);
      setError(null);
      return undefined;
    }
    if (hasEditableDraft === null) {
      // Waiting on the exam read, which is also what "preparing" already means.
      setStatus("preparing");
      setSnapshot(EMPTY_SNAPSHOT);
      setError(null);
      return undefined;
    }
    setStatus("preparing");
    setSnapshot(EMPTY_SNAPSHOT);
    setError(null);

    void (async () => {
      try {
        const token = await requestWorkspaceCoeditToken(examId);
        if (!active) return;
        const provider = new SatAuthoringWorkspaceProvider({
          documentName: token.documentName,
          serviceUrl: token.serviceUrl,
          token: { token: token.token, expiresAt: token.expiresAt },
          // The epoch namespaces the local recovery cache; a legacy server omits
          // it and the provider falls back to epoch zero.
          ...(token.stateEpoch === undefined ? {} : { stateEpoch: token.stateEpoch }),
          self: { actorId: token.actorId, displayName: token.displayName },
          readOnly: token.mode !== "write",
          refreshToken: async () => {
            const next = await requestWorkspaceCoeditToken(examId);
            if (next.documentName !== token.documentName) throw new Error("The collaboration session was replaced.");
            return { token: next.token, expiresAt: next.expiresAt };
          },
          onLifecycle: (issue: CoeditLifecycleIssue, message: string | null) => {
            if (active && message) setError(message);
            if (active && issue === "none") setError(null);
          },
        });
        createdProvider = provider;
        providerRef.current = provider;
        unsubscribe = provider.subscribe((next) => {
          if (!active) return;
          setSnapshot(next);
          setStatus(next.ready ? "ready" : "preparing");
          if (next.issueMessage) setError(next.issueMessage);
        });
      } catch (cause) {
        if (!active) return;
        if (cause instanceof CoeditNoEditableDraftError) {
          // The exam lost (or never had) its editable draft between our read and
          // the request. Same posture as reading it up front: no room, no error.
          setStatus("disabled");
          setSnapshot(EMPTY_SNAPSHOT);
          setError(null);
          return;
        }
        if (cause instanceof CoeditUnavailableError) {
          setStatus("error");
          setError("Live collaboration is unavailable. The authoring service must be running.");
          return;
        }
        setStatus("error");
        setError(cause instanceof Error ? cause.message : "Live collaboration could not start.");
      }
    })();

    return () => {
      active = false;
      unsubscribe?.();
      if (providerRef.current === createdProvider) {
        createdProvider?.destroy();
        providerRef.current = null;
      } else {
        createdProvider?.destroy();
      }
    };
  }, [attempt, examId, hasEditableDraft, noEditableDraft]);

  const retry = useCallback(() => {
    const current = providerRef.current;
    if (current) {
      // A closed/replaced room cannot be reconnected: its document identity is
      // terminal and the server will reject the old token. Reopen the provider
      // so the token endpoint resolves the current draft's workspace instead.
      if (current.recovery.issue === "closed" || current.recovery.issue === "replaced") {
        current.destroy();
        providerRef.current = null;
        setStatus("preparing");
        setSnapshot(EMPTY_SNAPSHOT);
        setError(null);
        setAttempt((value) => value + 1);
        return;
      }
      current.retry();
      return;
    }
    setAttempt((value) => value + 1);
  }, []);
  const setValue = useCallback((path: string, value: unknown) => {
    const current = providerRef.current;
    if (current && !current.session.readOnly && current.session.lifecyclePhase === "active") current.setValue(path, value);
  }, []);
  const setValues = useCallback((values: Record<string, unknown>) => {
    const current = providerRef.current;
    if (current && !current.session.readOnly && current.session.lifecyclePhase === "active") current.setValues(values);
  }, []);
  const seedValue = useCallback(
    (path: string, value: unknown, sourceQuestionRevision?: number) =>
      providerRef.current?.seedValue(path, value, sourceQuestionRevision) ?? false,
    [],
  );
  const seedRichField = useCallback(
    (path: string, content: StructuredContent, sourceQuestionRevision?: number) =>
      providerRef.current?.seedRichField(path, content, sourceQuestionRevision) ?? false,
    [],
  );
  const setRichField = useCallback((path: string, content: StructuredContent) => {
    const current = providerRef.current;
    if (current && !current.session.readOnly && current.session.lifecyclePhase === "active") {
      current.setRichField(path, content);
    }
  }, []);
  const publishCommand = useCallback(
    (command: SatWorkspaceCommandName, payload: Record<string, unknown>) => {
      const current = providerRef.current;
      if (!current || current.session.readOnly || current.session.lifecyclePhase !== "active") return false;
      return current.publishCommand(command, payload, current.session.lastAckedRevision);
    },
    [],
  );
  const fieldBinding = useCallback((path: string) => providerRef.current?.fieldBinding(path) ?? null, []);
  const flushAndWaitForSaved = useCallback(
    (timeoutMs: number): Promise<CoeditFlushResult> => {
      const current = providerRef.current;
      // No provider means there is no room to flush, and no work that could be
      // waiting on one: report the only honest state rather than a timeout.
      if (!current) {
        return Promise.resolve({ outcome: "saved", saved: true, stateVector: null });
      }
      return current.flushAndWaitForSaved(timeoutMs);
    },
    [],
  );
  const setPresence = useCallback((target: { surface: "builder" | "release" | "access"; questionId?: string; fieldPath?: string }) => providerRef.current?.setPresence(target), []);
  const reportReplaced = useCallback(() => providerRef.current?.reportReplaced(), []);

  const value = useMemo<SatAuthoringCollaborationValue>(() => ({
    examId,
    enabled: !noEditableDraft,
    status,
    error,
    workspaceSnapshot: snapshot,
    connectionPhase: snapshot.connectionPhase,
    lifecyclePhase: snapshot.lifecyclePhase,
    ...(snapshot.pendingSince === undefined ? {} : { pendingSince: snapshot.pendingSince }),
    ...(snapshot.lastAckedRevision === undefined ? {} : { lastAckedRevision: snapshot.lastAckedRevision }),
    participants: snapshot.participants,
    retry,
    setValue,
    setValues,
    seedValue,
    seedRichField,
    setRichField,
    publishCommand,
    fieldBinding,
    flushAndWaitForSaved,
    setPresence,
    recovery: providerRef.current?.recovery ?? null,
    reportReplaced,
  }), [error, examId, fieldBinding, flushAndWaitForSaved, noEditableDraft, publishCommand, reportReplaced, retry, seedRichField, seedValue, setPresence, setRichField, setValue, setValues, snapshot, status]);

  return <SatAuthoringCollaborationContext.Provider value={value}>{children}</SatAuthoringCollaborationContext.Provider>;
}

export function useSatAuthoringCollaboration(): SatAuthoringCollaborationValue | null {
  return useContext(SatAuthoringCollaborationContext);
}

export function useRequiredSatAuthoringCollaboration(): SatAuthoringCollaborationValue {
  const value = useSatAuthoringCollaboration();
  if (!value) throw new Error("useRequiredSatAuthoringCollaboration must be used inside the SAT collaboration provider");
  return value;
}
