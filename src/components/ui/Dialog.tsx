import React, { useEffect, useId, useRef } from 'react';
import { X } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { acquireBodyScrollLock, releaseBodyScrollLock } from './bodyScrollLock';

interface DialogProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'full';
  showCloseButton?: boolean;
  preventCloseOnOverlayClick?: boolean;
  closeOnEscape?: boolean;
  className?: string;
}

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), audio[controls], video[controls]';

function queryFocusable(container: HTMLElement | null): HTMLElement[] {
  if (!container) return [];
  // Queried fresh on every Tab press so async content (images, lazy panels)
  // participates in the trap instead of being skipped by a mount-time snapshot.
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (element) => !element.hasAttribute('disabled') && element.getAttribute('aria-hidden') !== 'true'
  );
}

export const Dialog = React.forwardRef<HTMLDivElement, DialogProps>(function Dialog({
  isOpen,
  onClose,
  title,
  children,
  footer,
  size = 'md',
  showCloseButton = true,
  preventCloseOnOverlayClick = false,
  closeOnEscape = true,
  className = '',
}: DialogProps, forwardedRef) {
  const dialogRef = useRef<HTMLDivElement>(null);
  // S4-C7: expose the dialog panel node to callers that need initial-focus control.
  React.useImperativeHandle(forwardedRef, () => dialogRef.current as HTMLDivElement);
  const previousActiveElement = useRef<HTMLElement | null>(null);
  const titleId = useId();

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    // Single-owner scroll lock: nested Dialog/Drawer instances share one counter
    // instead of clobbering each other's `overflow` restore.
    acquireBodyScrollLock();
    previousActiveElement.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    // Focus the first live focusable element (or the dialog itself as fallback).
    const initial = queryFocusable(dialogRef.current);
    if (initial.length > 0) {
      initial[0]?.focus();
    } else {
      dialogRef.current?.focus();
    }

    const handleTab = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;

      const focusableElements = queryFocusable(dialogRef.current);
      if (focusableElements.length === 0) {
        e.preventDefault();
        return;
      }

      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];
      if (!firstElement || !lastElement) {
        return;
      }

      if (e.shiftKey) {
        if (document.activeElement === firstElement) {
          e.preventDefault();
          lastElement.focus();
        }
      } else {
        if (document.activeElement === lastElement) {
          e.preventDefault();
          firstElement.focus();
        }
      }
    };

    document.addEventListener('keydown', handleTab);

    // Captured for the cleanup: dialogRef.current flips to null on unmount.
    const dialogNode = dialogRef.current;
    return () => {
      document.removeEventListener('keydown', handleTab);
      releaseBodyScrollLock();
      // Restore focus only if focus is still inside the dialog being closed.
      const previous = previousActiveElement.current;
      if (previous && previous.isConnected && dialogNode?.contains(document.activeElement)) {
        previous.focus();
      }
      previousActiveElement.current = null;
    };
  }, [isOpen]);

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented && closeOnEscape && isOpen) {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
    }

    return () => {
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen, onClose, closeOnEscape]);

  const sizes = {
    sm: 'max-w-sm',
    md: 'max-w-md',
    lg: 'max-w-lg',
    xl: 'max-w-xl',
    full: 'max-w-5xl',
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby={title ? titleId : undefined}>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 backdrop-blur-sm"
            onClick={preventCloseOnOverlayClick ? undefined : onClose}
            aria-hidden="true"
          />
          <motion.div
            ref={dialogRef}
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className={`relative w-full ${sizes[size]} bg-white rounded-xl shadow-xl overflow-hidden flex flex-col ${className}`}
            role="document"
            tabIndex={-1}
          >
            {title && (
              <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
                <h2 id={titleId} className="text-lg font-semibold text-gray-900 leading-tight tracking-tight">{title}</h2>
                {showCloseButton && (
                  <button
                    onClick={onClose}
                    className="min-w-6 min-h-6 p-1 text-gray-500 hover:text-gray-800 hover:bg-gray-100 rounded-sm transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
                    aria-label="Close dialog"
                  >
                    <X size={20} />
                  </button>
                )}
              </div>
            )}
            
            <div className="px-6 py-5 overflow-y-auto max-h-[70vh] text-gray-800 text-sm leading-relaxed">
              {children}
            </div>

            {footer && (
              <div className="px-6 py-4 border-t border-gray-100 bg-white flex justify-end gap-2">
                {footer}
              </div>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
});
