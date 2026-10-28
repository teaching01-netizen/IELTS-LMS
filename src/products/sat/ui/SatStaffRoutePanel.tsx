import { useCallback, useEffect, useRef, useState } from 'react';
import { assignModuleRoute, fetchRouteQueue } from '../../../features/proctor/api/proctorRoomApi';
import { SatButton } from './SatPage';

interface Waiting { attemptId: string; studentName: string; sectionKey: string; rawCorrect: number | null; total: number | null }
interface Queue { enabled: boolean; items: Waiting[] }

export interface SatStaffRouteAssignment {
  attemptId: string;
  sectionKey: string;
}

const POLL_MS = 5000;

/**
 * Classroom staff_selects: students whose Module 1 is closed wait here for the
 * teacher's Easy/Hard choice. Renders only while someone is waiting or the
 * queue cannot load, and nothing for any other session policy.
 */
export function SatStaffRoutePanel({ scheduleId, blocked, onPendingAssignmentsChange }: {
  scheduleId: string;
  blocked: boolean;
  onPendingAssignmentsChange?: (assignments: readonly SatStaffRouteAssignment[]) => void;
}) {
  const [queue, setQueue] = useState<Queue | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const identity = useRef(scheduleId);
  identity.current = scheduleId;
  const load = useCallback(async () => {
    try {
      // This panel owns the retry loop; stacking transport backoff here can
      // keep the room in a loading state longer than the next poll interval.
      const next = await fetchRouteQueue<Queue>(scheduleId);
      if (identity.current !== scheduleId) return;
      setQueue(next);
      setLoadError(null);
      onPendingAssignmentsChange?.(next.enabled
        ? next.items.map(({ attemptId, sectionKey }) => ({ attemptId, sectionKey }))
        : []);
    } catch {
      if (identity.current === scheduleId) setLoadError('Module 2 assignments could not load.');
    } finally {
      if (identity.current === scheduleId) setLoading(false);
    }
  }, [onPendingAssignmentsChange, scheduleId]);
  useEffect(() => {
    setQueue(null);
    setLoading(true);
    setLoadError(null);
    setError(null);
    setStatus(null);
    onPendingAssignmentsChange?.([]);
  }, [onPendingAssignmentsChange, scheduleId]);
  useEffect(() => {
    if (!status) return;
    const timer = window.setTimeout(() => setStatus(null), 4000);
    return () => window.clearTimeout(timer);
  }, [status]);
  // Polls until the server reports the queue disabled. A failed fetch does not
  // stop the interval, so the list recovers on its own once the server does.
  const disabled = queue !== null && !queue.enabled;
  useEffect(() => {
    if (disabled) return;
    void load();
    const timer = window.setInterval(() => void load(), POLL_MS);
    return () => window.clearInterval(timer);
  }, [disabled, load]);
  const assign = async (item: Waiting, route: 'lower' | 'higher') => {
    const key = `${item.attemptId}:${item.sectionKey}`;
    if (busyKey || blocked) return;
    setBusyKey(`${key}:${route}`);
    setError(null);
    setStatus(null);
    try {
      await assignModuleRoute(scheduleId, item.attemptId, item.sectionKey, route);
      if (identity.current === scheduleId) setStatus(`Module 2 choice saved for ${item.studentName}.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Module 2 could not be assigned.');
    } finally {
      setBusyKey(null);
      void load();
    }
  };
  if (disabled) return null;
  const items = queue?.items ?? [];
  if (!loading && !loadError && items.length === 0 && !error && !status) return null;
  return <section aria-label="Module 2 assignments" className="mt-3 border-t border-[var(--sat-staff-border-hairline,rgba(0,0,0,0.06))] pt-3">
    <h3 className="text-[14px] font-semibold text-[var(--sat-staff-text-primary,#1d1d1f)]">Module 2 assignments</h3>
    {loading && !queue ? <p role="status" className="mt-1 text-[14px] text-[var(--sat-staff-text-secondary,#515154)]">Loading students waiting for a Module 2 choice…</p> : null}
    {loadError ? <div role="alert" className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-[var(--sat-staff-radius-control,10px)] bg-[var(--sat-staff-warning-tint,rgba(217,119,6,0.1))] px-3 py-2 text-[14px] leading-5 text-[var(--sat-staff-warning-text,#92400e)]">
      <span className="min-w-0 flex-1 basis-48">{queue ? 'Could not refresh assignments. The displayed list may be out of date; retry before assigning.' : loadError}</span>
      <button type="button" className="sat-btn sat-btn--quiet sat-press px-3" onClick={() => void load()}>Retry</button>
    </div> : null}
    {items.length ? <ul className="mt-2 space-y-2">
      {items.map((item) => {
        const key = `${item.attemptId}:${item.sectionKey}`;
        return <li key={key} className="rounded-[var(--sat-staff-radius-control,10px)] border border-[var(--sat-staff-border-hairline,rgba(0,0,0,0.06))] px-3 py-2.5 text-[14px] leading-5">
          <p className="font-semibold text-[var(--sat-staff-text-primary,#1d1d1f)]">{item.studentName}</p>
          <p className="text-[var(--sat-staff-text-secondary,#515154)]">{item.sectionKey === 'math' ? 'Math' : 'Reading and Writing'}{item.rawCorrect != null && item.total != null ? ` · Module 1: ${item.rawCorrect}/${item.total}` : ''}</p>
          <div className="mt-2 grid grid-cols-[repeat(auto-fit,minmax(9rem,1fr))] gap-2">
            <SatButton pending={busyKey === `${key}:lower`} disabled={(busyKey !== null && busyKey !== `${key}:lower`) || blocked || Boolean(loadError)} onClick={() => void assign(item, 'lower')}>Easier Module 2</SatButton>
            <SatButton pending={busyKey === `${key}:higher`} disabled={(busyKey !== null && busyKey !== `${key}:higher`) || blocked || Boolean(loadError)} onClick={() => void assign(item, 'higher')}>Harder Module 2</SatButton>
          </div>
        </li>;
      })}
    </ul> : null}
    {status ? <p role="status" className="mt-2 text-[14px] font-medium text-[var(--sat-staff-success-text,#067647)]">{status}</p> : null}
    {error ? <p role="alert" className="mt-2 text-[14px] font-medium text-[var(--sat-staff-danger,#b42318)]">{error}</p> : null}
  </section>;
}
