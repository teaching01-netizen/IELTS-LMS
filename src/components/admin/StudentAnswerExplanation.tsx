import { Info } from 'lucide-react';
import type { StudentAnswerComparison } from './studentAnswerComparison';

interface StudentAnswerExplanationProps {
  readonly comparison: StudentAnswerComparison | null;
  readonly studentAnswer: string;
}

export function StudentAnswerExplanation({
  comparison,
}: StudentAnswerExplanationProps) {
  if (!comparison) return null;

  return (
    <p className="mt-2 flex items-start gap-1.5 text-xs font-medium text-amber-800">
      <Info size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
      <span>{comparison.reason}</span>
    </p>
  );
}
