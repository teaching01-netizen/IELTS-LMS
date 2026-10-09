import { useId, useState } from "react";

interface NumericFieldProps {
  label: string;
  value: number;
  min: number;
  max: number;
  suffix: string;
  allowZero?: boolean;
  disabled?: boolean | undefined;
  onChange: (value: number) => void;
}

/**
 * Single validated numeric field (replaces MinuteField + NumberField).
 * Typing is never coerced mid-keystroke: empty/partial input stays editable
 * and only commits a clamped integer on blur / valid entry.
 */
export function NumericField({
  label,
  value,
  min,
  max,
  suffix,
  allowZero = false,
  disabled = false,
  onChange,
}: NumericFieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const floor = allowZero ? 0 : Math.max(min, 0);
  const [draft, setDraft] = useState<string | null>(null);

  const commit = (raw: string) => {
    const trimmed = raw.trim();
    if (trimmed === "") {
      setDraft(null);
      onChange(floor);
      return;
    }
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) {
      setDraft(null);
      return;
    }
    const clamped = Math.min(max, Math.max(floor, Math.floor(parsed)));
    setDraft(null);
    onChange(clamped);
  };

  return (
    <label htmlFor={id} className="block text-[14px] font-semibold leading-5 text-[var(--sat-staff-text-primary,#1d1d1f)]">
      <span className="block">{label}</span>
      <span className="sat-input-shell mt-1.5 flex min-h-11 items-center rounded-[var(--sat-staff-radius-control,10px)] border border-[var(--sat-staff-border-control)] bg-white px-3 focus-within:border-[var(--sat-staff-accent,#0071e3)] focus-within:ring-[3px] focus-within:ring-[var(--sat-staff-accent-ring)] has-[:disabled]:bg-[var(--sat-staff-fill-faint)]">
        <input
          id={id}
          type="number"
          inputMode="numeric"
          min={floor}
          max={max}
          aria-label={label}
          disabled={disabled}
          aria-describedby={hintId}
          value={draft ?? String(value)}
          onChange={(event) => {
            const raw = event.target.value;
            setDraft(raw);
            if (raw.trim() === "") return;
            const parsed = Number(raw);
            if (!Number.isFinite(parsed)) return;
            onChange(Math.min(max, Math.max(floor, Math.floor(parsed))));
          }}
          onBlur={(event) => commit(event.target.value)}
          className="min-w-0 flex-1 bg-transparent py-2 text-[16px] font-semibold leading-6 tabular-nums text-[var(--sat-staff-text-primary,#1d1d1f)] outline-none disabled:cursor-not-allowed disabled:text-[var(--sat-staff-text-secondary,#515154)]"
        />
        <span id={hintId} className="shrink-0 text-[14px] font-normal tabular-nums text-[var(--sat-staff-text-tertiary,#6e6e73)]">
          {floor}–{max} {suffix}
        </span>
      </span>
    </label>
  );
}
