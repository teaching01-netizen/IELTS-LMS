import { AlertTriangle, CheckCircle2, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Dialog } from '../../../components/ui/Dialog';
import {
  listSatLateEvidence,
  reviewSatLateEvidence,
  type SatLateEvidenceRow,
} from '../api/lateEvidence';
import { SatButton } from './SatPage';

/**
 * Read-only proctor review of late-answer evidence (plan phase 4).
 *
 * The backend endpoints are immutable: an "acknowledged" or "investigated"
 * disposition records that staff saw the evidence. There is deliberately no
 * rescore and no route change; those remain separate product decisions.
 */
export function SatLateEvidenceDialog({
  scheduleId,
  attemptId,
  studentName,
  open,
  onClose,
}: {
  scheduleId: string;
  attemptId: string;
  studentName: string;
  open: boolean;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<SatLateEvidenceRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState('');
  const [hasMore, setHasMore] = useState(false);
  const [note, setNote] = useState('');
  const [busyRow, setBusyRow] = useState<string | null>(null);
  const [busyOutcome, setBusyOutcome] = useState<'acknowledged' | 'investigated' | null>(null);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const noteId = useId();
  const mounted = useRef(true);
  /** One operation id per row until the review commits, so a retry is idempotent. */
  const reviewOperations = useRef(new Map<string, string>());

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const load = useCallback(async (cursor = '') => {
    setLoading(true);
    setError(null);
    try {
      const page = await listSatLateEvidence(scheduleId, attemptId, cursor);
      if (!mounted.current) return;
      setRows((current) => (cursor ? [...current, ...page.rows] : page.rows));
      setNextCursor(page.nextCursor ?? '');
      setHasMore(Boolean(page.hasMore));
    } catch (cause) {
      if (!mounted.current) return;
      setError(cause instanceof Error ? cause.message : 'Late answers could not load.');
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [attemptId, scheduleId]);

  useEffect(() => {
    if (!open) return;
    setRows([]);
    setNextCursor('');
    setHasMore(false);
    setNote('');
    setReviewError(null);
    void load();
  }, [load, open]);

  const review = async (row: SatLateEvidenceRow, outcome: 'acknowledged' | 'investigated') => {
    if (busyRow) return;
    setBusyRow(row.id);
    setBusyOutcome(outcome);
    setReviewError(null);
    const operationId = reviewOperations.current.get(row.id)
      ?? globalThis.crypto?.randomUUID?.()
      ?? `late-review-${Date.now()}-${row.id}`;
    reviewOperations.current.set(row.id, operationId);
    try {
      await reviewSatLateEvidence(scheduleId, attemptId, {
        operationId,
        evidenceIds: [row.id],
        outcome,
        note: note.trim(),
      });
      if (!mounted.current) return;
      reviewOperations.current.delete(row.id);
      setRows((current) => current.map((item) => item.id === row.id
        ? { ...item, reviewOutcome: outcome, reviewNote: note.trim() || null, reviewedAt: new Date().toISOString() }
        : item));
    } catch (cause) {
      if (!mounted.current) return;
      setReviewError(cause instanceof Error ? cause.message : 'The review could not be recorded.');
    } finally {
      if (mounted.current) {
        setBusyRow(null);
        setBusyOutcome(null);
      }
    }
  };

  const title = `Late answers — ${studentName}`;
  return (
    <Dialog
      isOpen={open}
      onClose={onClose}
      title={title}
      size="xl"
      closeOnEscape={!busyRow}
      preventCloseOnOverlayClick={busyRow !== null}
    >
      <div className="space-y-4 text-[14px] leading-5 text-[var(--sat-staff-text-secondary,#515154)]">
        <p>
          Answers the server received after their module closed. They are kept as
          evidence and are never scored automatically; they never change Module 2 routing.
        </p>
        {error ? (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-[10px] bg-[var(--sat-staff-warning-tint,rgba(217,119,6,0.1))] px-3 py-2 text-[var(--sat-staff-warning-text,#92400e)]">
            <span>{error}</span>
            <SatButton variant="secondary" onClick={() => void load()} icon={<RefreshCw size={16} aria-hidden="true" />}>Retry</SatButton>
          </div>
        ) : null}
        {reviewError ? <p role="alert" className="font-medium text-[var(--sat-staff-danger,#b42318)]">{reviewError}</p> : null}
        {loading && rows.length === 0 ? <p role="status">Loading late answers…</p> : null}
        {!loading && !error && rows.length === 0 ? <p>No late answers were recorded for this attempt.</p> : null}
        {rows.length > 0 ? (
          <div className="overflow-x-auto rounded-[10px] border border-[var(--sat-staff-border-hairline,rgba(0,0,0,0.08))]">
            <table className="w-full min-w-[720px] border-collapse text-left" aria-label={title}>
              <thead className="bg-[var(--sat-staff-fill-faint,rgba(0,0,0,0.035))]">
                <tr className="text-[12px] uppercase tracking-wide">
                  <th scope="col" className="px-3 py-2 font-semibold">Question</th>
                  <th scope="col" className="px-3 py-2 font-semibold">Answer</th>
                  <th scope="col" className="px-3 py-2 font-semibold">Received</th>
                  <th scope="col" className="px-3 py-2 font-semibold">Flags</th>
                  <th scope="col" className="px-3 py-2 font-semibold">Review</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--sat-staff-border-hairline,rgba(0,0,0,0.08))]">
                {rows.map((row) => (
                  <tr key={row.id} className="align-top">
                    <td className="max-w-[220px] px-3 py-2">
                      <span className="block truncate font-medium text-[var(--sat-staff-text-primary,#1d1d1f)]" title={row.questionId}>{row.questionId}</span>
                      <span className="block truncate text-[12px] opacity-70" title={row.moduleId}>Module {row.moduleId}</span>
                    </td>
                    <td className="max-w-[240px] px-3 py-2">
                      <span className="block break-words text-[var(--sat-staff-text-primary,#1d1d1f)]">{answerText(row.response)}</span>
                    </td>
                    <td className="px-3 py-2 tabular-nums">
                      {row.serverReceivedAt ? new Date(row.serverReceivedAt).toLocaleString() : 'Unknown'}
                    </td>
                    <td className="px-3 py-2">
                      <span className="flex flex-wrap gap-1">
                        {row.alreadyScored ? <Flag tone="success">Already scored</Flag> : null}
                        {row.wouldChangeRoute ? <Flag tone="warning">Would change route</Flag> : null}
                        {row.provenanceConflict ? <Flag tone="danger">Provenance conflict</Flag> : null}
                        {!row.alreadyScored && !row.wouldChangeRoute && !row.provenanceConflict ? <span>—</span> : null}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      {row.reviewOutcome ? (
                        <span className="inline-flex items-center gap-1 font-medium capitalize">
                          <CheckCircle2 size={14} aria-hidden="true" /> {row.reviewOutcome.replace('_', ' ')}
                        </span>
                      ) : (
                        <span className="flex flex-wrap gap-1">
                          <SatButton variant="secondary" pending={busyRow === row.id && busyOutcome === 'acknowledged'} disabled={busyRow !== null} onClick={() => void review(row, 'acknowledged')}>
                            Acknowledge
                          </SatButton>
                          <SatButton variant="quiet" pending={busyRow === row.id && busyOutcome === 'investigated'} disabled={busyRow !== null} onClick={() => void review(row, 'investigated')}>
                            Investigate
                          </SatButton>
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        {hasMore ? (
          <SatButton variant="secondary" pending={loading} disabled={loading} onClick={() => void load(nextCursor)}>
            Load more
          </SatButton>
        ) : null}
        {rows.some((row) => !row.reviewOutcome) ? (
          <label htmlFor={noteId} className="block font-medium text-[var(--sat-staff-text-primary,#1d1d1f)]">
            Review note (optional)
            <textarea
              id={noteId}
              aria-label="Review note (optional)"
              value={note}
              maxLength={500}
              rows={2}
              onChange={(event) => setNote(event.target.value)}
              className="mt-1 w-full rounded-[8px] border border-[var(--sat-staff-border-strong,rgba(0,0,0,0.14))] bg-white px-3 py-2 text-[14px] text-[var(--sat-staff-text-primary,#1d1d1f)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-staff-accent-ring,rgba(0,113,227,0.4))]"
            />
          </label>
        ) : null}
      </div>
    </Dialog>
  );
}

function Flag({ tone, children }: { tone: 'success' | 'warning' | 'danger'; children: string }) {
  const classes = tone === 'success'
    ? 'bg-[var(--sat-staff-success-tint,rgba(5,150,105,0.1))] text-[var(--sat-staff-success-text,#067647)]'
    : tone === 'warning'
      ? 'bg-[var(--sat-staff-warning-tint,rgba(217,119,6,0.1))] text-[var(--sat-staff-warning-text,#92400e)]'
      : 'bg-[var(--sat-staff-danger-tint,rgba(217,45,32,0.08))] text-[var(--sat-staff-danger,#b42318)]';
  const Icon = tone === 'success' ? CheckCircle2 : AlertTriangle;
  return <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${classes}`}><Icon size={11} aria-hidden="true" />{children}</span>;
}

/** The answer itself, never the whole aggregate, so the review table stays readable. */
export function answerText(response: unknown): string {
  if (!response || typeof response !== 'object') return '—';
  const answer = (response as { answer?: unknown }).answer;
  if (answer === null || answer === undefined || answer === '') return 'No answer';
  if (typeof answer === 'string') return answer;
  if (Array.isArray(answer)) return answer.map(String).join(' · ');
  if (typeof answer === 'object') {
    try {
      return JSON.stringify(answer);
    } catch {
      return 'Unavailable';
    }
  }
  return String(answer);
}
