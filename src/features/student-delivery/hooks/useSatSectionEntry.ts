import { useCallback, useEffect, useRef, useState } from "react";
import type {
  SectionEntryState,
  SittingSection,
} from "@/src/features/assessment-forms/api/assessmentForms";

type ReadSection = (
  scheduleId: string,
  attemptId: string,
  section: SittingSection
) => Promise<SectionEntryState>;

/** Only reads an unstarted module's form; errors hold entry closed for retry. */
export function useSatSectionEntry(
  scheduleId: string,
  attemptId: string,
  moduleId: string | null,
  section: SittingSection | null,
  read: ReadSection | undefined
) {
  const key = moduleId && section ? `${scheduleId}:${attemptId}:${moduleId}:${section}` : null;
  const [snapshot, setSnapshot] = useState<{ key: string; value: SectionEntryState } | null>(null);
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null);
  const currentKey = useRef(key);
  currentKey.current = key;
  const sequence = useRef(0);
  const refresh = useCallback(async () => {
    if (!read || !key || !section) return;
    const request = ++sequence.current;
    try {
      const value = await read(scheduleId, attemptId, section);
      if (currentKey.current !== key || request !== sequence.current) return;
      setSnapshot({ key, value });
      setFailure(null);
      return value;
    } catch (error) {
      if (currentKey.current !== key || request !== sequence.current) return;
      setFailure({
        key,
        message: error instanceof Error ? error.message : "The section form could not load.",
      });
    }
    return undefined;
  }, [read, key, section, scheduleId, attemptId]);
  useEffect(() => {
    if (!key || !read) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      const value = await refresh();
      // Legacy/empty forms and observed closure never need further polling.
      // Schedule after completion so a slow read cannot overlap or starve entry.
      if (!cancelled && value?.state !== "not_applicable" && value?.state !== "closed") {
        timer = setTimeout(() => void poll(), 5_000 + Math.floor(Math.random() * 1_000));
      }
    };
    void poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
      // This numeric request counter invalidates pending reads; it is not a DOM ref.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      ++sequence.current;
    };
  }, [refresh, key, read]);
  const value = snapshot?.key === key ? snapshot.value : null;
  const error = failure?.key === key ? failure.message : null;
  return {
    state: value,
    error,
    loading: Boolean(read && key && !value && !error),
    // Legacy gateway adapters do not implement forms. The HTTP adapter always does.
    ready:
      !read ||
      !key ||
      (!error && (value?.state === "not_applicable" || value?.state === "submitted")),
    refresh,
  };
}
