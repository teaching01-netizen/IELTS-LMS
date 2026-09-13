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
  // The number is orientation, not a state: at rest it stays neutral so the
  // accent is reserved for meaningful state (the focused question, the
  // selected answer, keyboard focus, the flagged state). A page where every
  // question number shouts in blue leaves nothing for the current question
  // to say.
  const stateClassName = isActive
    ? 'border-blue-800 bg-blue-800 text-white'
    : 'border-gray-300 bg-white text-gray-700';

  return (
    <span
      className={[baseClassName, stateClassName, className].filter(Boolean).join(' ')}
    >
      {number}
    </span>
  );
}
