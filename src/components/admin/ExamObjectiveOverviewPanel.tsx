import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, FileCheck2, LoaderCircle, XCircle } from 'lucide-react';
import type { GradingSession } from '../../types/grading';
import { gradingRepository } from '../../services/gradingRepository';
import { gradingService } from '../../services/gradingService';
import type { ExamObjectiveOverviewBundle, ExamObjectiveOverviewRow } from './examObjectiveOverviewUtils';
import { buildExamObjectiveOverviewRows } from './examObjectiveOverviewUtils';

interface ExamObjectiveOverviewPanelProps {
  readonly session: GradingSession;
  readonly onStudentSelect?: ((submissionId: string) => void) | undefined;
}

function ResultBadge({ isCorrect }: { readonly isCorrect: boolean }) {
  return isCorrect ? (
    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-1 text-xs font-semibold text-emerald-800">
      <CheckCircle2 size={13} /> Correct
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2 py-1 text-xs font-semibold text-rose-800">
      <XCircle size={13} /> Incorrect
    </span>
  );
}

export function ExamObjectiveOverviewPanel({
  session,
  onStudentSelect,
}: ExamObjectiveOverviewPanelProps) {
  const [bundles, setBundles] = useState<ExamObjectiveOverviewBundle[]>([]);
  const [submissionCount, setSubmissionCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingRowIds, setPendingRowIds] = useState<Set<string>>(() => new Set());

  const loadOverview = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const nextBundles = await Promise.all(
        (await gradingRepository.getSubmissionsBySession(session.id)).map(async (submission) => ({
          submission: { id: submission.id, studentName: submission.studentName },
          sections: await gradingRepository.getSectionSubmissionsBySubmissionId(submission.id),
        })),
      );
      setBundles(nextBundles);
      setSubmissionCount(nextBundles.length);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load overall answer results.');
    } finally {
      setLoading(false);
    }
  }, [session.id]);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  const rows = useMemo(() => buildExamObjectiveOverviewRows(bundles), [bundles]);
  const correctCount = rows.filter((row) => row.isCorrect).length;
  const overrideCount = rows.filter((row) => row.manualOverride).length;

  const handleOverride = async (row: ExamObjectiveOverviewRow, isCorrect: boolean) => {
    setPendingRowIds((current) => new Set(current).add(row.rowId));
    setError(null);
    try {
      const result = await gradingService.overrideObjectiveQuestion(
        row.submissionId,
        row.section,
        row.questionId,
        { isCorrect, reason: 'Manual grader correctness decision from exam overview' },
      );
      if (!result.success || !result.data) {
        setError(result.error ?? 'Failed to update answer correctness.');
        return;
      }

      setBundles((current) => current.map((bundle) => bundle.submission.id !== row.submissionId
        ? bundle
        : {
          ...bundle,
          sections: bundle.sections.map((section) => section.id === result.data?.id ? result.data : section),
        }));
    } catch (overrideError) {
      setError(overrideError instanceof Error ? overrideError.message : 'Failed to update answer correctness.');
    } finally {
      setPendingRowIds((current) => {
        const next = new Set(current);
        next.delete(row.rowId);
        return next;
      });
    }
  };

  return (
    <section className="overflow-hidden rounded-xl border border-blue-200 bg-white shadow-sm">
      <div className="border-b border-blue-100 bg-blue-50/50 px-4 py-4 sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-100 text-blue-700">
              <FileCheck2 size={19} />
            </div>
            <div>
              <h2 className="text-base font-bold text-gray-900">Overall exam answer check</h2>
              <p className="mt-1 text-sm text-gray-600">
                {session.examTitle} · Reading and Listening · text matches ignore letter case
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-gray-600">
            <span>{submissionCount} students</span>
            <span>·</span>
            <span>{rows.length} answer rows</span>
            <span>·</span>
            <span>{correctCount} correct</span>
            {overrideCount > 0 ? <span>· {overrideCount} overridden</span> : null}
          </div>
        </div>
      </div>

      {error ? (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 sm:px-6" role="alert">
          <span className="flex items-center gap-2"><AlertTriangle size={16} /> {error}</span>
          <button type="button" onClick={() => void loadOverview()} className="min-h-9 rounded-md border border-rose-300 bg-white px-3 py-1 text-xs font-semibold hover:bg-rose-100">
            Retry
          </button>
        </div>
      ) : null}

      {loading ? (
        <div className="flex items-center gap-2 px-4 py-8 text-sm text-gray-600 sm:px-6">
          <LoaderCircle size={16} className="animate-spin" /> Loading all objective answer rows...
        </div>
      ) : rows.length === 0 ? (
        <div className="px-4 py-8 text-sm text-gray-600 sm:px-6">No Reading or Listening answer results are available for this exam yet.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-[980px] w-full text-left text-sm">
            <thead className="bg-gray-50 text-xs uppercase tracking-wider text-gray-500">
              <tr>
                <th className="px-4 py-3 font-semibold sm:px-6">Student</th>
                <th className="px-4 py-3 font-semibold">Section</th>
                <th className="px-4 py-3 font-semibold">Question</th>
                <th className="px-4 py-3 font-semibold">Student answer</th>
                <th className="px-4 py-3 font-semibold">Answer key</th>
                <th className="px-4 py-3 font-semibold">Result</th>
                <th className="px-4 py-3 font-semibold">Set result</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {rows.map((row) => {
                const pending = pendingRowIds.has(row.rowId);
                return (
                  <tr key={row.rowId} className="align-top hover:bg-gray-50">
                    <td className="px-4 py-4 sm:px-6">
                      {onStudentSelect ? (
                        <button type="button" onClick={() => onStudentSelect(row.submissionId)} className="font-semibold text-blue-700 hover:underline">
                          {row.studentName}
                        </button>
                      ) : <span className="font-semibold text-gray-900">{row.studentName}</span>}
                    </td>
                    <td className="px-4 py-4 capitalize text-gray-700">{row.section}</td>
                    <td className="px-4 py-4 font-mono text-xs text-gray-600">{row.questionId}</td>
                    <td className="max-w-48 whitespace-pre-wrap break-words px-4 py-4 text-gray-900">{row.studentAnswer || '—'}</td>
                    <td className="max-w-48 whitespace-pre-wrap break-words px-4 py-4 text-gray-700">{row.correctAnswer || '—'}</td>
                    <td className="px-4 py-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <ResultBadge isCorrect={row.isCorrect} />
                        <span className="text-xs text-gray-500">{row.awardedScore} / {row.maxScore}</span>
                        {row.manualOverride ? <span className="rounded-full bg-blue-100 px-2 py-1 text-xs font-medium text-blue-700">Override</span> : null}
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex flex-wrap gap-2">
                        <button type="button" disabled={pending} aria-pressed={row.manualOverride?.isCorrect === true} onClick={() => void handleOverride(row, true)} className="min-h-9 rounded-md border border-emerald-300 px-3 py-1 text-xs font-semibold text-emerald-800 hover:bg-emerald-50 disabled:cursor-wait disabled:opacity-50">Correct</button>
                        <button type="button" disabled={pending} aria-pressed={row.manualOverride?.isCorrect === false} onClick={() => void handleOverride(row, false)} className="min-h-9 rounded-md border border-rose-300 px-3 py-1 text-xs font-semibold text-rose-800 hover:bg-rose-50 disabled:cursor-wait disabled:opacity-50">Incorrect</button>
                      </div>
                      {pending ? <span className="mt-1 block text-xs text-gray-500" aria-live="polite">Saving…</span> : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
