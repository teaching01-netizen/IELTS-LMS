import { useRef } from 'react';

/**
 * Platform segmented control for the Digital SAT staff workspace. Announces as
 * a radio group (the WAI-ARIA pattern for an exclusive choice), selects with a
 * pointer tap or an Arrow key, and keeps the roving tabindex so focus follows
 * the selection instead of stalling on unchecked segments.
 */
type SatSegmentedControlProps<T extends string> = {
  label: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (value: T) => void;
  className?: string;
};

export function SatSegmentedControl<T extends string>({ label, value, options, onChange, className }: SatSegmentedControlProps<T>) {
  const optionsRef = useRef<Array<HTMLButtonElement | null>>([]);

  const move = (from: number, delta: number) => {
    const next = (from + delta + options.length) % options.length;
    const option = options[next];
    if (!option) return;
    onChange(option.value);
    optionsRef.current[next]?.focus();
  };

  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={`sat-segmented ${className ?? ''}`}
      onKeyDown={(event) => {
        const index = options.findIndex((option) => option.value === value);
        if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
          event.preventDefault();
          move(index, 1);
        } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
          event.preventDefault();
          move(index, -1);
        }
      }}
    >
      {options.map((option, index) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            ref={(node) => {
              optionsRef.current[index] = node;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            className="sat-segmented-option capitalize"
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}