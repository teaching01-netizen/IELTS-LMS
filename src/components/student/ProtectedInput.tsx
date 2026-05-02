import React, { useRef, useEffect } from 'react';
import { ExamConfig } from '../../types';
import { saveStudentAuditEvent } from '../../services/studentAuditService';
import { useOptionalStudentAttempt } from './providers/StudentAttemptProvider';

type ProtectedInputSecurity = Pick<
  ExamConfig['security'],
  'preventAutofill' | 'preventAutocorrect'
>;

interface ProtectedInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'security'> {
  security: ProtectedInputSecurity;
  sessionId?: string | undefined;
  studentId?: string | undefined;
}

export function ProtectedInput({
  security,
  sessionId,
  studentId,
  className = '',
  ...inputProps
}: ProtectedInputProps) {
  const attemptContext = useOptionalStudentAttempt();
  const resolvedSessionId = sessionId ?? attemptContext?.state.attempt?.scheduleId;
  const resolvedStudentId = studentId ?? attemptContext?.state.attemptId ?? undefined;
  const inputRef = useRef<HTMLInputElement>(null);
  const lastKeydownRef = useRef<number>(0);
  const previousValueRef = useRef<string>('');
  const lastRescuedDomValueRef = useRef<string | null>(null);

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;

    const maybeCommitDomValue = () => {
      // Protect against iPad/Safari edge cases where the DOM value has advanced,
      // but React onChange hasn't fired yet before backgrounding/pagehide.
      if (typeof inputProps.onChange !== 'function') return;
      if (typeof inputProps.value !== 'string') return;

      const domValue = input.value;
      const controlledValue = inputProps.value;
      if (domValue === controlledValue) {
        lastRescuedDomValueRef.current = null;
        return;
      }
      if (lastRescuedDomValueRef.current === domValue) {
        return;
      }

      // Fire the parent's onChange with a minimal event-like object.
      // This keeps the controlled value in sync and allows downstream persistence to capture it.
      (inputProps.onChange as unknown as (event: unknown) => void)({
        target: input,
        currentTarget: input,
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
  }, [attemptContext, inputProps.onChange, inputProps.value]);

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;

    const handleBeforeInput = (event: InputEvent) => {
      if (event.inputType === 'insertReplacementText') {
        // This is likely autofill or autocorrect
        saveStudentAuditEvent(
          resolvedSessionId,
          'AUTOFILL_SUSPECTED',
          {
            inputType: event.inputType,
            data: event.data,
            targetName: input.name || 'unknown',
          },
          resolvedStudentId,
        );
      }
    };

    const handleInput = (event: Event) => {
      const target = event.target as HTMLInputElement;
      const newValue = target.value;
      const previousValue = previousValueRef.current;
      
      // Check for large value changes without preceding keydown (suspected paste/autofill)
      const valueChange = Math.abs(newValue.length - previousValue.length);
      const timeSinceKeydown = Date.now() - lastKeydownRef.current;
      
      if (valueChange > 50 && timeSinceKeydown > 500) {
        saveStudentAuditEvent(
          resolvedSessionId,
          'REPLACEMENT_SUSPECTED',
          {
            previousLength: previousValue.length,
            newLength: newValue.length,
            timeSinceKeydown,
            targetName: input.name || 'unknown',
          },
          resolvedStudentId,
        );
      }
      
      previousValueRef.current = newValue;
    };

    const handleKeydown = () => {
      lastKeydownRef.current = Date.now();
    };

    input.addEventListener('beforeinput', handleBeforeInput);
    input.addEventListener('input', handleInput);
    input.addEventListener('keydown', handleKeydown);

    return () => {
      input.removeEventListener('beforeinput', handleBeforeInput);
      input.removeEventListener('input', handleInput);
      input.removeEventListener('keydown', handleKeydown);
    };
  }, [resolvedSessionId, resolvedStudentId]);

  return (
    <input
      ref={inputRef}
      {...inputProps}
      className={className}
      autoComplete={security.preventAutofill ? 'off' : inputProps.autoComplete}
      spellCheck={!security.preventAutocorrect}
      autoCorrect={security.preventAutocorrect ? 'off' : 'on'}
      autoCapitalize={security.preventAutocorrect ? 'off' : 'on'}
    />
  );
}
