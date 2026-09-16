import React, { useCallback, useRef, useEffect } from 'react';
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

/**
 * Bug 3: the student's newest native edit, retained outside the DOM. React
 * enforces the controlled `value` during the commit phase, so a native-only
 * edit (IME/autofill/lifecycle race, or a dropped React change) is erased from
 * the input before any effect can read it. This record is the single owner of
 * that text and is kept until the controlled value acknowledges it or replaces
 * it — never derived from, or overwritten by, React's reset DOM value.
 */
type NativeEditIntent = {
  /** Exact text the student produced natively (DOM truth at edit time). */
  value: string;
  /** Monotonic edit sequence; idempotent for a repeated value. */
  revision: number;
};

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
  const nativeIntentRef = useRef<NativeEditIntent | null>(null);
  // Question/slot identity of this control. React reuses the same DOM node when
  // the parent renders another question, so an intent must never follow it.
  const controlIdentity = String(inputProps.name ?? inputProps.id ?? '');
  const previousControlIdentityRef = useRef(controlIdentity);

  /**
   * Bug 3: the single, idempotent writer of the retained native intent. Called
   * early (render phase, native listeners) so a DOM-ahead edit is captured
   * before React can reset it. A value that already equals the controlled prop
   * is nothing to rescue; anything else is retained until acknowledged.
   */
  const rememberNativeIntent = useCallback(
    (
      domValue: string,
      controlledValue: string | number | readonly string[] | undefined,
    ): void => {
      // Uncontrolled usage needs no rescue: the DOM owns the value, so React
      // has nothing to reset out from under it.
      if (typeof controlledValue !== 'string') {
        nativeIntentRef.current = null;
        return;
      }
      if (domValue === controlledValue) {
        // The visible DOM already agrees with the parent — nothing outstanding.
        nativeIntentRef.current = null;
        return;
      }
      const previousIntent = nativeIntentRef.current;
      nativeIntentRef.current =
        previousIntent && previousIntent.value === domValue
          ? previousIntent
          : { value: domValue, revision: (previousIntent?.revision ?? 0) + 1 };
    },
    [],
  );

  // Bug 3: the render phase is the last point where a native edit React never
  // observed is still readable — the commit below replaces it with the older
  // controlled value. Capture it here, early, into the retained intent. A
  // control-identity change (another question reusing the same node) can never
  // rescue the previous control's text, so the intent is dropped instead.
  const previousControlIdentity = previousControlIdentityRef.current;
  previousControlIdentityRef.current = controlIdentity;
  if (previousControlIdentity === controlIdentity) {
    const preCommitDomValue = inputRef.current?.value;
    if (typeof preCommitDomValue === 'string') {
      rememberNativeIntent(preCommitDomValue, inputProps.value);
    }
  } else {
    nativeIntentRef.current = null;
  }

  useEffect(() => {
    onCommitValueRef.current = onCommitValue;
  }, [onCommitValue]);

  useEffect(() => {
    flushAnswerDurabilityNowRef.current = flushAnswerDurabilityNow;
  }, [attemptControls]);

  useEffect(() => {
    onChangeRef.current = userOnChange;
  }, [userOnChange]);

  useEffect(() => {
    controlledValueRef.current = inputProps.value;
    // FIX-02: server hydration — discard stale DOM rescue state so blur/commit
    // does not replay pre-disconnect text over the fresh server value.
    // Bug 3: hydration identity is the CONTROLLED VALUE, never the callback
    // identity. A changed onChange used to be treated as hydration, which wiped
    // the retained native edit (and its rescue guard) on any unrelated parent
    // render. A value-prop change is the parent's answer: the retained intent is
    // either adopted or deliberately replaced, and the rescue guard resets so a
    // later deliberate equal value can still flow.
    // Intentionally deps exclude attemptControls to avoid clearing on unrelated
    // persistence churn (which would suppress a legitimate deferred blur-commit).
    nativeIntentRef.current = null;
    if (deferredRescueTimerRef.current !== null) {
      window.clearTimeout(deferredRescueTimerRef.current);
      deferredRescueTimerRef.current = null;
    }
    lastRescuedDomValueRef.current = null;
    if (typeof inputProps.value === 'string') {
      latestDomValueRef.current = inputProps.value;
    } else {
      const el = inputRef.current;
      latestDomValueRef.current = el ? el.value : String(inputProps.value ?? '');
    }
  }, [inputProps.value]);

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    latestDomValueRef.current = input.value;

    const maybeCommitDomValue = () => {
      // Protect against iPad/Safari edge cases where the DOM value has advanced,
      // but React onChange hasn't fired yet before backgrounding/pagehide.
      const controlledValue = controlledValueRef.current;
      if (typeof controlledValue !== 'string') return;

      const domValue = input.value;
      latestDomValueRef.current = domValue;
      const retainedIntent = nativeIntentRef.current;
      if (retainedIntent && retainedIntent.value === controlledValue) {
        // The parent adopted the retained edit: acknowledged, nothing to rescue.
        nativeIntentRef.current = null;
      }
      // Bug 3: the retained native intent is the student's newest text. It is
      // committed even when a re-render already reset the DOM back to the older
      // controlled value — that reset is exactly the loss this rescue exists
      // for, and it must never be guessed from string length.
      const retainedIntentValue =
        retainedIntent && retainedIntent.value !== controlledValue ? retainedIntent.value : null;
      // A DOM value that is ahead of the controlled prop AND differs from the
      // retained edit is an unobserved native write: it is newer, so it wins.
      const domValueAhead = domValue !== controlledValue ? domValue : null;
      const commitValue =
        domValueAhead !== null && domValueAhead !== retainedIntentValue
          ? domValueAhead
          : retainedIntentValue ?? domValueAhead;

      if (commitValue === null) {
        lastRescuedDomValueRef.current = null;
        return;
      }
      if (lastRescuedDomValueRef.current === commitValue) {
        return;
      }

      // Prefer the direct value-commit callback when provided (no fabricated
      // event, safe for controlled inputs). Fall back to the legacy
      // event-like onChange invocation for callers that have not migrated.
      const commitToOwner =
        typeof onCommitValueRef.current === 'function'
          ? () => onCommitValueRef.current?.(commitValue)
          : typeof onChangeRef.current === 'function'
            ? () =>
                (onChangeRef.current as unknown as (event: unknown) => void)({
                  // The DOM is healed to commitValue before this call, so the
                  // live element preserves target shape for legacy callers.
                  target: input,
                  currentTarget: input,
                  type: 'change',
                })
            : null;
      if (!commitToOwner) return;

      // Keep the visible value consistent with the text handed to the owner.
      if (input.value !== commitValue) {
        input.value = commitValue;
      }
      latestDomValueRef.current = commitValue;
      // Retained until the parent's controlled value acknowledges it.
      rememberNativeIntent(commitValue, controlledValue);
      commitToOwner();
      lastRescuedDomValueRef.current = commitValue;
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
      // Bug 3: real native input feeds the retained intent immediately — before
      // React's controlled-value commit can erase an unobserved DOM value.
      rememberNativeIntent(latestDomValueRef.current, controlledValueRef.current);
      onLiveValueChange?.(latestDomValueRef.current);
    };

    const handleNativeChange = () => {
      latestDomValueRef.current = input.value;
      rememberNativeIntent(latestDomValueRef.current, controlledValueRef.current);
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
        // The restore is an explicit, observed state: no native intent left.
        nativeIntentRef.current = null;

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
  }, [attemptControls, onLiveValueChange, sessionId, studentId, rememberNativeIntent]);

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
        const nextValue = event.currentTarget.value;
        latestDomValueRef.current = nextValue;
        onLiveValueChange?.(nextValue);
        // Bug 3: React observed this edit and is handing it to the parent's
        // controlled-update path, so the retained rescue intent is redundant for
        // that value. Commit-only callers (no onChange owner) keep it: nothing
        // else carries the keystroke until blur/lifecycle commits.
        if (typeof userOnChange === 'function' && nativeIntentRef.current?.value === nextValue) {
          nativeIntentRef.current = null;
        }
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
