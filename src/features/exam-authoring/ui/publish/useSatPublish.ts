import { useState } from "react";
import type { ExamEntity } from "../../../../types/domain";
import {
  useAssessmentReleaseReadiness,
  useAssessmentReleaseState,
  usePublishAssessment,
} from "../../api/assessmentQueries";
import { useAccessDistributionOverview } from "../../api/assessmentAccessLinkQueries";
import { useAuthoringShellLifecycle } from "../../application/authoringShellLifecycle";
import type { SatPublishScope } from "../../contracts/assessment";
import { useSatAuthoringCollaboration } from "../../realtime/coedit";
import {
  COEDIT_MUTATION_FLUSH_TIMEOUT_MS,
  coeditRoomBlockMessage,
  coeditRoomHoldsUnconfirmedWork,
} from "../collaboration/coeditNavigationGate";
import { isSATPublishReadinessValid, publishMediaIssueDiagnostic } from "../release/releaseSelectors";
import type { DeliveryTarget } from "../shell/examLifecycle";

/**
 * The ONE owner of publishing an SAT exam: committed-draft reads, readiness
 * freshness, collaboration flush, and the retry-safe publish call. Both the
 * full release page and the in-workspace publish sheet consume it, so the
 * safeguards cannot drift apart.
 */
export function useSatPublish(exam: ExamEntity, onExamRefresh: () => Promise<unknown>) {
  const shellLifecycle = useAuthoringShellLifecycle(exam.id);
  const [publishScope, setPublishScope] = useState<SatPublishScope>("full");
  const publishMutation = usePublishAssessment(exam.id);
  // The room is the source of truth while it is open, and the release surfaces
  // read the committed MySQL projection. Publish is the same boundary a route
  // change is, so it uses the same acknowledgement mechanism.
  const collaboration = useSatAuthoringCollaboration();
  const roomPending = Boolean(
    collaboration && coeditRoomHoldsUnconfirmedWork(collaboration.workspaceSnapshot)
  );
  const releaseQuery = useAssessmentReleaseState(exam.id);
  const distributionQuery = useAccessDistributionOverview(exam.id);
  const shellState = shellLifecycle.state;
  // Publish needs READY. Every other lifecycle state is reported through
  // loadError instead of being passed off as a missing draft.
  const shell = shellState.kind === "ready" ? shellState.shell : null;
  const shellLoadError =
    shellState.kind === "error"
      ? shellState.error.message
      : shellState.kind === "exam-not-found"
        ? "This exam does not exist."
        : shellState.kind === "forbidden"
          ? "You do not have permission to view this exam."
          : null;
  const releaseState = releaseQuery.data ?? null;
  const shouldCheckReadiness = releaseState?.state !== "published_current";
  const readinessQuery = useAssessmentReleaseReadiness(
    exam.id,
    shell?.versionId,
    shell?.versionRevision,
    publishScope,
    shouldCheckReadiness
  );

  const publish = async (scope: SatPublishScope, publishNotes?: string): Promise<DeliveryTarget> => {
    if (!shell) throw new Error("The SAT draft is not loaded.");
    // Before anything else: prove this tab's room content is durable. Publish
    // seals whatever MySQL holds, so an unconfirmed prompt/image edit must be
    // flushed and acknowledged first — the same `flushAndWaitForSaved` the
    // builder awaits before leaving, not a sleep and not a second writer.
    if (collaboration && coeditRoomHoldsUnconfirmedWork(collaboration.workspaceSnapshot)) {
      const flushed = await collaboration.flushAndWaitForSaved(COEDIT_MUTATION_FLUSH_TIMEOUT_MS);
      // Read the snapshot AFTER the wait: a refusal or a fresh acknowledgement
      // both arrive while it is pending.
      const block = coeditRoomBlockMessage(collaboration.workspaceSnapshot, flushed.outcome);
      if (block !== null) throw new Error(block);
    }
    // Publish must act on what the server has committed, not on the revision
    // this page last rendered. An image replacement saved a moment ago would
    // otherwise be checked against — and sent with — the previous revision,
    // which is exactly how the old (missing) asset ID reaches the media gate.
    // Awaiting the read is the existing acknowledgement path: it creates no
    // state, it just waits for the committed draft to be visible here.
    const committed = await shellLifecycle.refresh();
    if (committed.kind !== "ready") {
      throw new Error(
        "The latest saved draft could not be read. Refresh the release page before publishing."
      );
    }
    const committedShell = committed.shell;
    if (typeof exam.revision !== "number" || !Number.isInteger(exam.revision)) {
      throw new Error(
        "The latest exam revision is unavailable. Refresh the release page before publishing."
      );
    }
    const readiness = readinessQuery.data;
    if (!readiness || !isSATPublishReadinessValid(readiness, true, scope)) {
      throw new Error("Run publish checks and resolve all blocking issues first.");
    }
    if (
      readiness.versionId !== committedShell.versionId ||
      readiness.versionRevision !== committedShell.versionRevision ||
      readiness.publishScope !== scope
    ) {
      await readinessQuery.refetch();
      throw new Error("The SAT draft changed. Publish checks were refreshed; review them again.");
    }

    const trimmedNotes = (publishNotes ?? "").trim();
    // One key per publish confirmation: a double-click or lost response
    // replays the same release instead of sealing a second version.
    const { publishedVersion } = await publishMutation.mutateAsync({
      revision: exam.revision,
      expectedDraftVersionId: committedShell.versionId,
      expectedDraftRevision: committedShell.versionRevision,
      publishScope: scope,
      ...(trimmedNotes ? { publishNotes: trimmedNotes.slice(0, 1000) } : {}),
      operationKey: crypto.randomUUID(),
    });
    // Refetch failures must never block the caller: the publish already
    // succeeded, so settle every refresh independently and continue.
    const settled = await Promise.allSettled([
      onExamRefresh(),
      releaseQuery.refetch(),
      distributionQuery.refetch(),
    ]);
    for (const result of settled) {
      if (result.status === "rejected") {
        console.error("[sat-release] post-publish refresh failed", result.reason);
      }
    }
    return { versionId: publishedVersion.id, versionNumber: publishedVersion.versionNumber, publishScope: scope };
  };

  const publishError = publishMutation.error
    ? (publishMediaIssueDiagnostic(publishMutation.error)?.message ??
      (publishMutation.error instanceof Error ? publishMutation.error.message : null))
    : null;

  return {
    shellLifecycle,
    shellState,
    shell,
    shellLoadError,
    releaseQuery,
    releaseState,
    distributionQuery,
    readinessQuery,
    publishScope,
    setPublishScope,
    isPublishing: publishMutation.isPending,
    publishError,
    /** A draft read is in flight or this tab holds room changes not yet confirmed. */
    draftBusy: shellState.kind === "loading" || shellLifecycle.isFetching || roomPending,
    publish,
  };
}
