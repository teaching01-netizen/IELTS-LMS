import React from 'react';

type LoadingMarkSize = 'xs' | 'sm' | 'md';
type LoadingMarkVariant = 'dot' | 'bar';

interface LoadingMarkProps extends React.HTMLAttributes<HTMLSpanElement> {
  size?: LoadingMarkSize | undefined;
  variant?: LoadingMarkVariant | undefined;
}

const sizeClasses: Record<LoadingMarkSize, string> = {
  xs: 'h-2 w-2',
  sm: 'h-2.5 w-2.5',
  md: 'h-3 w-3',
};

export function LoadingMark({
  size = 'sm',
  variant = 'dot',
  className = '',
  ...props
}: LoadingMarkProps) {
  const base = 'inline-block animate-pulse';

  const shape =
    variant === 'bar'
      ? 'h-2 w-8 rounded-full'
      : `${sizeClasses[size]} rounded-full`;

  return (
    <span
      aria-hidden="true"
      className={`${base} ${shape} ${className}`}
      {...props}
    />
  );
}

export function SrLoadingText({ children = 'Loading…' }: { children?: string | undefined }) {
  return <span className="sr-only">{children}</span>;
}
