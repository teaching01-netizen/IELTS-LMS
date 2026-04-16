import React, { useEffect, useId } from 'react';
import { X, CheckCircle, AlertCircle, Info, AlertTriangle } from 'lucide-react';
import { motion } from 'motion/react';

export type ToastVariant = 'success' | 'error' | 'warning' | 'info';

interface ToastProps {
  id?: string | undefined;
  variant?: ToastVariant | undefined;
  title?: string | undefined;
  message: string;
  onClose: () => void;
  duration?: number | undefined;
  showCloseButton?: boolean | undefined;
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

export function Toast({
  id,
  variant = 'info',
  title,
  message,
  onClose,
  duration = 5000,
  showCloseButton = true,
}: ToastProps) {
  const toastId = useId();
  const uniqueId = id || toastId;

  useEffect(() => {
    if (duration > 0) {
      const timer = setTimeout(onClose, duration);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [duration, onClose]);

  const Icon = variantIcons[variant];

  return (
    <motion.div
      id={uniqueId}
      role="alert"
      aria-live="polite"
      initial={{ opacity: 0, x: 100 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 100 }}
      className={`flex items-start gap-3 p-4 rounded-sm border shadow-lg max-w-md ${variantStyles[variant]}`}
    >
      <Icon size={20} className="flex-shrink-0 mt-0.5" aria-hidden="true" />
      <div className="flex-1 min-w-0">
        {title && (
          <p className="font-semibold text-sm mb-1">{title}</p>
        )}
        <p className="text-sm leading-relaxed">{message}</p>
      </div>
      {showCloseButton && (
        <button
          onClick={onClose}
          className="flex-shrink-0 p-1 hover:bg-black/10 rounded transition-colors"
          aria-label="Close notification"
        >
          <X size={16} />
        </button>
      )}
    </motion.div>
  );
}

interface ToastContainerProps {
  children: React.ReactNode;
  position?: 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left';
}

const positionStyles = {
  'top-right': 'top-4 right-4',
  'top-left': 'top-4 left-4',
  'bottom-right': 'bottom-4 right-4',
  'bottom-left': 'bottom-4 left-4',
};

export function ToastContainer({ children, position = 'top-right' }: ToastContainerProps) {
  return (
    <div className={`fixed z-50 flex flex-col gap-2 pointer-events-none ${positionStyles[position]}`}>
      {React.Children.map(children, (child) => (
        <div className="pointer-events-auto">{child}</div>
      ))}
    </div>
  );
}
