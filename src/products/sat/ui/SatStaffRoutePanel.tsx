import { useCallback, useEffect, useRef, useState } from 'react';
import { proctorGateway } from '../../../features/proctor/infrastructure/proctorGateway';

interface Waiting { attemptId: string; studentName: string; sectionKey: string; rawCorrect: number | null; total: number | null }
interface Queue { enabled: boolean; items: Waiting[] }

const POLL_MS = 5000;

/**
 * Classroom staff_selects: students whose Module 1 is closed wait here for the
 * teacher's Easy/Hard choice. Renders nothing for any other session policy.
 */
export function SatStaffRoutePanel({ scheduleId, blocked }: { scheduleId: string; blocked: boolean }) {
  const [queue, setQueue] = useState<Queue | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const identity = useRef(scheduleId);
  identity.current = scheduleId;
  const base = `/v1/proctor/sessions/${encodeURIComponent(scheduleId)}`;
  const load = useCallback(async () => {
    try {
      const next = await proctorGateway.backendGet<Queue>(`${base}/route-queue`);
      if (identity.current === scheduleId) setQueue(next);
    } catch {
      // Keep the last list; the next poll retries.
    }
  }, [base, scheduleId]);
  useEffect(() => { setQueue(null); setError(null); }, [scheduleId]);
  useEffect(() => {
    if (queue && !queue.enabled) return;
    const timer = window.setTimeout(() => void load(), queue ? POLL_MS : 0);
    return () => window.clearTimeout(timer);
  }, [load, queue]);
  const assign = async (item: Waiting, route: 'lower' | 'higher') => {
    const key = `${item.attemptId}:${item.sectionKey}`;
    if (busyKey || blocked) return;
    setBusyKey(key);
    setError(null);
    try {
      await proctorGateway.backendPost(`${base}/attempts/${encodeURIComponent(item.attemptId)}/route`, { sectionKey: item.sectionKey, route }, { retries: 0 });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Module 2 could not be assigned.');
    } finally {
      setBusyKey(null);
      void load();
    }
  };
  if (!queue?.enabled) return null;
  const button = 'sat-btn sat-btn--quiet sat-press min-h-11 px-3';
  return <section aria-label="Module 2 assignments" className="mt-5 rounded-2xl border border-[var(--sat-staff-border-hairline)] p-4">
    <h2 className="text-lg font-semibold">Module 2 assignments</h2>
    {queue.items.length === 0 ? <p className="mt-2 text-sm">No students are waiting for a Module 2 choice.</p> : <ul className="mt-3 space-y-2">
      {queue.items.map((item) => {
        const key = `${item.attemptId}:${item.sectionKey}`;
        return <li key={key} className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm">{item.studentName} · {item.sectionKey === 'math' ? 'Math' : 'Reading and Writing'}{item.rawCorrect != null && item.total != null ? ` · Module 1: ${item.rawCorrect}/${item.total}` : ''}</span>
          <span className="flex gap-2">
            <button type="button" className={button} disabled={busyKey !== null || blocked} onClick={() => void assign(item, 'lower')}>Easier Module 2</button>
            <button type="button" className={button} disabled={busyKey !== null || blocked} onClick={() => void assign(item, 'higher')}>Harder Module 2</button>
          </span>
        </li>;
      })}
    </ul>}
    {error ? <p role="alert" className="mt-3">{error}</p> : null}
  </section>;
}
