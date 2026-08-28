export interface StudentProducedAnswerProps {
  value?: string | undefined;
  onChange?: ((value: string) => void) | undefined;
  disabled?: boolean;
}

export function StudentProducedAnswer({ value = '', onChange, disabled = false }: StudentProducedAnswerProps) {
  return (
    <label className="block max-w-sm space-y-2">
      <span className="text-sm font-semibold text-slate-700">Enter your answer</span>
      <input
        value={value}
        onChange={(event) => onChange?.(event.target.value)}
        disabled={disabled}
        inputMode="decimal"
        className="w-full rounded-xl border border-slate-300 px-4 py-3 text-lg text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
        aria-label="Student-produced response"
      />
    </label>
  );
}
