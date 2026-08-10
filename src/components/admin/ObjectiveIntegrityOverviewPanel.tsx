import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  CircleAlert,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import { Button } from '@components/ui';
import { gradingService } from '../../services/gradingService';
import type {
  ObjectiveIntegrityIssueCode,
  ObjectiveIntegrityOverview,
} from '../../types/grading';

interface ObjectiveIntegrityOverviewPanelProps {
  readonly scheduleId: string;
}

const issueLabels: Record<ObjectiveIntegrityIssueCode, string> = {
  missing_answer_key: 'Missing answer key',
  invalid_answer_key: 'Invalid answer key',
  answer_key_violates_scoring_rule: 'Answer key violates scoring rule',
  unsupported_question_type: 'Unsupported question type',
  duplicate_question_id: 'Duplicate question ID',
  unknown_student_answer_id: 'Unknown student answer ID',
  answer_payload_type_invalid: 'Invalid answer payload',
  section_mapping_unavailable: 'Section mapping unavailable',
  section_mapping_ambiguous: 'Ambiguous section mapping',
  submission_merge_incomplete: 'Submission merge incomplete',
  grading_source_stale: 'Stale grading source',
  manual_override_stale: 'Stale manual override',
};

function formatIssueCode(code: ObjectiveIntegrityIssueCode): string {
  return issueLabels[code];
}

function statusLabel(status: ObjectiveIntegrityOverview['integrityStatus']): string {
  if (status === 'verified') return 'Verified';
  if (status === 'invalid') return 'Invalid';
  return 'Needs recheck';
}

export function ObjectiveIntegrityOverviewPanel({ scheduleId }: ObjectiveIntegrityOverviewPanelProps) {
  const [overview, setOverview] = useState<ObjectiveIntegrityOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadOverview = useCallback(async () => {
    setLoading(true);
    setError(null);
    const result = await gradingService.getObjectiveIntegrityOverview(scheduleId);
    if (result.success && result.data) {
      setOverview(result.data);
    } else {
      setOverview(null);
      setError(result.error ?? 'Unable to load objective integrity.');
    }
    setLoading(false);
  }, [scheduleId]);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  if (loading) {
    return (
      <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm" aria-label="Objective integrity overview">
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <LoaderCircle size={16} className="animate-spin" />
          Loading objective integrity…
        </div>
      </section>
    );
  }

  if (!overview) {
    return (
      <section className="rounded-xl border border-rose-200 bg-rose-50 p-5 shadow-sm" aria-label="Objective integrity overview">
        <div className="flex items-start justify-between gap-4">
          <div className="flex gap-3 text-rose-900">
            <CircleAlert size={20} className="mt-0.5 shrink-0" />
            <div>
              <h2 className="font-semibold">Objective integrity unavailable</h2>
              <p className="mt-1 text-sm">{error ?? 'The backend did not return an integrity overview.'}</p>
            </div>
          </div>
          <Button type="button" variant="secondary" onClick={() => void loadOverview()}>
            <RefreshCw size={14} />
            Retry
          </Button>
        </div>
      </section>
    );
  }

  const verified = overview.integrityStatus === 'verified';
  const invalid = overview.integrityStatus === 'invalid';
  const statusMessage = verified
    ? 'All objective answers are verified'
    : invalid
      ? 'Objective grading is invalid'
      : 'Needs recheck';
  const statusDetail = verified
    ? 'Every expected objective answer is classified as correct, incorrect, or authoritatively unanswered.'
    : `${overview.needsRecheckCount} expected answer${overview.needsRecheckCount === 1 ? '' : 's'} still needs review.`;

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm" aria-label="Objective integrity overview">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <ShieldCheck size={18} className="text-indigo-600" />
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-gray-400">Objective integrity</p>
          </div>
          <h2 className="mt-1 text-lg font-semibold text-gray-900">Overall objective verification</h2>
          <p className="mt-1 text-sm text-gray-500">Counts come from persisted grading audits for this schedule.</p>
        </div>
        <button
          type="button"
          onClick={() => void loadOverview()}
          className="inline-flex items-center gap-2 self-start rounded-md border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          <RefreshCw size={14} />
          Refresh
        </button>
      </div>

      <div className={`mt-4 rounded-lg border px-4 py-3 ${
        verified
          ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
          : invalid
            ? 'border-rose-200 bg-rose-50 text-rose-900'
            : 'border-amber-200 bg-amber-50 text-amber-900'
      }`}>
        <div className="flex items-start gap-3">
          {verified ? <CheckCircle2 size={20} className="mt-0.5 shrink-0" /> : <AlertTriangle size={20} className="mt-0.5 shrink-0" />}
          <div>
            <p className="font-semibold">{statusMessage}</p>
            <p className="mt-1 text-sm">{statusDetail}</p>
          </div>
          <span className="ml-auto shrink-0 text-xs font-bold uppercase tracking-wider">{statusLabel(overview.integrityStatus)}</span>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-6">
        <div className="rounded-lg bg-gray-50 px-3 py-3"><p className="text-lg font-semibold text-gray-900">{overview.expectedAnswerCount} expected</p></div>
        <div className="rounded-lg bg-emerald-50 px-3 py-3"><p className="text-lg font-semibold text-emerald-800">{overview.verifiedCorrectCount} correct</p></div>
        <div className="rounded-lg bg-rose-50 px-3 py-3"><p className="text-lg font-semibold text-rose-800">{overview.verifiedIncorrectCount} incorrect</p></div>
        <div className="rounded-lg bg-slate-50 px-3 py-3"><p className="text-lg font-semibold text-slate-800">{overview.verifiedUnansweredCount} unanswered</p></div>
        <div className="rounded-lg bg-amber-50 px-3 py-3"><p className="text-lg font-semibold text-amber-800">{overview.needsRecheckCount} needs recheck</p></div>
        <div className="rounded-lg bg-rose-100 px-3 py-3"><p className="text-lg font-semibold text-rose-900">{overview.invalidCount} invalid</p></div>
      </div>

      {overview.issues.length > 0 ? (
        <div className="mt-5">
          <h3 className="text-sm font-semibold text-gray-900">Issues requiring attention</h3>
          <ul className="mt-2 divide-y divide-gray-100 rounded-lg border border-gray-200">
            {overview.issues.map((issue, index) => (
              <li key={`${issue.submissionId}:${issue.section}:${issue.questionId ?? 'section'}:${index}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
                <span className="font-medium text-gray-900">{issue.studentName}</span>
                <span className="text-gray-500">{issue.section}{issue.questionNumber ? ` · Q${issue.questionNumber}` : ''}</span>
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">{formatIssueCode(issue.code)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
