import { backendGet, backendPost } from "@services/backendBridge";
import { buildAttemptAuthorizationHeader } from "@services/attemptCredentialAdapter";
export interface ListeningCheckpointAuthorization {
  scheduleId: string;
  attemptId: string;
}
export interface AudioCheckpointView {
  sectionKey: string;
  partId: string;
  mediaRevision: string;
  leaseEpoch: number;
  runGeneration: number;
  checkpoint: { positionMs: number; clientSequence: number } | null;
}
const path = (identity: ListeningCheckpointAuthorization) =>
  `/v1/student/sessions/${encodeURIComponent(identity.scheduleId)}/audio-checkpoint`;
const options = (identity: ListeningCheckpointAuthorization) => ({
  retries: 0,
  headers: buildAttemptAuthorizationHeader({
    scheduleId: identity.scheduleId,
    id: identity.attemptId,
  }),
});
export const audioCheckpointGateway = {
  read: (identity: ListeningCheckpointAuthorization, partId: string) =>
    backendGet<AudioCheckpointView>(
      `${path(identity)}?partId=${encodeURIComponent(partId)}`,
      options(identity)
    ),
  save: (
    identity: ListeningCheckpointAuthorization,
    view: AudioCheckpointView,
    positionMs: number,
    sequence: number
  ) =>
    backendPost<AudioCheckpointView>(
      path(identity),
      {
        sectionKey: view.sectionKey,
        partId: view.partId,
        mediaRevision: view.mediaRevision,
        leaseEpoch: view.leaseEpoch,
        runGeneration: view.runGeneration,
        positionMs,
        sequence,
      },
      options(identity)
    ),
};
