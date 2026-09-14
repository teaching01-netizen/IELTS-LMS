import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { StructuredContent } from "../../contracts/assessment";
import type { CoeditLifecycleIssue } from "./contracts";
import { CoeditUnavailableError, requestWorkspaceCoeditToken } from "./tokenApi";
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
  ensureValue: (path: string, value: unknown) => void;
  ensureRichField: (path: string, content: StructuredContent) => void;
  setRichField: (path: string, content: StructuredContent) => void;
  publishCommand: (
    command: SatWorkspaceCommandName,
    payload: Record<string, unknown>,
  ) => boolean;
  fieldBinding: (path: string) => WorkspaceFieldBinding | null;
  setPresence: (target: { surface: "builder" | "release" | "access"; questionId?: string; fieldPath?: string }) => void;
  recovery: WorkspaceRecovery | null;
  reportReplaced: () => void;
}

const EMPTY_SNAPSHOT: WorkspaceCoeditSnapshot = {
  ready: false,
  connectionPhase: "connecting",
  hasEstablishedConnection: false,
  lifecyclePhase: "active",
  readOnly: true,
  saveState: {
    name: "idle",
    localStateHash: null,
    acknowledgedStateHash: null,
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
  const [status, setStatus] = useState<WorkspaceCoeditingStatus>("preparing");
  const [snapshot, setSnapshot] = useState<WorkspaceCoeditSnapshot>(EMPTY_SNAPSHOT);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const providerRef = useRef<SatAuthoringWorkspaceProvider | null>(null);

  useEffect(() => {
    let active = true;
    let createdProvider: SatAuthoringWorkspaceProvider | null = null;
    let unsubscribe: (() => void) | null = null;
    setStatus("preparing");
    setSnapshot(EMPTY_SNAPSHOT);
    setError(null);
    providerRef.current = null;

    void (async () => {
      try {
        const token = await requestWorkspaceCoeditToken(examId);
        if (!active) return;
        const provider = new SatAuthoringWorkspaceProvider({
          documentName: token.documentName,
          serviceUrl: token.serviceUrl,
          token: { token: token.token, expiresAt: token.expiresAt },
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
  }, [attempt, examId]);

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
  const ensureValue = useCallback((path: string, value: unknown) => providerRef.current?.ensureValue(path, value), []);
  const ensureRichField = useCallback((path: string, content: StructuredContent) => providerRef.current?.ensureRichField(path, content), []);
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
  const setPresence = useCallback((target: { surface: "builder" | "release" | "access"; questionId?: string; fieldPath?: string }) => providerRef.current?.setPresence(target), []);
  const reportReplaced = useCallback(() => providerRef.current?.reportReplaced(), []);

  const value = useMemo<SatAuthoringCollaborationValue>(() => ({
    examId,
    enabled: true,
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
    ensureValue,
    ensureRichField,
    setRichField,
    publishCommand,
    fieldBinding,
    setPresence,
    recovery: providerRef.current?.recovery ?? null,
    reportReplaced,
  }), [ensureRichField, ensureValue, error, examId, fieldBinding, publishCommand, reportReplaced, retry, setPresence, setRichField, setValue, setValues, snapshot, status]);

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
