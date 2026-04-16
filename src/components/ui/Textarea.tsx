import React, { useId } from 'react';

interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
  helperText?: string;
  fullWidth?: boolean;
  resize?: 'none' | 'both' | 'horizontal' | 'vertical';
}

export function Textarea({
  label,
  error,
  helperText,
  fullWidth = false,
  resize = 'vertical',
  className = '',
  id,
  ...props
}: TextareaProps) {
  const generatedId = useId();
  const textareaId = id || generatedId;
  
  const baseStyles = 'px-3 py-2 text-sm border rounded-sm transition-all focus:outline-none focus:ring-2 focus:ring-offset-1 disabled:opacity-40 disabled:cursor-not-allowed';
  
  const stateStyles = error
    ? 'border-red-700 text-gray-900 focus:ring-red-500 focus:border-red-700 bg-white'
    : 'border-gray-200 text-gray-900 focus:ring-blue-500 focus:border-blue-800 bg-white';
  
  const resizeStyles = {
    none: 'resize-none',
    both: 'resize',
    horizontal: 'resize-x',
    vertical: 'resize-y',
  };
  
  const widthStyle = fullWidth ? 'w-full' : '';

  return (
    <div className={`flex flex-col gap-1.5 ${fullWidth ? 'w-full' : ''}`}>
      {label && (
        <label 
          htmlFor={textareaId}
          className="text-sm font-semibold text-gray-900"
        >
          {label}
          {props.required && <span className="text-red-700 ml-0.5">*</span>}
        </label>
      )}
      
      <textarea
        id={textareaId}
        className={`${baseStyles} ${stateStyles} ${resizeStyles[resize]} ${widthStyle} ${className}`}
        {...props}
      />
      
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
