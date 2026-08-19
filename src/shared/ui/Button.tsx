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
  ref?: React.Ref<HTMLButtonElement>;
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
  ref,
  ...props
}: ButtonProps) {
  const baseStyles = 'inline-flex items-center justify-center font-semibold transition-[scale,background-color,border-color,box-shadow,opacity] duration-150 ease-out active:scale-[0.96] focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:opacity-40 disabled:cursor-not-allowed rounded-[3px] tracking-tight';

  const variants = {
    primary: 'bg-primary text-primary-foreground hover:bg-primary-hover active:bg-primary-active focus-visible:ring-ring',
    secondary: 'bg-gray-100 text-gray-800 hover:bg-gray-200 active:bg-gray-300 focus-visible:ring-gray-300',
    danger: 'bg-destructive text-destructive-foreground hover:bg-destructive-hover active:bg-destructive-active focus-visible:ring-red-500',
    warning: 'bg-amber-400 text-gray-900 hover:bg-amber-500 active:bg-amber-600 focus-visible:ring-blue-600',
    ghost: 'bg-transparent text-gray-700 hover:bg-gray-100 active:bg-gray-200 focus-visible:ring-gray-300',
    outline: 'bg-transparent text-gray-700 border-2 border-gray-300 hover:bg-gray-100 active:bg-gray-200 focus-visible:ring-gray-300',
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
      ref={ref}
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
