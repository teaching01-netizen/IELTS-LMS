import type { ChoiceOption } from '../api/assessmentContracts';
import { StructuredContentRenderer } from '../StructuredContentRenderer';

export interface SingleChoiceAnswerProps {
  options: ChoiceOption[];
  value?: string | undefined;
  eliminatedOptionIds?: ReadonlySet<string> | undefined;
  onChange?: ((optionId: string) => void) | undefined;
  disabled?: boolean;
}

export function SingleChoiceAnswer({
  options,
  value,
  eliminatedOptionIds,
  onChange,
  disabled = false,
}: SingleChoiceAnswerProps) {
  return (
    <fieldset className="space-y-3" disabled={disabled}>
      <legend className="sr-only">Answer choices</legend>
      {options.map((option, index) => {
        const eliminated = eliminatedOptionIds?.has(option.id) ?? false;
        return (
          <label
            key={option.id}
            className={`flex items-start gap-3 rounded-xl border px-4 py-3 transition-colors ${
              eliminated ? 'border-slate-200 bg-slate-50 opacity-50' : 'border-slate-200 hover:border-blue-300'
            }`}
          >
            <input
              type="radio"
              name="assessment-answer"
              value={option.id}
              checked={value === option.id}
              onChange={() => onChange?.(option.id)}
              disabled={disabled || eliminated}
              className="mt-1 h-4 w-4 text-blue-600"
            />
            <span className="flex min-w-0 gap-2">
              <span className="font-semibold text-slate-700">{String.fromCharCode(65 + index)}.</span>
              <StructuredContentRenderer content={option.content} className="min-w-0 space-y-2 text-slate-700" />
            </span>
          </label>
        );
      })}
    </fieldset>
  );
}
