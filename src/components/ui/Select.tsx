import React, { useId } from 'react';

interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

interface SelectProps extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
  label?: string;
  error?: string;
  helperText?: string;
  options: SelectOption[];
  placeholder?: string;
  fullWidth?: boolean;
}

export function Select({
  label,
  error,
  helperText,
  options,
  placeholder,
  fullWidth = false,
  className = '',
  id,
  ...props
}: SelectProps) {
  const generatedId = useId();
  const selectId = id || generatedId;
  
  const baseStyles = 'h-10 px-3 text-sm border rounded-sm transition-all focus:outline-none focus:ring-2 focus:ring-offset-1 disabled:opacity-40 disabled:cursor-not-allowed appearance-none bg-white';
  
  const stateStyles = error
    ? 'border-red-700 text-gray-900 focus:ring-red-500 focus:border-red-700'
    : 'border-gray-200 text-gray-900 focus:ring-blue-500 focus:border-blue-800';
  
  const widthStyle = fullWidth ? 'w-full' : '';

  return (
    <div className={`flex flex-col gap-1.5 ${fullWidth ? 'w-full' : ''}`}>
      {label && (
        <label 
          htmlFor={selectId}
          className="text-sm font-semibold text-gray-900"
        >
          {label}
          {props.required && <span className="text-red-700 ml-0.5">*</span>}
        </label>
      )}
      
      <div className="relative">
        <select
          id={selectId}
          className={`${baseStyles} ${stateStyles} ${widthStyle} ${className} pr-10`}
          {...props}
        >
          {placeholder && (
            <option value="" disabled>
              {placeholder}
            </option>
          )}
          {options.map((option) => (
            <option 
              key={option.value} 
              value={option.value}
              disabled={option.disabled}
            >
              {option.label}
            </option>
          ))}
        </select>
        
        <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
          <svg
            className="w-4 h-4 text-gray-500"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M19 9l-7 7-7-7"
            />
          </svg>
        </div>
      </div>
      
      {error && (
        <p className="text-xs text-red-700 font-medium" role="alert">
          {error}
        </p>
      )}
      
      {helperText && !error && (
        <p className="text-xs text-gray-600">
          {helperText}
        </p>
      )}
    </div>
  );
}
