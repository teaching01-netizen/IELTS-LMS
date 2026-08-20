import React, { useState, useEffect, useRef } from 'react';
import { AlertTriangle, ShieldAlert, XOctagon } from 'lucide-react';
import { Button } from '../ui/Button';
import { motion } from 'motion/react';

interface WarningOverlayProps {
  isOpen: boolean;
  severity: 'medium' | 'high' | 'critical';
  message: string;
  onAcknowledge: () => void;
  appearance?: 'default' | 'blackout';
  actionButton?: {
    label: string;
    onClick: () => void;
  };
  showCountdown?: boolean;
}

export function WarningOverlay({
  isOpen,
  severity,
  message,
  onAcknowledge,
  appearance = 'default',
  actionButton,
  showCountdown = true,
}: WarningOverlayProps) {
  const [countdown, setCountdown] = useState(30);
  const primaryButtonRef = useRef<HTMLButtonElement | null>(null);
  const onAcknowledgeRef = useRef(onAcknowledge);
  const hasResetRef = useRef(false);

  useEffect(() => {
    onAcknowledgeRef.current = onAcknowledge;
  }, [onAcknowledge]);

  // FIX-02: single interval per open lifetime; do not recreate on every tick.
  // deps intentionally exclude `countdown` to avoid recreating the timer each second.
  useEffect(() => {
    if (!isOpen || !showCountdown || severity === 'critical') return;
    const timer = setInterval(() => {
      setCountdown((prev) => (prev <= 1 ? 0 : prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [isOpen, showCountdown, severity]);

  // Reset countdown when opened; guard acknowledge in same tick
  useEffect(() => {
    if (isOpen) {
      setCountdown(30);
      hasResetRef.current = true;
      const t = window.setTimeout(() => { hasResetRef.current = false; }, 0);
      return () => window.clearTimeout(t);
    } else {
      hasResetRef.current = false;
      return;
    }
  }, [isOpen]);

  useEffect(() => {
    if (isOpen && showCountdown && severity !== 'critical' && countdown === 0 && !hasResetRef.current) {
      onAcknowledgeRef.current();
    }
  }, [isOpen, showCountdown, severity, countdown]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const timer = window.setTimeout(() => primaryButtonRef.current?.focus(), 0);
    return () => {
      window.clearTimeout(timer);
      previouslyFocused?.focus?.();
    };
  }, [isOpen]);

  const severityConfig = {
    medium: {
      icon: <AlertTriangle size={40} className="text-amber-500" />,
      title: 'ATTENTION',
      bg: 'bg-amber-50',
      border: 'border-amber-500',
      text: 'text-amber-900',
      countdownFill: 'bg-amber-600',
    },
    high: {
      icon: <ShieldAlert size={40} className="text-orange-600" />,
      title: 'WARNING — FINAL NOTICE',
      bg: 'bg-orange-50',
      border: 'border-orange-500',
      text: 'text-orange-900',
      countdownFill: 'bg-orange-600',
    },
    critical: {
      icon: <XOctagon size={40} className="text-red-600" />,
      title: 'EXAM PAUSED',
      bg: 'bg-red-50',
      border: 'border-red-500',
      text: 'text-red-900',
      countdownFill: 'bg-red-600',
    },
  };

  const config = severityConfig[severity];

  if (!isOpen) return null;

  if (appearance === 'blackout') {
    return (
      <div
        className="fixed inset-0 z-[220] bg-black flex items-center justify-center p-6"
        role="dialog"
        aria-modal="true"
        aria-labelledby="warning-blackout-title"
      >
        <div className="w-full max-w-xl rounded-xl border border-white/20 bg-black/80 px-8 py-10 text-center shadow-xl">
          <p className="text-xs font-semibold uppercase tracking-wide text-white/70 mb-4">Security Hold</p>
          <h2 id="warning-blackout-title" className="text-2xl font-bold text-white mb-6">Screen Capture Blocked</h2>
          <p className="text-base leading-relaxed text-white/90 mb-8">{message}</p>
          <Button
            variant="primary"
            size="lg"
            ref={primaryButtonRef}
            className="h-12 px-8 text-base font-semibold"
            onClick={onAcknowledge}
          >
            Continue Exam
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="warning-overlay-title"
    >
      <motion.div 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="fixed inset-0 bg-black/80 backdrop-blur-md"
      />
      
      <motion.div 
        initial={{ scale: 0.9, opacity: 0, y: 20 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        className={`relative w-full max-w-xl ${config.bg} rounded-xl shadow-xl overflow-hidden border ${config.border}`}
      >
        <div className="p-8 md:p-12 text-center flex flex-col items-center">
          <div className="mb-6">{config.icon}</div>
          
          <h2 id="warning-overlay-title" className={`text-2xl md:text-3xl font-bold mb-5 tracking-tight ${config.text}`}>
            {config.title}
          </h2>
          
          <div className="bg-white/70 rounded-lg p-6 mb-8 border border-black/5">
            <p className="text-base md:text-lg font-medium text-gray-800 leading-relaxed">
              {message}
            </p>
          </div>

          {severity !== 'critical' ? (
            <div className="w-full space-y-5">
              {actionButton ? (
                <Button 
                  variant={severity === 'high' ? 'warning' : 'primary'} 
                  size="lg" 
                  fullWidth 
                  ref={primaryButtonRef}
                  className="h-12 text-base font-semibold rounded-lg shadow-sm"
                  onClick={actionButton.onClick}
                >
                  {actionButton.label}
                </Button>
              ) : (
                <Button 
                  variant={severity === 'high' ? 'warning' : 'primary'} 
                  size="lg" 
                  fullWidth 
                  ref={primaryButtonRef}
                  className="h-12 text-base font-semibold rounded-lg shadow-sm"
                  onClick={onAcknowledge}
                >
                  I Understand
                </Button>
              )}
              
              {showCountdown && (
                <div className="flex items-center justify-center gap-2">
                  <div className="h-1.5 w-32 bg-gray-200 rounded-full overflow-hidden">
                    <div 
                      className={`h-full ${config.countdownFill} transition-all duration-1000 linear`}
                      style={{ width: `${(countdown / 30) * 100}%` }}
                    ></div>
                  </div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide" aria-live="polite">
                    Auto-dismiss in: {countdown}s
                  </p>
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center gap-4">
              <div className="w-10 h-10 rounded-full bg-red-200 animate-pulse" aria-hidden="true" />
              <span className="sr-only">Waiting…</span>
              <p className="text-sm font-bold text-red-700 uppercase tracking-widest">
                Waiting for proctor to resume...
              </p>
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
}
