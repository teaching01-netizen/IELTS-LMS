import React, { useEffect, useRef } from 'react';
import { useOptionalStudentAttemptControls } from './providers/StudentAttemptProvider';
import { registerProtectedAnswerControlLifecycle } from './protectedAnswerControlLifecycle';

type ProtectedSelectProps = React.SelectHTMLAttributes<HTMLSelectElement> & {
  onLiveValueChange?: ((value: string) => void) | undefined;
};

export function ProtectedSelect({ ...selectProps }: ProtectedSelectProps) {
  const attemptControls = useOptionalStudentAttemptControls();
  const { onChange: userOnChange, onBlur: userOnBlur, onLiveValueChange, ...restSelectProps } = selectProps;
  const selectRef = useRef<HTMLSelectElement>(null);
  const lastRescuedDomValueRef = useRef<string | null>(null);
  const latestDomValueRef = useRef<string>('');
  const deferredRescueTimerRef = useRef<number | null>(null);
  const onChangeRef = useRef<typeof userOnChange>(userOnChange);
  const controlledValueRef = useRef(selectProps.value);
  const flushAnswerDurabilityNowRef = useRef(() => attemptControls?.flushAnswerDurabilityNow());

  useEffect(() => {
    onChangeRef.current = userOnChange;
    controlledValueRef.current = selectProps.value;
    flushAnswerDurabilityNowRef.current = () => attemptControls?.flushAnswerDurabilityNow();
    // FIX-02: server hydration — discard stale rescue state so commitAll/blur
    // cannot replay pre-disconnect DOM value over the fresh server value.
    if (deferredRescueTimerRef.current !== null) {
      window.clearTimeout(deferredRescueTimerRef.current);
      deferredRescueTimerRef.current = null;
    }
    lastRescuedDomValueRef.current = null;
    const el = selectRef.current;
    if (el) {
      latestDomValueRef.current = el.value;
    } else if (
      selectProps.value !== undefined &&
      selectProps.value !== null &&
      !Array.isArray(selectProps.value)
    ) {
      latestDomValueRef.current = String(selectProps.value);
    }
  }, [attemptControls, selectProps.value, userOnChange]);

  useEffect(() => {
    const select = selectRef.current;
    if (!select) return;
    latestDomValueRef.current = select.value;

    const maybeCommitDomValue = () => {
      if (typeof onChangeRef.current !== 'function') return;
      if (controlledValueRef.current === undefined || controlledValueRef.current === null) return;
      if (Array.isArray(controlledValueRef.current)) return;

      const domValue = latestDomValueRef.current || select.value;
      const controlledValue = String(controlledValueRef.current);
      if (domValue === controlledValue) {
        lastRescuedDomValueRef.current = null;
        return;
      }
      if (lastRescuedDomValueRef.current === domValue) {
        return;
      }

      (onChangeRef.current as unknown as (event: unknown) => void)({
        target: select,
        currentTarget: select,
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
        latestDomValueRef.current = select.value;
        maybeCommitDomValue();
      }, 0);
    };

    const handleNativeChange = () => {
      latestDomValueRef.current = select.value;
      onLiveValueChange?.(latestDomValueRef.current);
    };

    const handleBlur = () => {
      latestDomValueRef.current = select.value;
      maybeCommitDomValue();
      scheduleDeferredDomCommit();
    };

    const releaseLifecycle = registerProtectedAnswerControlLifecycle({
      element: select,
      commitDomValue: () => {
        latestDomValueRef.current = select.value;
        maybeCommitDomValue();
      },
      scheduleDeferredCommit: scheduleDeferredDomCommit,
    });

    select.addEventListener('change', handleNativeChange);
    select.addEventListener('blur', handleBlur);

    return () => {
      if (deferredRescueTimerRef.current !== null) {
        window.clearTimeout(deferredRescueTimerRef.current);
        deferredRescueTimerRef.current = null;
      }
      select.removeEventListener('change', handleNativeChange);
      select.removeEventListener('blur', handleBlur);
      releaseLifecycle();
    };
  }, [attemptControls, onLiveValueChange]);

  return (
    <select
      ref={selectRef}
      {...restSelectProps}
      onChange={(event) => {
        latestDomValueRef.current = event.currentTarget.value;
        onLiveValueChange?.(latestDomValueRef.current);
        userOnChange?.(event);
      }}
      onBlur={(event) => {
        latestDomValueRef.current = event.currentTarget.value;
        userOnBlur?.(event);
      }}
    />
  );
}
