/**
 * Standardized Form Input Component
 * Reusable input with error handling and accessibility
 */

import React from 'react';
import { UseControllerReturn, FieldValues } from 'react-hook-form';

interface FormInputProps {
  label?: string;
  type?: 'text' | 'email' | 'password' | 'number' | 'tel' | 'url';
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  field: UseControllerReturn<FieldValues>;
  error?: string;
  helperText?: string;
  className?: string;
}

export function FormInput({
  label,
  type = 'text',
  placeholder,
  disabled,
  required,
  field,
  error,
  helperText,
  className = '',
}: FormInputProps): React.ReactElement {
  const { field: { onChange, onBlur, value, ref } } = field;

  return (
    <div className={`form-group ${className}`}>
      {label && (
        <label htmlFor={field.field.name} className="block text-sm font-medium text-gray-700 mb-1">
          {label}
          {required && <span className="text-red-500 ml-1">*</span>}
        </label>
      )}
      <input
        ref={ref}
        type={type}
        id={field.field.name}
        value={value as string}
        onChange={onChange}
        onBlur={onBlur}
        placeholder={placeholder}
        disabled={disabled}
        className={`w-full px-3 py-2 border rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent ${
          error ? 'border-red-500' : 'border-gray-300'
        } ${disabled ? 'bg-gray-100 cursor-not-allowed' : 'bg-white'}`}
        aria-invalid={!!error}
        aria-describedby={error ? `${field.field.name}-error` : helperText ? `${field.field.name}-helper` : undefined}
      />
      {error && (
        <p id={`${field.field.name}-error`} className="mt-1 text-sm text-red-600">
          {error}
        </p>
      )}
      {helperText && !error && (
        <p id={`${field.field.name}-helper`} className="mt-1 text-sm text-gray-500">
          {helperText}
        </p>
      )}
    </div>
  );
}
