import type { ReactNode } from "react";

/**
 * The workspace's single segmented-control vocabulary: a shared-layout thumb
 * that slides between segments on a short duration cross-fade (no spring on
 * this hot path). The thumb animates from its live position, so rapid
 * switching stays interruptible.
 * All controls keep `aria-pressed` semantics; the group carries the label.
 */
export interface AuthoringSegmentedOption<T extends string> {
  value: T;
  label: ReactNode;
}

export interface AuthoringSegmentedProps<T extends string> {
  options: ReadonlyArray<AuthoringSegmentedOption<T>>;
  value: T;
  onChange: (value: T) => void;
  ariaLabel: string;
  className?: string;
}

export function AuthoringSegmented<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  className,
}: AuthoringSegmentedProps<T>) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={`authoring-segmented relative flex w-fit items-center rounded-[10px] p-0.5 ${className ?? ""}`}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(option.value)}
            className={`relative flex min-h-9 min-w-0 flex-1 items-center justify-center rounded-[8px] px-3 text-[12px] font-semibold transition-colors ${
              active ? "text-slate-950" : "text-slate-500 hover:text-slate-800"
            }`}
          >
            {active ? (
              <span
                aria-hidden="true"
                className="au-elevation-card absolute inset-0 rounded-[8px] bg-au-surface"
              />
            ) : null}
            <span className="relative z-10 flex min-w-0 items-center justify-center gap-1.5 whitespace-nowrap">
              {option.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}