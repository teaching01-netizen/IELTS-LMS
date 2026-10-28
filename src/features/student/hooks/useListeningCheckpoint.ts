import { useEffect, useState, type RefObject } from "react";
import {
  audioCheckpointGateway,
  type ListeningCheckpointAuthorization,
} from "../infrastructure/audioCheckpointGateway";

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
    const load = () =>
      void audioCheckpointGateway
        .read(auth, partId)
        .then(attach)
        .catch(() => {
          if (cancelled) return;
          setError("ไม่พบตำแหน่งเสียงที่บันทึกไว้ กรุณาแจ้งเจ้าหน้าที่หากต้องย้ายเครื่อง");
          retryTimer = window.setTimeout(load, retryDelay);
          retryDelay = Math.min(retryDelay * 2, READ_RETRY_MAX_MS);
        });
    const attach = (initial: Awaited<ReturnType<typeof audioCheckpointGateway.read>>) => {
      if (cancelled) return;
      setError(null);
      let view = initial;
      let sequence = initial.checkpoint?.clientSequence ?? 0;
      let restored = false;
      let saving = false;
      let queued: number | null = null;
      const restore = () => {
        if (restored || !Number.isFinite(audio.duration) || audio.duration <= 0) return;
        restored = true;
        if (initial.checkpoint)
          audio.currentTime = Math.min(
            audio.duration,
            Math.max(0, initial.checkpoint.positionMs / 1000)
          );
      };
      const send = async (position: number) => {
        if (saving) {
          queued = position;
          return;
        }
        saving = true;
        try {
          view = await audioCheckpointGateway.save(auth, view, position, ++sequence);
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
