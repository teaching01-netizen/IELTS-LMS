import type { MouseEvent } from 'react';
import { Flag } from 'lucide-react';

/**
 * The one flag control for the student exam.
 *
 * Hierarchy (P4): flagging is a tertiary exam action. At rest it is an
 * unfilled 18px glyph on a transparent 44px target; hover adds a soft grey
 * fill; only the flagged state earns accent color and a faint tinted
 * background. There is deliberately no permanent circular outline — the old
 * heavy ring made the flag read as important as the answer controls.
 *
 * The button is always a normal in-flow flex item (`inline-flex` /
 * `flex-shrink-0`). Callers give it a real spatial home — a trailing grid
 * column or a metadata row — so it can never float over question text.
 */
export interface StudentFlagButtonProps {
  flagged: boolean;
  onToggle: (event: MouseEvent<HTMLButtonElement>) => void;
  /** Dense rows (inline completion slots) use the compact target. */
  size?: 'default' | 'compact';
  className?: string;
}

const sharedClassName =
  'student-flag-button inline-flex flex-shrink-0 items-center justify-center rounded-md ' +
  'transition-[background-color,color,box-shadow] duration-100 ease-out ' +
  'hover:bg-gray-100 hover:text-gray-600 active:bg-gray-200 ' +
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ' +
  'focus-visible:outline-blue-700';

const restClassName = 'text-gray-400';
const flaggedClassName = 'bg-blue-50 text-blue-700 hover:bg-blue-100 active:bg-blue-200';

const sizeClassName: Record<'default' | 'compact', string> = {
  default: 'h-11 w-11',
  compact: 'h-10 w-10',
};

export function StudentFlagButton({
  flagged,
  onToggle,
  size = 'default',
  className,
}: StudentFlagButtonProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={flagged}
      aria-label={flagged ? 'Unflag question' : 'Flag question'}
      title={flagged ? 'Unflag question' : 'Flag question'}
      className={[
        sharedClassName,
        sizeClassName[size],
        flagged ? flaggedClassName : restClassName,
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <Flag size={size === 'compact' ? 16 : 18} aria-hidden="true" className={flagged ? 'fill-current' : ''} />
    </button>
  );
}
