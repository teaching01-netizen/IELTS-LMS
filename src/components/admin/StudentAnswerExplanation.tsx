import type { StudentAnswerComparison } from './studentAnswerComparison';

interface StudentAnswerExplanationProps {
  readonly comparison: StudentAnswerComparison | null;
  readonly studentAnswer: string;
}

export function StudentAnswerExplanation({
  comparison,
  studentAnswer,
}: StudentAnswerExplanationProps) {
  if (!comparison) return null;

  return (
    <div className="mt-3 rounded-sm border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-gray-700">
      <p className="font-semibold text-amber-950">Why incorrect</p>
      <p className="mt-1 leading-relaxed">{comparison.reason}</p>
      <dl className="mt-2 grid gap-1.5 text-gray-800">
        <div className="flex flex-wrap gap-x-2 gap-y-0.5">
          <dt className="font-semibold text-gray-500">Your answer</dt>
          <dd className="break-words">{studentAnswer || 'Blank answer'}</dd>
        </div>
        <div className="flex flex-wrap gap-x-2 gap-y-0.5">
          <dt className="font-semibold text-gray-500">Expected</dt>
          <dd className="break-words">{comparison.expectedAnswer}</dd>
        </div>
      </dl>
    </div>
  );
}
