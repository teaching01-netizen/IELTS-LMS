import React from 'react';
import { Loader2 } from 'lucide-react';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost' | 'outline' | 'warning';
  size?: 'sm' | 'md' | 'lg';
  isLoading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  fullWidth?: boolean;
  children?: React.ReactNode;
  className?: string;
  onClick?: React.MouseEventHandler<HTMLButtonElement>;
  disabled?: boolean;
}

export function Button({
  children,
  variant = 'primary',
  size = 'md',
  isLoading = false,
  leftIcon,
  rightIcon,
  fullWidth = false,
  className = '',
  ...props
}: ButtonProps) {
  const baseStyles = 'inline-flex items-center justify-center font-bold transition-all focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-40 disabled:cursor-not-allowed rounded-[3px] tracking-tight';
  
  const variants = {
    primary: 'bg-blue-800 text-white hover:bg-blue-700 active:bg-blue-900 focus:ring-blue-500 shadow-sm',
    secondary: 'bg-gray-200 text-gray-700 hover:bg-gray-100 active:bg-gray-300 focus:ring-gray-300',
    danger: 'bg-red-800 text-white hover:bg-red-700 active:bg-red-900 focus:ring-red-500 shadow-sm',
    warning: 'bg-amber-700 text-gray-900 hover:bg-amber-600 active:bg-amber-800 focus:ring-amber-400 shadow-sm',
    ghost: 'bg-transparent text-blue-800 hover:bg-blue-200 active:bg-blue-300 focus:ring-blue-400',
    outline: 'bg-transparent text-blue-800 border-2 border-blue-800 hover:bg-blue-200 active:bg-blue-300 focus:ring-blue-400',
  };

  const sizes = {
    sm: 'h-8 px-3 text-xs gap-1.5',
    md: 'h-10 px-4 text-sm gap-2',
    lg: 'h-12 px-6 text-base gap-2.5',
  };

  const widthStyle = fullWidth ? 'w-full' : '';

  return (
    <button
      className={`${baseStyles} ${variants[variant]} ${sizes[size]} ${widthStyle} ${className}`}
      {...props}
    >
      {isLoading && <Loader2 className="animate-spin" size={size === 'sm' ? 14 : 18} />}
      {!isLoading && leftIcon}
      {children}
      {!isLoading && rightIcon}
    </button>
  );
}
