import { useEffect, useRef, useState } from "react";
import type { CoeditConnectionPhase, CoeditLifecyclePhase, CoeditLifecycleIssue } from "../../realtime/coedit/contracts";
import type { CoeditSaveDisplayStatus } from "../../realtime/connectionCopy";
import type { CollaborationParticipant } from "./collaborationParticipants";

export interface CollaborationLiveRegionProps {
  enabled: boolean;
  participants: readonly CollaborationParticipant[];
  connectionPhase?: CoeditConnectionPhase | null | undefined;
  hasEstablishedConnection?: boolean | undefined;
  lifecyclePhase?: CoeditLifecyclePhase | null | undefined;
  saveStatus?: CoeditSaveDisplayStatus | null | undefined;
  recoveryIssue?: CoeditLifecycleIssue | null | undefined;
}

type Snapshot = {
  participantSignature: string;
  participantIds: string[];
  connectionPhase: CoeditConnectionPhase | null;
  lifecyclePhase: CoeditLifecyclePhase | null;
  saveStatus: CoeditSaveDisplayStatus | null;
  recoveryIssue: CoeditLifecycleIssue | null;
};

/** One quiet, deduplicated announcement surface for meaningful collaboration events. */
export function CollaborationLiveRegion({
  enabled,
  participants,
  connectionPhase = null,
  hasEstablishedConnection = false,
  lifecyclePhase = null,
  saveStatus = null,
  recoveryIssue = null,
}: CollaborationLiveRegionProps) {
  const [announcement, setAnnouncement] = useState("");
  const previous = useRef<Snapshot | null>(null);
  const lastAnnouncement = useRef("");

  useEffect(() => {
    if (!enabled) {
      previous.current = null;
      lastAnnouncement.current = "";
      setAnnouncement("");
      return;
    }

    const participantIds = participants.map((participant) => participant.id).sort();
    const next: Snapshot = {
      participantSignature: participants
        .map((participant) => `${participant.id}:${participant.displayName}`)
        .sort()
        .join("|"),
      participantIds,
      connectionPhase,
      lifecyclePhase,
      saveStatus: saveStatus ?? null,
      recoveryIssue: recoveryIssue ?? null,
    };
    const prior = previous.current;
    previous.current = next;
    if (!prior) return;

    let message: string | null = null;
    if (prior.recoveryIssue !== next.recoveryIssue && (next.recoveryIssue === "closed" || next.recoveryIssue === "replaced")) {
      message = "A newer version is active. Your unsaved changes are still available.";
    } else if (prior.lifecyclePhase !== next.lifecyclePhase && next.lifecyclePhase === "freezing") {
      message = "Finishing changes.";
    } else if (prior.lifecyclePhase !== next.lifecyclePhase && next.lifecyclePhase === "frozen") {
      message = "This draft is now view only.";
    } else if (prior.connectionPhase !== next.connectionPhase && next.connectionPhase === "disconnected") {
      message = "Offline. Changes are kept on this device.";
    } else if (prior.connectionPhase !== next.connectionPhase && next.connectionPhase === "connecting" && hasEstablishedConnection) {
      message = "Reconnecting.";
    } else if (prior.connectionPhase === "disconnected" && next.connectionPhase === "connected") {
      message = "Back online.";
    } else if (prior.saveStatus !== "error" && next.saveStatus === "error") {
      message = "Couldn’t save. Retry is available.";
    } else if (prior.participantSignature !== next.participantSignature) {
      const before = new Set(prior.participantIds);
      const joined = participants.find((participant) => !before.has(participant.id));
      if (joined) message = `${joined.displayName} joined editing.`;
      else message = "A collaborator left editing.";
    }

    if (message && message !== lastAnnouncement.current) {
      lastAnnouncement.current = message;
      setAnnouncement(message);
    }
  }, [connectionPhase, enabled, hasEstablishedConnection, lifecyclePhase, participants, recoveryIssue, saveStatus]);

  if (!enabled) return null;
  return (
    <div className="sr-only" role="status" aria-live="polite" aria-atomic="true" data-testid="collaboration-live-region">
      {announcement}
    </div>
  );
}
