import React, { useRef, useEffect } from 'react';
import { ExamConfig } from '../../types';
import { saveStudentAuditEvent } from '../../services/studentAuditService';

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
  const inputRef = useRef<HTMLInputElement>(null);
  const lastKeydownRef = useRef<number>(0);
  const previousValueRef = useRef<string>('');

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;

    const handleBeforeInput = (event: InputEvent) => {
      if (event.inputType === 'insertReplacementText') {
        // This is likely autofill or autocorrect
        saveStudentAuditEvent(
          sessionId,
          'AUTOFILL_SUSPECTED',
          {
            inputType: event.inputType,
            data: event.data,
            targetName: input.name || 'unknown',
          },
          studentId,
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
          sessionId,
          'REPLACEMENT_SUSPECTED',
          {
            previousLength: previousValue.length,
            newLength: newValue.length,
            timeSinceKeydown,
            targetName: input.name || 'unknown',
          },
          studentId,
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
  }, [sessionId, studentId]);

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
