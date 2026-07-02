import React, { useRef, useEffect } from 'react';
import { ExamConfig } from '../../types';
import { saveStudentAuditEvent } from '../../services/studentAuditService';
import { useOptionalStudentAttemptControls } from './providers/StudentAttemptProvider';
import { registerAnswerUndoRedoGuard } from './answerUndoRedoGuard';
import { registerProtectedAnswerControlLifecycle } from './protectedAnswerControlLifecycle';

type ProtectedInputSecurity = Pick<
  ExamConfig['security'],
  'preventAutofill' | 'preventAutocorrect'
>;

interface ProtectedInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'security'> {
  security: ProtectedInputSecurity;
  sessionId?: string | undefined;
  studentId?: string | undefined;
  onLiveValueChange?: ((value: string) => void) | undefined;
}

export function ProtectedInput({
  security,
  sessionId,
  studentId,
  onLiveValueChange,
  className = '',
  ...inputProps
}: ProtectedInputProps) {
  const attemptControls = useOptionalStudentAttemptControls();
  const getResolvedSessionId = () => sessionId ?? attemptControls?.getScheduleId();
  const getResolvedStudentId = () => studentId ?? attemptControls?.getAttemptId();
  const flushAnswerDurabilityNow = () => attemptControls?.flushAnswerDurabilityNow();
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
  const flushAnswerDurabilityNowRef = useRef(flushAnswerDurabilityNow);

  useEffect(() => {
    onChangeRef.current = userOnChange;
    controlledValueRef.current = inputProps.value;
    flushAnswerDurabilityNowRef.current = flushAnswerDurabilityNow;
  }, [attemptControls, inputProps.value, userOnChange]);

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
      onLiveValueChange?.(latestDomValueRef.current);
    };

    const handleNativeChange = () => {
      latestDomValueRef.current = input.value;
      onLiveValueChange?.(latestDomValueRef.current);
    };

    const handleBlur = () => {
      latestDomValueRef.current = input.value;
      maybeCommitDomValue();
      scheduleDeferredDomCommit();
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
          getResolvedSessionId(),
          signal.kind === 'undo' ? 'UNDO_BLOCKED' : 'REDO_BLOCKED',
          {
            surface: 'objective',
            targetName: input.name || input.id || 'unknown',
            via: signal.via,
            cancelable: signal.cancelable,
          },
          getResolvedStudentId(),
        );
      },
      onRestored: (signal) => {
        saveStudentAuditEvent(
          getResolvedSessionId(),
          signal.kind === 'undo' ? 'UNDO_RESTORED' : 'REDO_RESTORED',
          {
            surface: 'objective',
            targetName: input.name || input.id || 'unknown',
            via: signal.via,
            cancelable: signal.cancelable,
          },
          getResolvedStudentId(),
        );
      },
    });
    const releaseLifecycle = registerProtectedAnswerControlLifecycle({
      element: input,
      commitDomValue: () => {
        latestDomValueRef.current = input.value;
        maybeCommitDomValue();
      },
      scheduleDeferredCommit: scheduleDeferredDomCommit,
    });

    input.addEventListener('input', handleNativeInput);
    input.addEventListener('change', handleNativeChange);
    input.addEventListener('blur', handleBlur);

    return () => {
      if (deferredRescueTimerRef.current !== null) {
        window.clearTimeout(deferredRescueTimerRef.current);
        deferredRescueTimerRef.current = null;
      }
      input.removeEventListener('input', handleNativeInput);
      input.removeEventListener('change', handleNativeChange);
      input.removeEventListener('blur', handleBlur);
      releaseLifecycle();
      releaseUndoRedoGuard();
    };
  }, [attemptControls, onLiveValueChange, sessionId, studentId]);

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;

    const handleBeforeInput = (event: InputEvent) => {
      if (event.inputType === 'insertReplacementText') {
        // This is likely autofill or autocorrect
        saveStudentAuditEvent(
          getResolvedSessionId(),
          'AUTOFILL_SUSPECTED',
          {
            inputType: event.inputType,
            data: event.data,
            targetName: input.name || 'unknown',
          },
          getResolvedStudentId(),
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
          getResolvedSessionId(),
          'REPLACEMENT_SUSPECTED',
          {
            previousLength: previousValue.length,
            newLength: newValue.length,
            timeSinceKeydown,
            targetName: input.name || 'unknown',
          },
          getResolvedStudentId(),
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
  }, [attemptControls, sessionId, studentId]);

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
        onLiveValueChange?.(latestDomValueRef.current);
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
