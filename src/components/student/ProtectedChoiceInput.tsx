import React, { useEffect, useRef } from 'react';
import { useOptionalStudentAttempt } from './providers/StudentAttemptProvider';

type ChoiceType = 'radio' | 'checkbox';

interface ProtectedChoiceInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> {
  type: ChoiceType;
}

export function ProtectedChoiceInput({ type, ...inputProps }: ProtectedChoiceInputProps) {
  const attemptContext = useOptionalStudentAttempt();
  const inputRef = useRef<HTMLInputElement>(null);
  const lastRescuedDomCheckedRef = useRef<boolean | null>(null);

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;

    const maybeCommitDomValue = () => {
      if (typeof inputProps.onChange !== 'function') return;
      if (typeof inputProps.checked !== 'boolean') return;

      const domChecked = input.checked;
      const controlledChecked = inputProps.checked;
      const changed =
        type === 'radio'
          ? controlledChecked === false && domChecked === true
          : domChecked !== controlledChecked;
      if (!changed) return;
      if (lastRescuedDomCheckedRef.current === domChecked) return;

      (inputProps.onChange as unknown as (event: unknown) => void)({
        target: input,
        currentTarget: input,
        type: 'change',
      });
      lastRescuedDomCheckedRef.current = domChecked;
      attemptContext?.actions.flushAnswerDurabilityNow?.();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'hidden') return;
      maybeCommitDomValue();
    };

    const handlePageHide = () => {
      maybeCommitDomValue();
    };

    const handleFreeze = () => {
      maybeCommitDomValue();
    };

    const handleFocusOut = () => {
      maybeCommitDomValue();
    };

    const handleBlur = () => {
      maybeCommitDomValue();
    };

    const handleBeforeUnload = () => {
      maybeCommitDomValue();
    };

    document.addEventListener('focusout', handleFocusOut, true);
    input.addEventListener('blur', handleBlur);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pagehide', handlePageHide);
    window.addEventListener('beforeunload', handleBeforeUnload);
    document.addEventListener('freeze', handleFreeze as EventListener);

    return () => {
      document.removeEventListener('focusout', handleFocusOut, true);
      input.removeEventListener('blur', handleBlur);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('pagehide', handlePageHide);
      window.removeEventListener('beforeunload', handleBeforeUnload);
      document.removeEventListener('freeze', handleFreeze as EventListener);
    };
  }, [attemptContext, inputProps.checked, inputProps.onChange, type]);

  return <input ref={inputRef} type={type} {...inputProps} />;
}
