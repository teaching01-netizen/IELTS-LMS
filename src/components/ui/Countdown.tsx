import React, { useState, useEffect, useCallback } from 'react';

interface CountdownProps {
  seconds: number;
  onComplete?: () => void;
  variant?: 'default' | 'warning' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  showLabel?: boolean;
  className?: string;
}

export function Countdown({
  seconds,
  onComplete,
  variant = 'default',
  size = 'md',
  showLabel = false,
  className = '',
}: CountdownProps) {
  const [timeLeft, setTimeLeft] = useState(seconds);

  useEffect(() => {
    setTimeLeft(seconds);
  }, [seconds]);

  useEffect(() => {
    if (timeLeft <= 0) {
      onComplete?.();
      return;
    }

    const timer = setInterval(() => {
      setTimeLeft((prev) => prev - 1);
    }, 1000);

    return () => clearInterval(timer);
  }, [timeLeft, onComplete]);

  const formatTime = useCallback((totalSeconds: number) => {
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const secs = totalSeconds % 60;

    if (hours > 0) {
      return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }, []);

  const variants = {
    default: {
      bg: 'bg-gray-50',
      border: 'border-gray-200',
      text: 'text-gray-900',
    },
    warning: {
      bg: 'bg-amber-50',
      border: 'border-amber-300',
      text: 'text-amber-900',
    },
    danger: {
      bg: 'bg-red-50',
      border: 'border-red-300',
      text: 'text-red-900',
    },
  };

  const sizes = {
    sm: 'px-2 py-1 text-sm',
    md: 'px-3 py-1.5 text-base',
    lg: 'px-4 py-2 text-lg',
  };

  const style = variants[variant];

  return (
    <div className={`inline-flex items-center gap-2 border rounded-sm font-mono font-bold ${style.bg} ${style.border} ${style.text} ${sizes[size]} ${className}`}>
      <span>{formatTime(Math.max(0, timeLeft))}</span>
      {showLabel && timeLeft > 0 && (
        <span className="text-xs font-normal text-gray-600">
          {timeLeft === 1 ? 'second' : 'seconds'} remaining
        </span>
      )}
    </div>
  );
}
