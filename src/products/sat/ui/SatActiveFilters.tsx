import { X } from 'lucide-react';

export interface ActiveFilterChip {
  id: string;
  /** Visible text, e.g. "Status: In progress". */
  label: string;
  onRemove: () => void;
}

/**
 * The filters currently applied to a list, each removable in one press, plus a
 * single Clear all. Filters stay visible after the controls scroll away, so an
 * empty or short list never leaves the reader guessing why.
 */
export function SatActiveFilters({ chips, onClear }: { chips: ActiveFilterChip[]; onClear: () => void }) {
  if (chips.length === 0) return null;
  return (
    <ul aria-label="Active filters" className="mt-3 flex flex-wrap items-center gap-2">
      {chips.map((chip) => (
        <li key={chip.id} className="sat-banner-enter">
          <button
            type="button"
            onClick={chip.onRemove}
            aria-label={`Remove filter ${chip.label}`}
            className="sat-press inline-flex min-h-9 items-center gap-1.5 rounded-full border border-[var(--sat-staff-border-strong,rgba(0,0,0,0.09))] bg-[var(--sat-staff-fill-chip,rgba(0,0,0,0.04))] pl-3 pr-2 text-[14px] font-semibold text-[var(--sat-staff-text-secondary,#515154)] transition-colors hover:bg-[var(--sat-staff-fill-chip-hover,rgba(0,0,0,0.07))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-staff-accent-ring,rgba(0,113,227,0.4))]"
          >
            {chip.label}
            <X size={13} aria-hidden="true" />
          </button>
        </li>
      ))}
      <li>
        <button
          type="button"
          onClick={onClear}
          className="inline-flex min-h-9 items-center rounded-full px-2 text-[14px] font-semibold text-[var(--sat-staff-accent,#0071e3)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-staff-accent-ring,rgba(0,113,227,0.4))]"
        >
          Clear all
        </button>
      </li>
    </ul>
  );
}
