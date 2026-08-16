import { AlertTriangle, CheckCircle2, CircleAlert, LoaderCircle } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type {
  ObjectiveIntegrityIssueCode,
  ObjectiveIntegrityOverview,
  ObjectiveIntegrityStatus,
} from '../../types/grading';

interface ObjectiveIntegrityAuditSectionProps {
  readonly loading: boolean;
  readonly overview: ObjectiveIntegrityOverview | null;
  readonly error: string | null;
}

interface AuditCopy {
  readonly label: string;
  readonly description: string;
}

const STATUS_COPY = {
  verified: {
    label: 'Verified',
    className: 'border-emerald-200 bg-emerald-50 text-emerald-800',
    iconClassName: 'bg-emerald-100 text-emerald-700',
    Icon: CheckCircle2,
  },
  needs_recheck: {
    label: 'Needs recheck',
    className: 'border-amber-200 bg-amber-50 text-amber-900',
    iconClassName: 'bg-amber-100 text-amber-800',
    Icon: CircleAlert,
  },
  invalid: {
    label: 'Invalid',
    className: 'border-rose-200 bg-rose-50 text-rose-800',
    iconClassName: 'bg-rose-100 text-rose-800',
    Icon: AlertTriangle,
  },
} satisfies Record<ObjectiveIntegrityStatus, {
  readonly label: string;
  readonly className: string;
  readonly iconClassName: string;
  readonly Icon: LucideIcon;
}>;

const ISSUE_COPY = {
  missing_answer_key: {
    label: 'Missing answer key',
    description: 'The question has no usable answer key.',
  },
  invalid_answer_key: {
    label: 'Invalid answer key',
    description: 'The answer key has an invalid shape.',
  },
  answer_key_violates_scoring_rule: {
    label: 'Answer key violates scoring rule',
    description: 'The configured answer key does not follow its scoring rule.',
  },
  unsupported_question_type: {
    label: 'Unsupported question type',
    description: 'This question type has no supported automatic grader.',
  },
  duplicate_question_id: {
    label: 'Duplicate question ID',
    description: 'The published section contains a duplicate question ID.',
  },
  unknown_student_answer_id: {
    label: 'Unknown student answer ID',
    description: 'The submission contains an answer ID absent from the published question map.',
  },
  answer_payload_type_invalid: {
    label: 'Invalid answer payload',
    description: 'The submitted answer has an unsupported data shape.',
  },
  section_mapping_unavailable: {
    label: 'Section mapping unavailable',
    description: 'The published question-to-section map could not be constructed.',
  },
  section_mapping_ambiguous: {
    label: 'Ambiguous section mapping',
    description: 'The answer ID maps to more than one objective section.',
  },
  submission_merge_incomplete: {
    label: 'Submission merge incomplete',
    description: 'The final submission does not prove that all answer mutations were acknowledged.',
  },
  grading_source_stale: {
    label: 'Stale grading source',
    description: 'The stored result was produced from an obsolete grading source.',
  },
  manual_override_stale: {
    label: 'Stale manual override',
    description: 'The manual override was produced from an obsolete grading source.',
  },
} satisfies Record<ObjectiveIntegrityIssueCode, AuditCopy>;

const SUMMARY_COPY: Record<
  ObjectiveIntegrityStatus,
  (overview: ObjectiveIntegrityOverview) => string
> = {
  verified: (overview) => `All ${overview.expectedAnswerCount.toLocaleString('en-US')} objective answers accounted for`,
  needs_recheck: (overview) => {
    const count = overview.needsRecheckCount;
    return `${count.toLocaleString('en-US')} ${count === 1 ? 'answer needs' : 'answers need'} recheck`;
  },
  invalid: (overview) => {
    const count = overview.invalidCount;
    return `${count.toLocaleString('en-US')} ${count === 1 ? 'invalid audit item' : 'invalid audit items'} found`;
  },
};

function formatSection(section: string): string {
  if (!section) return 'Unknown section';
  return `${section.slice(0, 1).toUpperCase()}${section.slice(1)}`;
}

function formatQuestion(issue: ObjectiveIntegrityOverview['issues'][number]): string {
  if (issue.questionNumber) {
    return issue.questionNumber.startsWith('q-') ? issue.questionNumber : `q-${issue.questionNumber}`;
  }
  return issue.questionId ?? 'Question not identified';
}

