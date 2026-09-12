import { useId, useRef } from 'react';
import { motion } from 'motion/react';

/**
 * Platform segmented control for the Digital SAT staff workspace. Announces as
 * a radio group (the WAI-ARIA pattern for an exclusive choice), selects with a
 * pointer tap or an Arrow key, and keeps the roving tabindex so focus follows
 * the selection instead of stalling on unchecked segments.
 *
 * The selection carries a sliding thumb (shared layoutId per control) so the
 * choice glides instead of snapping. Weight + position mark selection, never
 * color alone. Reduced-motion users get an instant state change via the
 * workspace MotionConfig.
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
  const thumbId = useId();

  const move = (from: number, delta: number) => {
    const next = (from + delta + options.length) % options.length;
    const option = options[next];
    if (!option) return;
    onChange(option.value);
    optionsRef.current[next]?.focus();
  };

  return (
    // eslint-disable-next-line jsx-a11y/interactive-supports-focus -- APG radiogroup: focus lives on the roving-tabindex radio children, never the group itself.
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
            {selected ? (
              <motion.span
                layoutId={thumbId}
                aria-hidden="true"
                className="sat-segmented-thumb"
                transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
              />
            ) : null}
            <span className="sat-segmented-label">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
