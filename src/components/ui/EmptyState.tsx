import React from 'react';
import { Search, AlertCircle, CheckCircle, Inbox } from 'lucide-react';

interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  variant?: 'default' | 'search' | 'error' | 'success';
  className?: string;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  variant = 'default',
  className = '',
}: EmptyStateProps) {
  const variantIcons = {
    default: <Inbox size={48} className="text-gray-300" />,
    search: <Search size={48} className="text-gray-300" />,
    error: <AlertCircle size={48} className="text-red-300" />,
    success: <CheckCircle size={48} className="text-green-300" />,
  };

  return (
    <div className={`flex flex-col items-center justify-center p-8 text-center ${className}`}>
      <div className="mb-4">
        {icon || variantIcons[variant]}
      </div>
      <h3 className="text-base font-semibold text-gray-900 mb-2">
        {title}
      </h3>
      {description && (
        <p className="text-sm text-gray-600 mb-4 max-w-md">
          {description}
        </p>
      )}
      {action && (
        <div className="mt-2">
          {action}
        </div>
      )}
    </div>
  );
}
