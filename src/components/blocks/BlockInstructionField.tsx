import React from 'react';
import { AlertCircle } from 'lucide-react';
import { handleBoldHotkey } from '../../utils/boldMarkdown';

interface BlockInstructionFieldProps {
  errorMessage?: string | undefined;
  label?: string | undefined;
  onChange: (instruction: string) => void;
  placeholder: string;
  rows?: number | undefined;
  value: string;
}

export function BlockInstructionField({
  errorMessage,
  label = 'Instruction',
  onChange,
  placeholder,
  rows = 2,
  value,
}: BlockInstructionFieldProps) {
  const fieldId = React.useId();
  const errorId = errorMessage ? `${fieldId}-error` : undefined;

  return (
    <div className="mb-4">
      <label htmlFor={fieldId} className="block">
        <span className="block text-sm font-medium text-gray-700 mb-2">{label}</span>
        <textarea
          id={fieldId}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => handleBoldHotkey(event, onChange)}
          className={`w-full border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 ${
            errorMessage
              ? 'border-red-500 bg-red-50 focus:ring-red-500'
              : 'border-gray-300 focus:ring-blue-500'
          }`}
          rows={rows}
          placeholder={placeholder}
          aria-label={label}
          aria-describedby={errorId}
          aria-invalid={errorMessage ? 'true' : undefined}
        />
      </label>
      {errorMessage ? (
        <p id={errorId} className="text-xs text-red-600 mt-1 flex items-center gap-1">
          <AlertCircle size={10} /> {errorMessage}
        </p>
      ) : null}
    </div>
  );
}
