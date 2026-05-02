import React, { useRef, useEffect } from 'react';
import { ExamConfig } from '../../types';
import { saveStudentAuditEvent } from '../../services/studentAuditService';
import { useOptionalStudentAttempt } from './providers/StudentAttemptProvider';
import { registerAnswerUndoRedoGuard } from './answerUndoRedoGuard';

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
  const { onInput: userOnInput, onChange: userOnChange, onBlur: userOnBlur, ...restInputProps } =
    inputProps;
  const inputRef = useRef<HTMLInputElement>(null);
  const lastKeydownRef = useRef<number>(0);
  const previousValueRef = useRef<string>('');
  const lastRescuedDomValueRef = useRef<string | null>(null);
  const latestDomValueRef = useRef<string>('');
  const deferredRescueTimerRef = useRef<number | null>(null);
  const onChangeRef = useRef<typeof userOnChange>(userOnChange);
  const controlledValueRef = useRef(inputProps.value);
  const flushAnswerDurabilityNowRef = useRef(attemptContext?.actions.flushAnswerDurabilityNow);

  useEffect(() => {
    onChangeRef.current = userOnChange;
    controlledValueRef.current = inputProps.value;
    flushAnswerDurabilityNowRef.current = attemptContext?.actions.flushAnswerDurabilityNow;
  }, [attemptContext, inputProps.value, userOnChange]);

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    latestDomValueRef.current = input.value;

    const maybeCommitDomValue = () => {
      // Protect against iPad/Safari edge cases where the DOM value has advanced,
      // but React onChange hasn't fired yet before backgrounding/pagehide.
      if (typeof onChangeRef.current !== 'function') return;
      if (typeof controlledValueRef.current !== 'string') return;

      const domValue = latestDomValueRef.current || input.value;
      const controlledValue = controlledValueRef.current;
      if (domValue === controlledValue) {
        lastRescuedDomValueRef.current = null;
        return;
      }
      if (lastRescuedDomValueRef.current === domValue) {
        return;
      }

      // Fire the parent's onChange with a minimal event-like object.
      // This keeps the controlled value in sync and allows downstream persistence to capture it.
      (onChangeRef.current as unknown as (event: unknown) => void)({
        target: input,
        currentTarget: input,
        type: 'change',
      });
      lastRescuedDomValueRef.current = domValue;
      flushAnswerDurabilityNowRef.current?.();
    };

    const scheduleDeferredDomCommit = () => {
      if (deferredRescueTimerRef.current !== null) {
        window.clearTimeout(deferredRescueTimerRef.current);
      }
      deferredRescueTimerRef.current = window.setTimeout(() => {
        deferredRescueTimerRef.current = null;
        latestDomValueRef.current = input.value;
        maybeCommitDomValue();
      }, 0);
    };

    const handleNativeInput = () => {
      latestDomValueRef.current = input.value;
    };

    const handleNativeChange = () => {
      latestDomValueRef.current = input.value;
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'hidden') return;
      latestDomValueRef.current = input.value;
      maybeCommitDomValue();
    };

    const handlePageHide = () => {
      latestDomValueRef.current = input.value;
      maybeCommitDomValue();
    };

    const handleFreeze = () => {
      latestDomValueRef.current = input.value;
      maybeCommitDomValue();
    };

    const handleFocusOut = () => {
      latestDomValueRef.current = input.value;
      maybeCommitDomValue();
      scheduleDeferredDomCommit();
    };

    const handleBlur = () => {
      latestDomValueRef.current = input.value;
      maybeCommitDomValue();
      scheduleDeferredDomCommit();
    };

    const handleBeforeUnload = () => {
      latestDomValueRef.current = input.value;
      maybeCommitDomValue();
    };

    const releaseUndoRedoGuard = registerAnswerUndoRedoGuard({
      element: input,
      readLatestSnapshot: () => {
        if (typeof controlledValueRef.current === 'string') {
          return controlledValueRef.current;
        }
        return latestDomValueRef.current || input.value;
      },
      restoreLatestSnapshot: (snapshot) => {
        const controlledValue =
          typeof controlledValueRef.current === 'string' ? controlledValueRef.current : null;
        const domValueBeforeRestore = input.value;
        const requiresSync =
          domValueBeforeRestore !== snapshot || controlledValue !== snapshot;

        if (input.value !== snapshot) {
          input.value = snapshot;
        }
        latestDomValueRef.current = snapshot;
        previousValueRef.current = snapshot;
        lastRescuedDomValueRef.current = snapshot;

        if (requiresSync && typeof onChangeRef.current === 'function') {
          (onChangeRef.current as unknown as (event: unknown) => void)({
            target: input,
            currentTarget: input,
            type: 'change',
          });
        }
      },
      flushPersist: () => {
        flushAnswerDurabilityNowRef.current?.();
      },
      onBlocked: (signal) => {
        saveStudentAuditEvent(
          resolvedSessionId,
          signal.kind === 'undo' ? 'UNDO_BLOCKED' : 'REDO_BLOCKED',
          {
            surface: 'objective',
            targetName: input.name || input.id || 'unknown',
            via: signal.via,
            cancelable: signal.cancelable,
          },
          resolvedStudentId,
        );
      },
      onRestored: (signal) => {
        saveStudentAuditEvent(
          resolvedSessionId,
          signal.kind === 'undo' ? 'UNDO_RESTORED' : 'REDO_RESTORED',
          {
            surface: 'objective',
            targetName: input.name || input.id || 'unknown',
            via: signal.via,
            cancelable: signal.cancelable,
          },
          resolvedStudentId,
        );
      },
    });

    input.addEventListener('input', handleNativeInput);
    input.addEventListener('change', handleNativeChange);
    document.addEventListener('focusout', handleFocusOut, true);
    input.addEventListener('blur', handleBlur);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pagehide', handlePageHide);
    window.addEventListener('beforeunload', handleBeforeUnload);
    document.addEventListener('freeze', handleFreeze as EventListener);

    return () => {
      if (deferredRescueTimerRef.current !== null) {
        window.clearTimeout(deferredRescueTimerRef.current);
        deferredRescueTimerRef.current = null;
      }
      input.removeEventListener('input', handleNativeInput);
      input.removeEventListener('change', handleNativeChange);
      document.removeEventListener('focusout', handleFocusOut, true);
      input.removeEventListener('blur', handleBlur);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('pagehide', handlePageHide);
      window.removeEventListener('beforeunload', handleBeforeUnload);
      document.removeEventListener('freeze', handleFreeze as EventListener);
      releaseUndoRedoGuard();
    };
  }, [resolvedSessionId, resolvedStudentId]);

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
      latestDomValueRef.current = newValue;
      
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
      {...restInputProps}
      onInput={(event) => {
        latestDomValueRef.current = event.currentTarget.value;
        userOnInput?.(event);
      }}
      onChange={(event) => {
        latestDomValueRef.current = event.currentTarget.value;
        userOnChange?.(event);
      }}
      onBlur={(event) => {
        latestDomValueRef.current = event.currentTarget.value;
        userOnBlur?.(event);
      }}
      className={className}
      autoComplete={security.preventAutofill ? 'off' : restInputProps.autoComplete}
      spellCheck={!security.preventAutocorrect}
      autoCorrect={security.preventAutocorrect ? 'off' : 'on'}
      autoCapitalize={security.preventAutocorrect ? 'off' : 'on'}
    />
  );
}
