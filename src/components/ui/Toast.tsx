import React, { useEffect, useId, useRef } from 'react';
import { X, CheckCircle, AlertCircle, Info, AlertTriangle } from 'lucide-react';
import { motion } from 'motion/react';

export type ToastVariant = 'success' | 'error' | 'warning' | 'info';

interface ToastProps {
  id?: string | undefined;
  variant?: ToastVariant | undefined;
  title?: string | undefined;
  message: string;
  onClose: () => void;
  /**
   * Auto-dismiss delay in ms. `0` (or any value <= 0) disables auto-dismiss
   * and the toast stays until manually closed — matches useUIStore semantics.
   */
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

export const Toast = React.forwardRef<HTMLDivElement, ToastProps>(function Toast({
  id,
  variant = 'info',
  title,
  message,
  onClose,
  duration = 5000,
  showCloseButton = true,
}: ToastProps, ref) {
  const toastId = useId();
  const uniqueId = id || toastId;
  // Stable ref: an inline onClose from a parent re-render must not reset the
  // auto-dismiss timer (which would keep the toast alive indefinitely).
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    // duration <= 0 (including 0) means sticky: no auto-dismiss timer.
    if (!(duration > 0)) {
      return undefined;
    }
    const timer = window.setTimeout(() => {
      onCloseRef.current();
    }, duration);
    return () => window.clearTimeout(timer);
  }, [duration]);

  const Icon = variantIcons[variant];

  return (
    <motion.div
      id={uniqueId}
      ref={ref}
      // S5: ONE alert mechanism per toast — role=alert implies assertive
      // announcement, so no parallel aria-live on the same node.
      role="alert"
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
          className="flex-shrink-0 min-w-6 min-h-6 p-1 hover:bg-black/10 rounded transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-current focus-visible:ring-offset-1"
          aria-label="Close notification"
          type="button"
        >
          <X size={16} />
        </button>
      )}
    </motion.div>
  );
});

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
    // S5: region stays mounted with a single polite live value; individual
    // toasts announce via their own role=alert (separate nodes — no conflict).
    <div
      className={`fixed z-50 flex flex-col gap-2 pointer-events-none ${positionStyles[position]}`}
      role="region"
      aria-label="Notifications"
      aria-live="polite"
    >
      {React.Children.map(children, (child) => (
        <div className="pointer-events-auto">{child}</div>
      ))}
    </div>
  );
}
