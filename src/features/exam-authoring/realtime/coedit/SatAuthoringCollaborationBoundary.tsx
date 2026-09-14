import { useContext, useEffect, useRef, type ReactNode } from "react";
import { QueryClientContext } from "@tanstack/react-query";
import { assessmentKeys } from "../../api/assessmentQueries";
import { accessLinkKeys } from "../../api/assessmentAccessLinkQueries";
import { CollaborationLiveRegion } from "../../ui/collaboration/CollaborationLiveRegion";
import { coeditDisplayStatusFor } from "../../ui/spine/coeditSaveTruth";
import type { SatWorkspaceCommand } from "./workspaceCommands";
import {
  SatAuthoringCollaborationProvider,
  useSatAuthoringCollaboration,
} from "./useSatAuthoringCollaboration";

/**
 * The single exam-level collaboration boundary for every SAT authoring route.
 * Keeping the provider and the room-wide query invalidation together prevents
 * one route family from silently falling back to a local-only editor.
 */
export function SatAuthoringCollaborationBoundary({
  examId,
  children,
}: {
  examId: string;
  children: ReactNode;
}) {
  return (
    <SatAuthoringCollaborationProvider examId={examId}>
      <SatAuthoringCollaborationOutlet>{children}</SatAuthoringCollaborationOutlet>
    </SatAuthoringCollaborationProvider>
  );
}

function SatAuthoringCollaborationOutlet({ children }: { children: ReactNode }) {
  const collaboration = useSatAuthoringCollaboration();
  const queryClient = useContext(QueryClientContext);
  const seenCommandsRef = useRef<{ examId: string | null; ids: Set<string> }>({
    examId: null,
    ids: new Set(),
  });
  const seenAckRef = useRef<{ examId: string | null; revision: string | null }>({
    examId: null,
    revision: null,
  });
  useEffect(() => {
    if (!collaboration || !queryClient) return;
    if (seenCommandsRef.current.examId !== collaboration.examId) {
      seenCommandsRef.current = { examId: collaboration.examId, ids: new Set() };
    }
    const commands = collaboration.workspaceSnapshot.commands;
    for (const command of commands) {
      if (seenCommandsRef.current.ids.has(command.commandId)) continue;
      seenCommandsRef.current.ids.add(command.commandId);
      invalidateForWorkspaceCommand(queryClient, collaboration.examId, command);
    }
  }, [collaboration, collaboration?.workspaceSnapshot.commands, queryClient]);

  // Rich/scalar edits have no structural command to relay. Once the service
  // acknowledges a committed workspace revision, refresh the HTTP projections
  // used by sidebars, readiness, release, and Student Access. The editors still
  // render directly from Yjs, so this is a quiet projection refresh rather
  // than a reload or a source of caret/content flicker.
  const ackRevision = collaboration?.lastAckedRevision ?? null;
  useEffect(() => {
    if (!collaboration || !queryClient || !ackRevision) return;
    if (
      seenAckRef.current.examId === collaboration.examId &&
      seenAckRef.current.revision === ackRevision
    ) {
      return;
    }
    seenAckRef.current = { examId: collaboration.examId, revision: ackRevision };
    invalidateForWorkspaceAcknowledgement(
      queryClient,
      collaboration.examId,
      collaboration.workspaceSnapshot.values,
    );
  }, [ackRevision, collaboration, queryClient]);

  const snapshot = collaboration?.workspaceSnapshot;
  const saveStatus = snapshot
    ? collaboration?.status === "error" && snapshot.lifecyclePhase === "active" && !snapshot.readOnly
      ? "error"
      : collaboration?.status === "preparing"
        ? "saving"
        : coeditDisplayStatusFor({
            saveState: snapshot.saveState,
            connectionPhase: snapshot.connectionPhase,
            hasEstablishedConnection: snapshot.hasEstablishedConnection,
            lifecyclePhase: snapshot.lifecyclePhase,
            readOnly: snapshot.readOnly,
            pendingSince: collaboration.pendingSince ?? null,
          })
    : null;

  return (
    <>
      <CollaborationLiveRegion
        enabled={Boolean(collaboration)}
        participants={collaboration?.participants ?? []}
        connectionPhase={collaboration?.connectionPhase}
        hasEstablishedConnection={snapshot?.hasEstablishedConnection}
        lifecyclePhase={collaboration?.lifecyclePhase}
        saveStatus={saveStatus}
        recoveryIssue={snapshot?.published ? null : snapshot?.issue ?? null}
      />
      {children}
    </>
  );
}

