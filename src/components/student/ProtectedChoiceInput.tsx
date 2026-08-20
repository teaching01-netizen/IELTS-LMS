import React, { useEffect, useRef } from 'react';
import { useOptionalStudentAttemptControls } from './providers/StudentAttemptProvider';
import { registerProtectedAnswerControlLifecycle } from './protectedAnswerControlLifecycle';

type ChoiceType = 'radio' | 'checkbox';

interface ProtectedChoiceInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> {
  type: ChoiceType;
  onLiveCheckedChange?: ((checked: boolean) => void) | undefined;
}

export function ProtectedChoiceInput({ type, onLiveCheckedChange, ...inputProps }: ProtectedChoiceInputProps) {
  const attemptControls = useOptionalStudentAttemptControls();
  const { onChange: userOnChange, onBlur: userOnBlur, ...restInputProps } = inputProps;
  const inputRef = useRef<HTMLInputElement>(null);
  const lastRescuedDomCheckedRef = useRef<boolean | null>(null);
  const latestDomCheckedRef = useRef<boolean>(false);
  const deferredRescueTimerRef = useRef<number | null>(null);
  const onChangeRef = useRef<typeof userOnChange>(userOnChange);
  const controlledCheckedRef = useRef(inputProps.checked);
  const flushAnswerDurabilityNowRef = useRef(() => attemptControls?.flushAnswerDurabilityNow());

  useEffect(() => {
    flushAnswerDurabilityNowRef.current = () => attemptControls?.flushAnswerDurabilityNow();
  }, [attemptControls]);

  useEffect(() => {
    onChangeRef.current = userOnChange;
    controlledCheckedRef.current = inputProps.checked;
    // FIX-02: server hydration — discard stale checked rescue state so blur/commit
    // does not replay pre-disconnect checked over the fresh server value.
    // Intentionally deps exclude attemptControls to avoid clearing on unrelated
    // persistence churn.
    if (deferredRescueTimerRef.current !== null) {
      window.clearTimeout(deferredRescueTimerRef.current);
      deferredRescueTimerRef.current = null;
    }
    lastRescuedDomCheckedRef.current = null;
    const el = inputRef.current;
    if (el) {
      latestDomCheckedRef.current = el.checked;
    } else if (typeof inputProps.checked === 'boolean') {
      latestDomCheckedRef.current = inputProps.checked;
    }
  }, [inputProps.checked, userOnChange]);

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    latestDomCheckedRef.current = input.checked;

    const maybeCommitDomValue = () => {
      if (typeof onChangeRef.current !== 'function') return;
      if (typeof controlledCheckedRef.current !== 'boolean') return;

      const domChecked = latestDomCheckedRef.current;
      const controlledChecked = controlledCheckedRef.current;
      const changed =
        type === 'radio'
          ? controlledChecked === false && domChecked === true
          : domChecked !== controlledChecked;
      if (!changed) return;
      if (lastRescuedDomCheckedRef.current === domChecked) return;

      (onChangeRef.current as unknown as (event: unknown) => void)({
        target: input,
        currentTarget: input,
        type: 'change',
      });
      lastRescuedDomCheckedRef.current = domChecked;
      flushAnswerDurabilityNowRef.current?.();
    };

    const scheduleDeferredDomCommit = () => {
      if (deferredRescueTimerRef.current !== null) {
        window.clearTimeout(deferredRescueTimerRef.current);
      }
      deferredRescueTimerRef.current = window.setTimeout(() => {
        deferredRescueTimerRef.current = null;
        latestDomCheckedRef.current = input.checked;
        maybeCommitDomValue();
      }, 0);
    };

    const handleNativeInput = () => {
      latestDomCheckedRef.current = input.checked;
      onLiveCheckedChange?.(latestDomCheckedRef.current);
    };

    const handleNativeChange = () => {
      latestDomCheckedRef.current = input.checked;
      onLiveCheckedChange?.(latestDomCheckedRef.current);
    };

    const handleBlur = () => {
      latestDomCheckedRef.current = input.checked;
      maybeCommitDomValue();
      scheduleDeferredDomCommit();
    };

    const releaseLifecycle = registerProtectedAnswerControlLifecycle({
      element: input,
      commitDomValue: () => {
        latestDomCheckedRef.current = input.checked;
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
    };
  }, [attemptControls, onLiveCheckedChange, type]);

  return (
    <input
      ref={inputRef}
      type={type}
      {...restInputProps}
      onChange={(event) => {
        latestDomCheckedRef.current = event.currentTarget.checked;
        onLiveCheckedChange?.(latestDomCheckedRef.current);
        userOnChange?.(event);
      }}
      onBlur={(event) => {
        latestDomCheckedRef.current = event.currentTarget.checked;
        userOnBlur?.(event);
      }}
    />
  );
}
