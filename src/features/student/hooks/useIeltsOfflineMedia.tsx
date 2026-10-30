import { createContext, useContext, useEffect, useState, type ReactNode, type RefObject } from 'react';
import type { IeltsOfflineMediaRecord } from '../infrastructure/ieltsOfflinePackageStore';
import { readIeltsOfflineMedia } from '../infrastructure/ieltsOfflineMediaCache';

interface IeltsOfflineMediaValue {
  attemptId: string;
  records: IeltsOfflineMediaRecord[];
}

const IeltsOfflineMediaContext = createContext<IeltsOfflineMediaValue | null>(null);

export function IeltsOfflineMediaProvider({ value, children }: { value: IeltsOfflineMediaValue | null; children: ReactNode }) {
  return <IeltsOfflineMediaContext.Provider value={value}>{children}</IeltsOfflineMediaContext.Provider>;
}

/**
 * Listening audio source for a prepared device: verified cached bytes for the
 * exact part + URL (bound to its media revision). The source never changes
 * mid-playback; a playing element switches only if its network source fails.
 * Caching grants no replay, seek or time rights: playback policy is unchanged.
 */
export function useIeltsOfflineAudioSource(
  audioRef: RefObject<HTMLAudioElement | null>,
  partId: string | undefined,
  url: string | undefined,
): string | undefined {
  const media = useContext(IeltsOfflineMediaContext);
  const record = media?.records.find((r) => r.kind === 'audio' && r.partId === partId && r.url === url) ?? null;
  const [cached, setCached] = useState<string | null>(null);
  const [useCached, setUseCached] = useState(false);
  const attemptId = media?.attemptId;
  const resourceId = record?.resourceId;

  useEffect(() => {
    setCached(null);
    setUseCached(false);
    if (!attemptId || !record) return undefined;
    let objectUrl: string | null = null;
    let cancelled = false;
    void readIeltsOfflineMedia(attemptId, record).then((blob) => {
      if (cancelled || !blob) return;
      objectUrl = URL.createObjectURL(blob);
      setCached(objectUrl);
      const audio = audioRef.current;
      if (!audio || audio.paused) setUseCached(true);
    });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
    // The record identity is its resource id.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attemptId, resourceId, audioRef]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !cached || useCached) return undefined;
    const onError = () => setUseCached(true);
    audio.addEventListener('error', onError);
    return () => audio.removeEventListener('error', onError);
  }, [audioRef, cached, useCached]);

  return useCached && cached ? cached : url;
}
