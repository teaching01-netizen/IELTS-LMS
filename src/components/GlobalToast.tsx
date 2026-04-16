import React from 'react';
import { Toast, ToastContainer, type ToastVariant } from './ui/Toast';
import { TIMING } from '../constants/uiConstants';

export interface GlobalToastItem {
  actionLabel?: string;
  id: string;
  message: string;
  onAction?: () => void;
  timestamp?: string;
  title?: string;
  variant?: ToastVariant;
}

interface GlobalToastProps {
  onDismiss: (id: string) => void;
  toasts: GlobalToastItem[];
}

export function GlobalToast({ onDismiss, toasts }: GlobalToastProps) {
  if (toasts.length === 0) {
    return null;
  }

  return (
    <ToastContainer position="top-right">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className="rounded-2xl overflow-hidden shadow-xl bg-white ring-1 ring-black/5"
        >
          <Toast
            id={toast.id}
            variant={toast.variant}
            title={toast.title}
            message={toast.message}
            duration={toast.variant === 'error' ? 0 : TIMING.TOAST_DURATION_MS}
            onClose={() => onDismiss(toast.id)}
          />
          {(toast.actionLabel || toast.timestamp) && (
            <div className="px-4 pb-3 pt-0 flex items-center justify-between gap-3 text-[11px] font-semibold text-gray-500">
              <span>{toast.timestamp}</span>
              {toast.actionLabel && toast.onAction && (
                <button
                  onClick={toast.onAction}
                  className="text-sm text-blue-700 hover:text-blue-900 transition-colors"
                >
                  {toast.actionLabel}
                </button>
              )}
            </div>
          )}
        </div>
      ))}
    </ToastContainer>
  );
}