export function invalidateForWorkspaceAcknowledgement(
  queryClient: {
    invalidateQueries: (options: { queryKey: readonly unknown[] }) => Promise<unknown> | unknown;
  },
  examId: string,
  values: Record<string, unknown>,
): void {
  const questionIds = new Set<string>();
  let hasDelivery = false;
  let hasAccess = false;
  for (const path of Object.keys(values)) {
    const questionPath = path.startsWith("rich:question/")
      ? path.slice("rich:".length)
      : path;
    if (questionPath.startsWith("question/")) {
      const questionId = questionPath.split("/")[1];
      if (questionId) questionIds.add(questionId);
    } else if (path.startsWith("delivery/")) {
      hasDelivery = true;
    } else if (path.startsWith("access/")) {
      hasAccess = true;
    }
  }
  for (const questionId of questionIds) {
    void queryClient.invalidateQueries({ queryKey: assessmentKeys.question(questionId) });
  }
  if (questionIds.size > 0 || hasDelivery) {
    void queryClient.invalidateQueries({ queryKey: assessmentKeys.shell(examId) });
    void queryClient.invalidateQueries({ queryKey: assessmentKeys.readinessRoot(examId) });
    void queryClient.invalidateQueries({ queryKey: assessmentKeys.release(examId) });
  }
  if (hasAccess) {
    void queryClient.invalidateQueries({ queryKey: accessLinkKeys.overview(examId) });
    void queryClient.invalidateQueries({ queryKey: assessmentKeys.release(examId) });
  }
}

export function invalidateForWorkspaceCommand(
  queryClient: {
    invalidateQueries: (options: { queryKey: readonly unknown[] }) => Promise<unknown> | unknown;
  },
  examId: string,
  command: SatWorkspaceCommand,
): void {
  const payload = command.payload;
  const questionIds = new Set<string>();
  if (typeof payload["questionId"] === "string") questionIds.add(payload["questionId"]);
  if (Array.isArray(payload["questionIds"])) {
    for (const value of payload["questionIds"]) {
      if (typeof value === "string" && value.trim()) questionIds.add(value);
    }
  }
  const linkId = typeof payload["linkId"] === "string" ? payload["linkId"] : null;

  switch (command.command) {
    case "question.created":
    case "question.duplicated":
    case "question.deleted":
    case "question.reordered":
    case "question.bulk_changed":
    case "workbook.imported":
    case "workbook.undone":
    case "sample.loaded":
      for (const id of questionIds) {
        void queryClient.invalidateQueries({ queryKey: assessmentKeys.question(id) });
      }
      void queryClient.invalidateQueries({ queryKey: assessmentKeys.shell(examId) });
      void queryClient.invalidateQueries({ queryKey: assessmentKeys.readinessRoot(examId) });
      void queryClient.invalidateQueries({ queryKey: assessmentKeys.release(examId) });
      return;
    case "delivery.changed":
      void queryClient.invalidateQueries({ queryKey: assessmentKeys.shell(examId) });
      void queryClient.invalidateQueries({ queryKey: assessmentKeys.readinessRoot(examId) });
      void queryClient.invalidateQueries({ queryKey: assessmentKeys.release(examId) });
      return;
    case "access.created":
    case "access.updated":
    case "access.lifecycle_changed":
    case "access.duplicated":
      void queryClient.invalidateQueries({ queryKey: accessLinkKeys.overview(examId) });
      void queryClient.invalidateQueries({ queryKey: assessmentKeys.release(examId) });
      if (linkId) {
        void queryClient.invalidateQueries({ queryKey: accessLinkKeys.link(linkId) });
        void queryClient.invalidateQueries({ queryKey: accessLinkKeys.members(linkId) });
      }
      return;
    case "exam.published":
      void queryClient.invalidateQueries({ queryKey: assessmentKeys.shell(examId) });
      void queryClient.invalidateQueries({ queryKey: assessmentKeys.readinessRoot(examId) });
      void queryClient.invalidateQueries({ queryKey: assessmentKeys.release(examId) });
      void queryClient.invalidateQueries({ queryKey: accessLinkKeys.overview(examId) });
      return;
  }
}
