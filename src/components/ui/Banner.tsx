import React, { useId } from 'react';
import { X, CheckCircle, AlertCircle, Info, AlertTriangle } from 'lucide-react';

export type BannerVariant = 'success' | 'error' | 'warning' | 'info';

interface BannerProps {
  id?: string;
  variant?: BannerVariant;
  title?: string;
  message: string;
  onDismiss?: () => void;
  showIcon?: boolean;
  className?: string;
}

const variantIcons = {
  success: CheckCircle,
  error: AlertCircle,
  warning: AlertTriangle,
  info: Info,
};

const variantStyles = {
  success: 'bg-green-50 border-green-700 text-green-900',
  error: 'bg-red-50 border-red-700 text-red-900',
  warning: 'bg-amber-50 border-amber-700 text-amber-900',
  info: 'bg-blue-50 border-blue-700 text-blue-900',
};

export function Banner({
  id,
  variant = 'info',
  title,
  message,
  onDismiss,
  showIcon = true,
  className = '',
}: BannerProps) {
  const bannerId = useId();
  const uniqueId = id || bannerId;

  const Icon = variantIcons[variant];

  return (
    <div
      id={uniqueId}
      role="alert"
      aria-live="polite"
      className={`flex items-start gap-3 px-4 py-3 border ${variantStyles[variant]} ${className}`}
    >
      {showIcon && (
        <Icon size={20} className="flex-shrink-0 mt-0.5" aria-hidden="true" />
      )}
      <div className="flex-1 min-w-0">
        {title && (
          <p className="font-semibold text-sm mb-1">{title}</p>
        )}
        <p className="text-sm leading-relaxed">{message}</p>
      </div>
      {onDismiss && (
        <button
          onClick={onDismiss}
          className="flex-shrink-0 p-1 hover:bg-black/10 rounded transition-colors"
          aria-label="Dismiss notification"
        >
          <X size={16} />
        </button>
      )}
    </div>
  );
}
