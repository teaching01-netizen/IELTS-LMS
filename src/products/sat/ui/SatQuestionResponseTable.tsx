import { useId, useMemo, useState } from 'react';
import { fallbackModuleLabel } from '../../../features/student-delivery/ui/transitions/score-report/scoreReportViewModel';

export interface SatQuestionResponseTableRow {
  questionId: string;
  displayOrder: number;
  moduleKey: string;
  sectionKey: string;
  response: unknown;
  responseLabel?: string;
  correctAnswer?: unknown;
  correctLabel?: string;
  isCorrect?: boolean | null;
  isPretest?: boolean;
  markedForReview: boolean;
}

type Filter = 'all' | 'incorrect' | 'unanswered' | 'marked';

function valueText(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'string') return value === '' ? '(empty)' : value;
  if (Array.isArray(value)) return value.length ? value.map(valueText).join(' · ') : '(empty)';
  if (typeof value === 'object') {
    try { return JSON.stringify(value); } catch { return '(unavailable)'; }
  }
  return String(value);
}

function answerText(value: unknown, label?: string): { text: string; title?: string } {
  if (!label) return { text: valueText(value) };
  const raw = valueText(value);
  return label === raw ? { text: label } : { text: label, title: raw };
}

function isUnanswered(value: unknown): boolean {
  return value === null || value === undefined || (typeof value === 'string' && value.trim() === '');
}

function branchLabel(moduleKey: string): string {
  if (moduleKey.endsWith('-m1')) return 'Base';
  if (moduleKey.endsWith('-m2-higher')) return 'Higher';
  if (moduleKey.endsWith('-m2-lower')) return 'Lower';
  return 'Module';
}

