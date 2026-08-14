import React from 'react';

type StudentQuestionNumberProps = {
  number: number | string;
  isActive?: boolean | undefined;
  className?: string | undefined;
};

const baseClassName =
  'mt-0.5 inline-flex h-6 min-w-[1.75rem] items-center justify-center border-2 px-1 text-[length:var(--student-chip-font-size)] font-bold leading-none transition-colors';

export function StudentQuestionNumber({
  number,
  isActive = false,
  className,
}: StudentQuestionNumberProps) {
  const stateClassName = isActive
    ? 'border-blue-800 bg-blue-800 text-white'
    : 'border-blue-500 bg-white text-blue-600';

  return (
    <span
      className={[baseClassName, stateClassName, className].filter(Boolean).join(' ')}
    >
      {number}
    </span>
  );
}
