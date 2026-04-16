import React, { useEffect } from 'react';
import { X } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface DrawerProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  position?: 'right' | 'left';
  size?: 'sm' | 'md' | 'lg' | 'xl';
  showCloseButton?: boolean;
  preventCloseOnOverlayClick?: boolean;
  closeOnEscape?: boolean;
  className?: string;
}

export function Drawer({
  isOpen,
  onClose,
  title,
  children,
  footer,
  position = 'right',
  size = 'md',
  showCloseButton = true,
  preventCloseOnOverlayClick = false,
  closeOnEscape = true,
  className = '',
}: DrawerProps) {
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }
    return () => {
      document.body.style.overflow = 'unset';
    };
  }, [isOpen]);

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && closeOnEscape && isOpen) {
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
    sm: 'w-80',
    md: 'w-96',
    lg: 'w-[480px]',
    xl: 'w-[600px]',
  };

  const slideDirection = position === 'right' 
    ? { initial: { x: '100%' }, exit: { x: '100%' } }
    : { initial: { x: '-100%' }, exit: { x: '-100%' } };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex" role="dialog" aria-modal="true">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 backdrop-blur-sm"
            onClick={preventCloseOnOverlayClick ? undefined : onClose}
            aria-hidden="true"
          />
          <motion.div
            initial={{ opacity: 0, ...slideDirection.initial }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, ...slideDirection.exit }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className={`relative h-full ${sizes[size]} bg-white shadow-2xl flex flex-col ${position === 'right' ? 'ml-auto' : 'mr-auto'} ${className}`}
            role="document"
          >
            {title && (
              <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between flex-shrink-0">
                <h2 className="text-lg font-semibold text-gray-900 leading-tight tracking-tight">{title}</h2>
                {showCloseButton && (
                  <button
                    onClick={onClose}
                    className="p-1 text-gray-500 hover:text-gray-800 hover:bg-gray-100 rounded-sm transition-all focus:outline-none focus:ring-2 focus:ring-blue-500"
                    aria-label="Close drawer"
                  >
                    <X size={20} />
                  </button>
                )}
              </div>
            )}
            
            <div className="flex-1 overflow-y-auto px-6 py-5 text-gray-800 text-sm leading-relaxed">
              {children}
            </div>

            {footer && (
              <div className="px-6 py-4 border-t border-gray-100 bg-white flex justify-end gap-2 flex-shrink-0">
                {footer}
              </div>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
