import { X } from 'lucide-react';

/**
 * One close control for every staff notice/banner (plan §6.7). The button is a
 * real 44 px target, labelled for screen readers, and never steals focus: the
 * banner keeps its place in the tab order until the user chooses it.
 */
export function SatBannerDismissButton({
  onClick,
  label = 'Dismiss message',
  className = '',
}: {
  onClick: () => void;
  label?: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={`sat-touch-target sat-pressable -my-1 -mr-2 grid shrink-0 place-items-center rounded-full text-[var(--sat-staff-text-tertiary,#6e6e73)] hover:bg-[var(--sat-staff-fill-chip,rgba(0,0,0,0.04))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-staff-accent-ring,rgba(0,113,227,0.4))] ${className}`}
    >
      <X size={16} aria-hidden="true" />
    </button>
  );
}
