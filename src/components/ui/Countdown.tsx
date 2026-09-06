import React, { useState, useEffect, useCallback, useRef } from 'react';

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
  const [timeLeft, setTimeLeft] = useState(() => Math.max(0, seconds));
  // Fires exactly once per mount/prop-cycle: guards StrictMode double-effects
  // and prevents re-firing when a parent re-renders with an inline onComplete.
  const completedRef = useRef(false);
  const onCompleteRef = useRef(onComplete);

  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  useEffect(() => {
    completedRef.current = false;
    setTimeLeft(Math.max(0, seconds));
  }, [seconds]);

  // Derived boolean keeps the interval stable: the effect only re-runs when the
  // countdown transitions between running and finished, instead of every tick
  // (tearing the interval down each second would drift the cadence).
  const isComplete = timeLeft <= 0;

  useEffect(() => {
    if (isComplete) {
      if (!completedRef.current) {
        completedRef.current = true;
        onCompleteRef.current?.();
      }
      return undefined;
    }

    const timer = window.setInterval(() => {
      setTimeLeft((prev) => Math.max(0, prev - 1));
    }, 1000);

    return () => window.clearInterval(timer);
  }, [isComplete]);

  const formatTime = useCallback((totalSeconds: number) => {
    const safe = Math.max(0, Math.floor(totalSeconds));
    const hours = Math.floor(safe / 3600);
    const minutes = Math.floor((safe % 3600) / 60);
    const secs = safe % 60;

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
    <div
      className={`inline-flex items-center gap-2 border rounded-sm font-mono font-bold ${style.bg} ${style.border} ${style.text} ${sizes[size]} ${className}`}
      role="timer"
      aria-live="off"
      aria-label={`${formatTime(timeLeft)} remaining`}
    >
      <span>{formatTime(timeLeft)}</span>
      {showLabel && timeLeft > 0 && (
        <span className="text-xs font-normal text-gray-600">
          {timeLeft === 1 ? 'second' : 'seconds'} remaining
        </span>
      )}
    </div>
  );
}
