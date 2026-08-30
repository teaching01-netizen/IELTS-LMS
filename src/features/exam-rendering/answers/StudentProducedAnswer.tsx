import { sanitizeSatStudentResponseInput } from "../../exam-authoring/api/renderingPublic";

export interface StudentProducedAnswerProps {
  value?: string | undefined;
  onChange?: ((value: string) => void) | undefined;
  disabled?: boolean;
}

export function StudentProducedAnswer({
  value = "",
  onChange,
  disabled = false,
}: StudentProducedAnswerProps) {
  return (
    <label htmlFor="sat-student-response" className="block max-w-sm space-y-2">
      <span className="text-sm font-semibold text-slate-700">Enter your answer</span>
      <input
        id="sat-student-response"
        value={value}
        onChange={(event) => onChange?.(sanitizeSatStudentResponseInput(event.target.value))}
        disabled={disabled}
        inputMode="decimal"
        autoComplete="off"
        spellCheck={false}
        maxLength={6}
        aria-describedby="sat-student-response-help"
        className="w-full rounded-xl border border-slate-300 px-4 py-3 font-mono text-lg text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
        aria-label="Student-produced response"
      />
      <span id="sat-student-response-help" className="block text-xs leading-5 text-slate-500">
        Enter an integer, decimal, or fraction. Use at most 5 characters, or 6 with a leading minus
        sign.
      </span>
    </label>
  );
}
