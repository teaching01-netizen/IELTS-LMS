import { useEffect, useState, type RefObject } from "react";
import {
  audioCheckpointGateway,
  type AudioCheckpointView,
  type ListeningCheckpointAuthorization,
} from "../infrastructure/audioCheckpointGateway";
import { loadDurableDraft, saveDurableDraft } from "../../../utils/durableDraftStore";

/**
 * Last position this device recorded for a part, bound to the server-issued
 * identity it was recorded under. It resumes playback while offline and is
 * reconciled on reconnect only when that identity still matches.
 */
interface LocalAudioCheckpoint {
  view: AudioCheckpointView;
  positionMs: number;
  sequence: number;
}

const localCheckpointKey = (attemptId: string, partId: string) => `ielts-audio-checkpoint:${attemptId}:${partId}`;

function sameIdentity(a: AudioCheckpointView, b: AudioCheckpointView): boolean {
  return a.partId === b.partId && a.mediaRevision === b.mediaRevision && a.leaseEpoch === b.leaseEpoch && a.runGeneration === b.runGeneration;
}

const READ_RETRY_MS = 2_000;
const READ_RETRY_MAX_MS = 30_000;

// The server chooses the pinned media revision. Signed playback URLs and
// optimistic local position never become checkpoint identities or authority.
export function useListeningCheckpoint(
  audioRef: RefObject<HTMLAudioElement | null>,
  identity: ListeningCheckpointAuthorization | undefined,
  partId: string | undefined,
  source: string | undefined,
  enabled: boolean
) {
  const [error, setError] = useState<string | null>(null);
  const scheduleId = identity?.scheduleId;
  const attemptId = identity?.attemptId;
  useEffect(() => {
    setError(null);
    if (!enabled || !scheduleId || !attemptId || !partId || !source) return;
    const audio = audioRef.current;
    if (!audio) return;
    const auth = { scheduleId, attemptId };
    let cancelled = false;
    let detach = () => {};
    let retryTimer: number | undefined;
    let retryDelay = READ_RETRY_MS;
    // A transient failure must not disable checkpointing for the whole part;
    // without a saved position a later device move cannot resume the audio.
    const localKey = localCheckpointKey(attemptId, partId);
    let attachedOffline = false;
    const load = () =>
      void audioCheckpointGateway
        .read(auth, partId)
        .then(async (server) => {
          const local = await loadDurableDraft<LocalAudioCheckpoint>(localKey).catch(() => null);
          if (cancelled) return;
          if (attachedOffline) {
            // Reconnected while playing from the local checkpoint: keep the
            // element as is and only reconcile the saved position.
            detach();
          }
          // A newer same-identity local position (recorded offline) wins once;
          // a different lease/run/revision never carries over (INV-3).
          const carry = local && sameIdentity(local.view, server) && local.sequence > (server.checkpoint?.clientSequence ?? 0) ? local : null;
          attach(server, carry);
        }, () => {
          if (cancelled) return;
          setError("ไม่พบตำแหน่งเสียงที่บันทึกไว้ กรุณาแจ้งเจ้าหน้าที่หากต้องย้ายเครื่อง");
          retryTimer = window.setTimeout(load, retryDelay);
          retryDelay = Math.min(retryDelay * 2, READ_RETRY_MAX_MS);
          if (attachedOffline) return;
          // Offline: resume from this device's last recorded position.
          void loadDurableDraft<LocalAudioCheckpoint>(localKey)
            .catch(() => null)
            .then((local) => {
              if (cancelled || attachedOffline || !local || local.view.partId !== partId) return;
              attachedOffline = true;
              attach(local.view, local);
              setError("ไม่พบตำแหน่งเสียงที่บันทึกไว้ กรุณาแจ้งเจ้าหน้าที่หากต้องย้ายเครื่อง");
            });
        });
    const attach = (initial: AudioCheckpointView, carry: LocalAudioCheckpoint | null = null) => {
      if (cancelled) return;
      setError(null);
      let view = initial;
      let sequence = Math.max(initial.checkpoint?.clientSequence ?? 0, carry?.sequence ?? 0);
      const resumeMs = carry ? carry.positionMs : initial.checkpoint?.positionMs;
      let restored = false;
      let saving = false;
      let queued: number | null = null;
      const restore = () => {
        if (restored || !Number.isFinite(audio.duration) || audio.duration <= 0) return;
        restored = true;
        if (resumeMs !== undefined) audio.currentTime = Math.min(audio.duration, Math.max(0, resumeMs / 1000));
        // Reconcile an offline-recorded position once the server is reachable.
        if (carry && !attachedOffline) void send(carry.positionMs);
      };
      const send = async (position: number) => {
        if (saving) {
          queued = position;
          return;
        }
        saving = true;
        const nextSequence = ++sequence;
        // Durable locally first: an offline device keeps its place.
        await saveDurableDraft(localKey, { view, positionMs: position, sequence: nextSequence } satisfies LocalAudioCheckpoint).catch(() => undefined);
        try {
          view = await audioCheckpointGateway.save(auth, view, position, nextSequence);
          if (!cancelled) setError(null);
        } catch {
          if (!cancelled) setError("ตำแหน่งเสียงยังไม่บันทึก กำลังรอการเชื่อมต่อ");
        } finally {
          saving = false;
          if (!cancelled && queued !== null) {
            const next = queued;
            queued = null;
            void send(next);
          }
        }
      };
      const checkpoint = () => {
        if (restored && Number.isFinite(audio.currentTime))
          void send(Math.max(0, Math.round(audio.currentTime * 1000)));
      };
      audio.addEventListener("loadedmetadata", restore);
      audio.addEventListener("pause", checkpoint);
      audio.addEventListener("seeked", checkpoint);
      audio.addEventListener("ended", checkpoint);
      restore();
      const interval = window.setInterval(() => {
        if (!audio.paused && !audio.ended) checkpoint();
      }, 2000);
      detach = () => {
        checkpoint();
        window.clearInterval(interval);
        audio.removeEventListener("loadedmetadata", restore);
        audio.removeEventListener("pause", checkpoint);
        audio.removeEventListener("seeked", checkpoint);
        audio.removeEventListener("ended", checkpoint);
      };
    };
    load();
    return () => {
      cancelled = true;
      window.clearTimeout(retryTimer);
      detach();
    };
  }, [audioRef, scheduleId, attemptId, partId, source, enabled]);
  return error;
}
