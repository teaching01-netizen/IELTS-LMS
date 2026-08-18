import React from 'react';
import { LoadingMark, SrLoadingText } from './LoadingMark';

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
  const baseStyles = 'inline-flex items-center justify-center font-semibold transition-[scale,background-color,border-color,box-shadow,opacity] duration-150 ease-out active:scale-[0.96] focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-40 disabled:cursor-not-allowed rounded-[3px] tracking-tight';

  const variants = {
    primary: 'bg-primary text-primary-foreground hover:bg-primary-hover active:bg-primary-active focus:ring-ring',
    secondary: 'bg-gray-200 text-gray-700 hover:bg-gray-100 active:bg-gray-300 focus:ring-gray-300',
    danger: 'bg-destructive text-destructive-foreground hover:bg-destructive-hover active:bg-destructive-active focus:ring-red-500',
    warning: 'bg-amber-700 text-gray-900 hover:bg-amber-600 active:bg-amber-800 focus:ring-amber-400',
    ghost: 'bg-transparent text-primary hover:bg-blue-200 active:bg-blue-300 focus:ring-blue-400',
    outline: 'bg-transparent text-primary border-2 border-primary hover:bg-blue-200 active:bg-blue-300 focus:ring-blue-400',
  };

  const sizes = {
    sm: 'h-8 px-3 text-xs gap-1.5',
    md: 'h-10 px-4 text-sm gap-2',
    lg: 'h-12 px-6 text-base gap-2.5',
  };

  const widthStyle = fullWidth ? 'w-full' : '';
  const isSolidVariant = variant === 'primary' || variant === 'danger' || variant === 'warning';
  const loadingMarkClassName = isSolidVariant ? 'bg-white/40' : 'bg-gray-300';

  return (
    <button
      className={`${baseStyles} ${variants[variant]} ${sizes[size]} ${widthStyle} ${className}`}
      disabled={props.disabled || isLoading}
      {...props}
    >
      {isLoading ? (
        <>
          <LoadingMark
            size={size === 'sm' ? 'xs' : 'sm'}
            className={loadingMarkClassName}
          />
          <SrLoadingText />
        </>
      ) : null}
      {!isLoading && leftIcon}
      {children}
      {!isLoading && rightIcon}
    </button>
  );
}