function getEmptyIssuesMessage(status: ObjectiveIntegrityStatus): string {
  return status === 'verified'
    ? 'No audit problems found in the persisted grading results.'
    : 'The persisted audit reports unresolved grading data, but no question-level issue details were returned.';
}

function AuditStat({ label, value }: { readonly label: string; readonly value: number }) {
  return (
    <div className="rounded-md border border-gray-200 bg-white px-3 py-3">
      <dt className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">{label}</dt>
      <dd className="mt-1 text-lg font-bold text-gray-900">{value.toLocaleString('en-US')}</dd>
    </div>
  );
}

export function ObjectiveIntegrityAuditSection({
  loading,
  overview,
  error,
}: ObjectiveIntegrityAuditSectionProps) {
  const statusCopy = overview ? STATUS_COPY[overview.integrityStatus] : null;
  const StatusIcon = statusCopy?.Icon ?? AlertTriangle;

  return (
    <section
      className="border-t border-gray-200 bg-gray-50/60 px-4 py-4 sm:px-6"
      aria-labelledby="objective-integrity-audit-heading"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${statusCopy ? statusCopy.iconClassName : 'bg-gray-200 text-gray-700'}`}>
            <StatusIcon size={17} aria-hidden="true" />
          </div>
          <div>
            <h3 id="objective-integrity-audit-heading" className="text-sm font-bold text-gray-900">
              Audit findings
            </h3>
            <p className="mt-1 max-w-2xl text-xs leading-relaxed text-gray-600">
              Persisted grading audit for this schedule. Findings explain key or data problems without changing marks or creating review actions.
            </p>
          </div>
        </div>
        {statusCopy ? (
          <span className={`inline-flex items-center gap-1.5 rounded-sm border px-2 py-1 text-[11px] font-semibold ${statusCopy.className}`} role="status">
            <statusCopy.Icon size={13} aria-hidden="true" />
            {statusCopy.label}
          </span>
        ) : null}
      </div>

      {loading ? (
        <p className="mt-4 flex items-center gap-2 text-sm text-gray-600" role="status" aria-live="polite">
          <LoaderCircle size={14} className="animate-spin" aria-hidden="true" />
          Loading persisted audit…
        </p>
      ) : error ? (
        <div className="mt-4 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-900" role="alert">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </div>
      ) : overview ? (
        <>
          <p className="mt-4 text-sm font-semibold text-gray-900">
            {SUMMARY_COPY[overview.integrityStatus](overview)}
          </p>

          <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            <AuditStat label="Expected" value={overview.expectedAnswerCount} />
            <AuditStat label="Correct" value={overview.verifiedCorrectCount} />
            <AuditStat label="Incorrect" value={overview.verifiedIncorrectCount} />
            <AuditStat label="Unanswered" value={overview.verifiedUnansweredCount} />
            <AuditStat label="Needs recheck" value={overview.needsRecheckCount} />
            <AuditStat label="Invalid" value={overview.invalidCount} />
          </dl>

          {overview.issues.length > 0 ? (
            <div className="mt-4">
              <h4 className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">Problems found</h4>
              <ul className="mt-2 space-y-2">
                {overview.issues.map((issue, index) => {
                  const copy = ISSUE_COPY[issue.code];
                  return (
                    <li
                      key={`${issue.submissionId}:${issue.section}:${issue.questionId ?? issue.code}:${index}`}
                      className="rounded-md border border-amber-200 bg-white px-3 py-3"
                    >
                      <p className="text-sm font-semibold text-gray-900">{copy.label}</p>
                      <p className="mt-1 text-xs font-medium text-gray-700">
                        {issue.studentName} · {formatSection(issue.section)} · {formatQuestion(issue)}
                      </p>
                      <p className="mt-1 text-xs leading-relaxed text-gray-600">{copy.description}</p>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : (
            <p className="mt-4 text-xs text-gray-600">{getEmptyIssuesMessage(overview.integrityStatus)}</p>
          )}
        </>
      ) : (
        <p className="mt-4 text-sm text-gray-600">No persisted integrity audit was returned for this schedule.</p>
      )}
    </section>
  );
}
