import { useContext, useEffect, useRef, type ReactNode } from "react";
import { QueryClientContext } from "@tanstack/react-query";
import { authoringEffects } from "../../api/authoringQueryEffects";
import { CollaborationLiveRegion } from "../../ui/collaboration/CollaborationLiveRegion";
import { coeditDisplayStatusFor } from "../../ui/spine/coeditSaveTruth";
import {
  SatAuthoringCollaborationProvider,
  useSatAuthoringCollaboration,
} from "./useSatAuthoringCollaboration";

/**
 * The single exam-level collaboration boundary for every SAT authoring route.
 * Keeping the provider and the outlet together prevents one route family from
 * silently falling back to a local-only editor.
 *
 * This component owns TRANSPORT concerns only: provider lifetime, room
 * subscription, command/acknowledgement deduplication, and the collaboration
 * live region. It deliberately does not know the React Query dependency graph —
 * an event it receives is reported to `authoringEffects`, which owns the
 * question of which projections that event invalidates.
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
      // Deduplication is a transport concern: the same command must be relayed
      // once, however many times the room snapshot is re-delivered.
      if (seenCommandsRef.current.ids.has(command.commandId)) continue;
      seenCommandsRef.current.ids.add(command.commandId);
      void authoringEffects.applyWorkspaceCommand(queryClient, collaboration.examId, command);
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
    void authoringEffects.applyWorkspaceAcknowledgement(
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
