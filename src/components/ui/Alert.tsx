import React from 'react';
import { AlertTriangle, Info, XCircle, CheckCircle, X } from 'lucide-react';

interface AlertProps {
  title?: string;
  children: React.ReactNode;
  variant?: 'info' | 'warning' | 'error' | 'success';
  onClose?: () => void;
  className?: string;
}

export function Alert({
  title,
  children,
  variant = 'info',
  onClose,
  className = '',
}: AlertProps) {
  const variants = {
    info: {
      bg: 'bg-blue-50',
      border: 'border-blue-800',
      text: 'text-blue-900',
      icon: <Info className="text-blue-800" size={20} />,
    },
    warning: {
      bg: 'bg-amber-50',
      border: 'border-amber-700',
      text: 'text-amber-900',
      icon: <AlertTriangle className="text-amber-700" size={20} />,
    },
    error: {
      bg: 'bg-red-50',
      border: 'border-red-800',
      text: 'text-red-900',
      icon: <XCircle className="text-red-800" size={20} />,
    },
    success: {
      bg: 'bg-green-50',
      border: 'border-green-800',
      text: 'text-green-900',
      icon: <CheckCircle className="text-green-800" size={20} />,
    },
  };

  const style = variants[variant];

  return (
    <div className={`flex gap-3 p-4 rounded-sm border-l-4 shadow-sm ${style.bg} ${style.border} ${style.text} ${className}`}>
      <div className="flex-shrink-0 mt-0.5">{style.icon}</div>
      <div className="flex-1">
        {title && <h4 className="font-semibold mb-1">{title}</h4>}
        <div className="text-sm leading-relaxed">{children}</div>
      </div>
      {onClose && (
        <button
          onClick={onClose}
          className="flex-shrink-0 p-1 hover:bg-black/5 rounded-full transition-colors h-fit"
        >
          <X size={16} />
        </button>
      )}
    </div>
  );
}
