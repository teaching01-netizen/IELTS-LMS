import { useEffect, useState } from "react";
import { useSatAuthoringCollaboration } from "../../realtime/coedit";
import { coeditDisplayStatusFor } from "../spine/coeditSaveTruth";
import { SaveCluster } from "../spine/SaveCluster";
import { CollaboratorStack } from "./CollaboratorStack";

export interface CollaborationHeaderClusterProps {
  surface: "builder" | "release" | "access";
  selectedQuestionId?: string | null;
}

/**
 * The one reusable collaboration surface for an active SAT authoring page.
 * Route-level state owns the room; page headers only decide where to place the
 * two slots. Keeping this component slot-shaped prevents a second save truth
 * from appearing in a footer or global header.
 */
export function CollaborationHeaderCluster({
  surface,
  selectedQuestionId = null,
}: CollaborationHeaderClusterProps) {
  const collaboration = useSatAuthoringCollaboration();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    collaboration?.setPresence({
      surface,
      ...(selectedQuestionId ? { questionId: selectedQuestionId } : {}),
    });
  }, [collaboration, selectedQuestionId, surface]);

  useEffect(() => {
    if (collaboration?.pendingSince === undefined) return undefined;
    setNow(Date.now());
    const timer = globalThis.setInterval(() => setNow(Date.now()), 250);
    return () => globalThis.clearInterval(timer);
  }, [collaboration?.pendingSince]);

  if (!collaboration) return null;
  // No room: an exam with no editable draft has nothing to co-edit, so the
  // header must not report a room's save truth. Whatever the page saves (the
  // HTTP editors behind it) owns its own status.
  if (collaboration.status === "disabled") return null;

  const snapshot = collaboration.workspaceSnapshot;
  const status =
    collaboration.status === "error" && snapshot.lifecyclePhase === "active" && !snapshot.readOnly
      ? "error"
      : collaboration.status === "preparing"
        ? "saving"
        : coeditDisplayStatusFor({
            saveState: snapshot.saveState,
            connectionPhase: snapshot.connectionPhase,
            hasEstablishedConnection: snapshot.hasEstablishedConnection,
            lifecyclePhase: snapshot.lifecyclePhase,
            readOnly: snapshot.readOnly,
            pendingSince: collaboration.pendingSince ?? null,
            now,
          });

  return (
    <span className="inline-flex min-w-0 items-center gap-2" data-testid="collaboration-header-cluster">
      <CollaboratorStack participants={collaboration.participants} />
      <SaveCluster
        displayMode="coedit"
        status={status}
        lastSavedAt={null}
        announce={false}
        onRetry={status === "error" ? collaboration.retry : undefined}
      />
    </span>
  );
}

