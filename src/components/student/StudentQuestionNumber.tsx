import React from 'react';

type StudentQuestionNumberProps = {
  number: number | string;
  /** @deprecated The question pane no longer renders an active-question state. */
  isActive?: boolean | undefined;
  className?: string | undefined;
};

const baseClassName =
  'mt-0.5 inline-flex h-6 min-w-[1.75rem] items-center justify-center border-2 px-1 text-[length:var(--student-chip-font-size)] font-bold leading-none transition-colors';

export function StudentQuestionNumber({
  number,
  className,
}: StudentQuestionNumberProps) {
  // The question pane is content, not a navigation cursor. Keep the number
  // neutral even when legacy callers still provide isActive.
  const stateClassName = 'border-gray-300 bg-white text-gray-700';

  return (
    <span
      className={[baseClassName, stateClassName, className].filter(Boolean).join(' ')}
    >
      {number}
    </span>
  );
}
