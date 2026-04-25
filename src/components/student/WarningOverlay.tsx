import React, { useState, useEffect } from 'react';
import { AlertTriangle, ShieldAlert, XOctagon } from 'lucide-react';
import { Button } from '../ui/Button';
import { motion } from 'motion/react';
import { useFocusTrap } from '../../hooks/useFocusTrap';

interface WarningOverlayProps {
  isOpen: boolean;
  severity: 'medium' | 'high' | 'critical';
  message: string;
  onAcknowledge: () => void;
  actionButton?: {
    label: string;
    onClick: () => void;
  };
  showCountdown?: boolean;
}

export function WarningOverlay({ isOpen, severity, message, onAcknowledge, actionButton, showCountdown = true }: WarningOverlayProps) {
  const [countdown, setCountdown] = useState(30);
  const dialogRef = useFocusTrap(isOpen, severity === 'critical' ? undefined : onAcknowledge);

  useEffect(() => {
    if (isOpen && showCountdown && countdown > 0) {
      const timer = setInterval(() => setCountdown(prev => prev - 1), 1000);
      return () => clearInterval(timer);
    } else if (isOpen && showCountdown && countdown === 0) {
      onAcknowledge();
    }
    return undefined;
  }, [isOpen, countdown, onAcknowledge, showCountdown]);

  // Reset countdown when opened
  useEffect(() => {
    if (isOpen) setCountdown(30);
  }, [isOpen]);

  const severityConfig = {
    medium: {
      icon: <AlertTriangle size={64} className="text-amber-500" />,
      title: 'ATTENTION',
      bg: 'bg-amber-50',
      border: 'border-amber-500',
      text: 'text-amber-900',
    },
    high: {
      icon: <ShieldAlert size={64} className="text-orange-600 animate-pulse" />,
      title: 'WARNING — FINAL NOTICE',
      bg: 'bg-orange-50',
      border: 'border-orange-500',
      text: 'text-orange-900',
    },
    critical: {
      icon: <XOctagon size={64} className="text-red-600" />,
      title: 'EXAM PAUSED',
      bg: 'bg-red-50',
      border: 'border-red-500',
      text: 'text-red-900',
    },
  };

  const config = severityConfig[severity];

  if (!isOpen) return null;

  return (
    <div
      ref={dialogRef as React.RefObject<HTMLDivElement>}
      className="fixed inset-0 z-[100] flex items-center justify-center p-6"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="student-warning-title"
      aria-describedby="student-warning-message"
      tabIndex={-1}
    >
      <motion.div 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="fixed inset-0 bg-black/80 backdrop-blur-md"
      />
      
      <motion.div 
        initial={{ scale: 0.9, opacity: 0, y: 20 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        className={`relative w-full max-w-xl ${config.bg} rounded-3xl shadow-2xl overflow-hidden border-4 ${config.border}`}
      >
        <div className="p-12 text-center flex flex-col items-center">
          <div className="mb-8">{config.icon}</div>
          
          <h2 id="student-warning-title" className={`text-4xl font-black mb-6 tracking-tight ${config.text}`}>
            {config.title}
          </h2>
          
          <div className="bg-white/50 rounded-2xl p-8 mb-10 border border-black/5 shadow-inner">
            <p id="student-warning-message" className="text-lg font-medium text-gray-800 leading-relaxed">
              {message}
            </p>
          </div>

          {severity !== 'critical' ? (
            <div className="w-full space-y-6">
              {actionButton ? (
                <Button 
                  variant={severity === 'high' ? 'warning' : 'primary'} 
                  size="lg" 
                  fullWidth 
                  className="h-16 text-xl font-bold uppercase tracking-widest rounded-2xl shadow-lg"
                  onClick={actionButton.onClick}
                >
                  {actionButton.label}
                </Button>
              ) : (
                <Button 
                  variant={severity === 'high' ? 'warning' : 'primary'} 
                  size="lg" 
                  fullWidth 
                  className="h-16 text-xl font-bold uppercase tracking-widest rounded-2xl shadow-lg"
                  onClick={onAcknowledge}
                >
                  I Understand
                </Button>
              )}
              
              {showCountdown && (
                <div className="flex items-center justify-center gap-2">
                  <div className="h-1.5 w-32 bg-gray-200 rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-blue-600 transition-all duration-1000 linear"
                      style={{ width: `${(countdown / 30) * 100}%` }}
                    ></div>
                  </div>
                  <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">
                    Auto-dismiss in: {countdown}s
                  </p>
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center gap-4">
              <div className="w-12 h-12 rounded-full bg-red-200 animate-pulse" aria-hidden="true" />
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
