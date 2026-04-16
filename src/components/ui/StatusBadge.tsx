import React from 'react';
import { FileText, File, Calendar, CheckCircle2, Clock, Edit } from 'lucide-react';

interface StatusBadgeProps {
  children: React.ReactNode;
  variant?: 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'paused' | 'draft' | 'published' | 'scheduled';
  size?: 'sm' | 'md';
  className?: string;
  showIcon?: boolean;
  context?: string;
}

export function StatusBadge({ 
  children, 
  variant = 'neutral', 
  size = 'md',
  className = '',
  showIcon = true,
  context
}: StatusBadgeProps) {
  const variants = {
    success: {
      bg: 'bg-green-100',
      text: 'text-green-800',
      border: 'border-green-200',
      dot: 'bg-green-700',
      icon: CheckCircle2,
      iconColor: 'text-green-600',
    },
    warning: {
      bg: 'bg-amber-100',
      text: 'text-amber-800',
      border: 'border-amber-200',
      dot: 'bg-amber-700',
      icon: Clock,
      iconColor: 'text-amber-600',
    },
    danger: {
      bg: 'bg-red-100',
      text: 'text-red-800',
      border: 'border-red-200',
      dot: 'bg-red-700',
      icon: Clock,
      iconColor: 'text-red-600',
    },
    info: {
      bg: 'bg-blue-100',
      text: 'text-blue-800',
      border: 'border-blue-200',
      dot: 'bg-blue-700',
      icon: Clock,
      iconColor: 'text-blue-600',
    },
    neutral: {
      bg: 'bg-gray-100',
      text: 'text-gray-800',
      border: 'border-gray-200',
      dot: 'bg-gray-600',
      icon: Clock,
      iconColor: 'text-gray-600',
    },
    paused: {
      bg: 'bg-blue-100',
      text: 'text-blue-800',
      border: 'border-blue-200',
      dot: 'bg-blue-700',
      icon: Clock,
      iconColor: 'text-blue-600',
    },
    draft: {
      bg: 'bg-gray-100',
      text: 'text-gray-800',
      border: 'border-gray-200',
      dot: 'bg-gray-600',
      icon: FileText,
      iconColor: 'text-gray-600',
    },
    published: {
      bg: 'bg-green-100',
      text: 'text-green-800',
      border: 'border-green-200',
      dot: 'bg-green-700',
      icon: File,
      iconColor: 'text-green-600',
    },
    scheduled: {
      bg: 'bg-blue-100',
      text: 'text-blue-800',
      border: 'border-blue-200',
      dot: 'bg-blue-700',
      icon: Calendar,
      iconColor: 'text-blue-600',
    },
  };

  const sizes = {
    sm: 'px-2 py-0.5 text-[10px] gap-1.5',
    md: 'px-2.5 py-1 text-xs gap-2',
  };

  const style = variants[variant];
  const IconComponent = style.icon;

  return (
    <span 
      className={`inline-flex items-center border rounded-sm font-bold uppercase tracking-wider ${style.bg} ${style.text} ${style.border} ${sizes[size]} ${className}`}
      role="status"
      aria-label={`${children}${context ? ` - ${context}` : ''}`}
    >
      {showIcon && IconComponent && (
        <IconComponent size={size === 'sm' ? 10 : 12} className={style.iconColor} aria-hidden="true" />
      )}
      <span className="truncate">{children}</span>
      {context && (
        <span className="hidden sm:inline opacity-75">
          {' '}- {context}
        </span>
      )}
    </span>
  );
}
