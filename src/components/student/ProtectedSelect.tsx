import React, { useEffect, useRef } from 'react';
import { useOptionalStudentAttempt } from './providers/StudentAttemptProvider';

type ProtectedSelectProps = React.SelectHTMLAttributes<HTMLSelectElement>;

export function ProtectedSelect({ ...selectProps }: ProtectedSelectProps) {
  const attemptContext = useOptionalStudentAttempt();
  const selectRef = useRef<HTMLSelectElement>(null);
  const lastRescuedDomValueRef = useRef<string | null>(null);

  useEffect(() => {
    const select = selectRef.current;
    if (!select) return;

    const maybeCommitDomValue = () => {
      if (typeof selectProps.onChange !== 'function') return;
      if (selectProps.value === undefined || selectProps.value === null) return;
      if (Array.isArray(selectProps.value)) return;

      const domValue = select.value;
      const controlledValue = String(selectProps.value);
      if (domValue === controlledValue) {
        lastRescuedDomValueRef.current = null;
        return;
      }
      if (lastRescuedDomValueRef.current === domValue) {
        return;
      }

      (selectProps.onChange as unknown as (event: unknown) => void)({
        target: select,
        currentTarget: select,
        type: 'change',
      });
      lastRescuedDomValueRef.current = domValue;
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
    select.addEventListener('blur', handleBlur);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pagehide', handlePageHide);
    window.addEventListener('beforeunload', handleBeforeUnload);
    document.addEventListener('freeze', handleFreeze as EventListener);

    return () => {
      document.removeEventListener('focusout', handleFocusOut, true);
      select.removeEventListener('blur', handleBlur);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('pagehide', handlePageHide);
      window.removeEventListener('beforeunload', handleBeforeUnload);
      document.removeEventListener('freeze', handleFreeze as EventListener);
    };
  }, [attemptContext, selectProps.onChange, selectProps.value]);

  return <select ref={selectRef} {...selectProps} />;
}
