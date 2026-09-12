import { useId, useState } from "react";

interface NumericFieldProps {
  label: string;
  value: number;
  min: number;
  max: number;
  suffix: string;
  allowZero?: boolean;
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
    <label htmlFor={id} className="block text-xs font-medium text-muted-foreground">
      <span className="mb-1.5 block">{label}</span>
      <span className="mt-1.5 flex min-h-11 items-center rounded-xl border border-border bg-card px-3 focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/15">
        <input
          id={id}
          type="number"
          inputMode="numeric"
          min={floor}
          max={max}
          aria-label={label}
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
          className="min-w-0 flex-1 bg-transparent py-2 text-sm font-semibold text-foreground outline-none"
        />
        <span id={hintId} className="shrink-0 text-xs tabular-nums text-muted-foreground">
          {floor}–{max} {suffix}
        </span>
      </span>
    </label>
  );
}
