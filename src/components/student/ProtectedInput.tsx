import React, { useRef, useEffect } from 'react';
import { ExamConfig } from '../../types';
import { saveStudentAuditEvent } from '@student/application/studentAttemptFacade';
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
  /** Direct value commit (preferred over fabricated change events for DOM-rescue paths). */
  onCommitValue?: ((value: string) => void) | undefined;
}

export function ProtectedInput({
  security,
  sessionId,
  studentId,
  onLiveValueChange,
  onCommitValue,
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
  const onCommitValueRef = useRef<typeof onCommitValue>(onCommitValue);
  const controlledValueRef = useRef(inputProps.value);
  const flushAnswerDurabilityNowRef = useRef(flushAnswerDurabilityNow);

  useEffect(() => {
    onCommitValueRef.current = onCommitValue;
  }, [onCommitValue]);

  useEffect(() => {
    flushAnswerDurabilityNowRef.current = flushAnswerDurabilityNow;
  }, [attemptControls]);

  useEffect(() => {
    onChangeRef.current = userOnChange;
    controlledValueRef.current = inputProps.value;
    // FIX-02: server hydration — discard stale DOM rescue state so blur/commit
    // does not replay pre-disconnect text over the fresh server value.
    // Intentionally deps exclude attemptControls to avoid clearing on unrelated
    // persistence churn (which would suppress a legitimate deferred blur-commit).
    if (deferredRescueTimerRef.current !== null) {
      window.clearTimeout(deferredRescueTimerRef.current);
      deferredRescueTimerRef.current = null;
    }
    lastRescuedDomValueRef.current = null;
    const el = inputRef.current;
    if (el) {
      latestDomValueRef.current = el.value;
    } else if (typeof inputProps.value === 'string') {
      latestDomValueRef.current = inputProps.value;
    } else {
      latestDomValueRef.current = String(inputProps.value ?? '');
    }
  }, [inputProps.value, userOnChange]);

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    latestDomValueRef.current = input.value;

    const maybeCommitDomValue = () => {
      // Protect against iPad/Safari edge cases where the DOM value has advanced,
      // but React onChange hasn't fired yet before backgrounding/pagehide.
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

      // Prefer the direct value-commit callback when provided (no fabricated
      // event, safe for controlled inputs). Fall back to the legacy
      // event-like onChange invocation for callers that have not migrated.
      if (typeof onCommitValueRef.current === 'function') {
        onCommitValueRef.current(domValue);
      } else if (typeof onChangeRef.current === 'function') {
        // Legacy fallback: the DOM value already holds domValue here (read-only
        // access, no write), so passing the live element preserves target shape.
        (onChangeRef.current as unknown as (event: unknown) => void)({
          target: input,
          currentTarget: input,
          type: 'change',
        });
      } else {
        return;
      }
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

        // Heal the visible DOM immediately (undo bypasses React's render path),
        // then notify the parent so the controlled value reconciles on re-render.
        // Prefer the direct value-commit callback; fall back to the legacy
        // event-like onChange invocation for callers that have not migrated.
        if (input.value !== snapshot) {
          input.value = snapshot;
        }
        latestDomValueRef.current = snapshot;
        previousValueRef.current = snapshot;
        lastRescuedDomValueRef.current = snapshot;

        if (requiresSync) {
          if (typeof onCommitValueRef.current === 'function') {
            onCommitValueRef.current(snapshot);
          } else if (typeof onChangeRef.current === 'function') {
            (onChangeRef.current as unknown as (event: unknown) => void)({
              target: input,
              currentTarget: input,
              type: 'change',
            });
          }
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