export function SatQuestionResponseTable({
  rows,
  caption,
  hideKeyAndResult = false,
}: {
  rows: SatQuestionResponseTableRow[];
  caption: string;
  hideKeyAndResult?: boolean;
}) {
  const filterId = useId();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const filtered = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    return rows.filter((row) => {
      if (filter === 'incorrect' && row.isCorrect !== false) return false;
      if (filter === 'unanswered' && !isUnanswered(row.response)) return false;
      if (filter === 'marked' && !row.markedForReview) return false;
      if (!needle) return true;
      return [
        row.questionId,
        row.moduleKey,
        row.sectionKey,
        valueText(row.response),
        row.responseLabel ?? '',
        valueText(row.correctAnswer),
        row.correctLabel ?? '',
      ].join(' ').toLocaleLowerCase().includes(needle);
    });
  }, [filter, rows, search]);

  if (rows.length === 0) return <p className="py-4 text-[14px] leading-5 text-[var(--sat-staff-text-secondary,#515154)]">No question-level responses recorded.</p>;

  const filters: { key: Filter; label: string }[] = [
    { key: 'all', label: 'All' },
    ...(!hideKeyAndResult ? [{ key: 'incorrect' as const, label: 'Incorrect' }] : []),
    { key: 'unanswered', label: 'Unanswered' },
    { key: 'marked', label: 'Marked' },
  ];

  return (
    <div>
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center">
        <input
          id={`${filterId}-search`}
          type="search"
          aria-label="Search questions"
          placeholder="Search questions or answers"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className="h-10 w-full rounded-[var(--sat-staff-radius-control,10px)] border border-[var(--sat-staff-border-strong,rgba(0,0,0,0.14))] bg-white px-3 text-[14px] text-[var(--sat-staff-text-primary,#1d1d1f)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-staff-accent,#2563eb)] sm:max-w-xs"
        />
        <div className="flex flex-wrap gap-2" role="group" aria-label="Filter question responses">
          {filters.map((item) => (
            <button
              key={item.key}
              type="button"
              aria-pressed={filter === item.key}
              onClick={() => setFilter(item.key)}
              className={`rounded-full border px-3 py-1.5 text-[13px] font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ${filter === item.key ? 'border-[var(--sat-staff-accent,#2563eb)] bg-[var(--sat-staff-accent-soft,#eff6ff)] text-[var(--sat-staff-accent-text,#1d4ed8)]' : 'border-[var(--sat-staff-border-hairline,rgba(0,0,0,0.08))] bg-white text-[var(--sat-staff-text-secondary,#515154)]'}`}
            >
              {item.label}
            </button>
          ))}
        </div>
        <p className="text-[13px] text-[var(--sat-staff-text-secondary,#515154)] sm:ml-auto" role="status">{filtered.length} of {rows.length} shown</p>
      </div>
      <div className="overflow-x-auto rounded-[var(--sat-staff-radius-control,10px)] border border-[var(--sat-staff-border-hairline,rgba(0,0,0,0.06))]">
        <table className="w-full min-w-[640px] border-collapse text-left" aria-label={caption}>
          <thead className="bg-[var(--sat-staff-fill-faint,rgba(0,0,0,0.035))]">
            <tr className="border-b border-[var(--sat-staff-border-hairline,rgba(0,0,0,0.06))] text-[12px] uppercase tracking-wide text-[var(--sat-staff-text-secondary,#515154)]">
              <th scope="col" className="px-4 py-3 font-semibold">Q# · Module</th>
              <th scope="col" className="px-4 py-3 font-semibold">Student answer</th>
              {!hideKeyAndResult ? <th scope="col" className="px-4 py-3 font-semibold">Key</th> : null}
              {!hideKeyAndResult ? <th scope="col" className="px-4 py-3 font-semibold">Result</th> : null}
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--sat-staff-border-hairline,rgba(0,0,0,0.06))] text-[14px]">
            {filtered.map((row) => {
              const student = answerText(row.response, row.responseLabel);
              const key = answerText(row.correctAnswer, row.correctLabel);
              const result = row.isCorrect === true ? 'Correct' : row.isCorrect === false ? 'Incorrect' : 'Not scored';
              const module = fallbackModuleLabel(row.moduleKey);
              const questionNumber = rows.indexOf(row) + 1;
              const badges = [
                ...(row.isPretest ? ['Pretest'] : []),
                ...(row.markedForReview ? ['Marked'] : []),
                ...(!row.isPretest && isUnanswered(row.response) ? ['Unanswered'] : []),
              ];
              return (
                <tr key={`${row.sectionKey}:${row.moduleKey}:${row.questionId}:${row.displayOrder}`} className="align-top hover:bg-[var(--sat-staff-fill-faint,rgba(0,0,0,0.025))]">
                  <td className="px-4 py-3 text-[var(--sat-staff-text-primary,#1d1d1f)]">
                    <span title={row.questionId} className="font-medium">Q{questionNumber} · {module} · {branchLabel(row.moduleKey)}</span>
                    {badges.length ? <span className="mt-1 flex flex-wrap gap-1">{badges.map((badge) => <span key={badge} className="rounded-full bg-[var(--sat-staff-fill-faint,rgba(0,0,0,0.05))] px-2 py-0.5 text-[11px] font-medium text-[var(--sat-staff-text-secondary,#515154)]">{badge}</span>)}</span> : null}
                  </td>
                  <td className="max-w-[260px] px-4 py-3 text-[var(--sat-staff-text-primary,#1d1d1f)]"><span className="block truncate" title={student.title ?? student.text}>{student.text}</span></td>
                  {!hideKeyAndResult ? <td className="max-w-[220px] px-4 py-3 text-[var(--sat-staff-text-secondary,#515154)]"><span className="block truncate" title={key.title ?? key.text}>{key.text}</span></td> : null}
                  {!hideKeyAndResult ? <td className="px-4 py-3"><span className={`inline-flex rounded-full px-2.5 py-1 text-[12px] font-semibold ${row.isCorrect === true ? 'bg-emerald-50 text-emerald-800' : row.isCorrect === false ? 'bg-rose-50 text-rose-800' : 'bg-[var(--sat-staff-fill-faint,rgba(0,0,0,0.05))] text-[var(--sat-staff-text-secondary,#515154)]'}`}>{result}</span></td> : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {filtered.length === 0 ? <p className="py-4 text-center text-[14px] text-[var(--sat-staff-text-secondary,#515154)]">No questions match the current filters.</p> : null}
    </div>
  );
}
