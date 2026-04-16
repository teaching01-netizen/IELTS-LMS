import React from 'react';
import { Dialog } from './Dialog';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  showCloseButton?: boolean;
  preventCloseOnOverlayClick?: boolean;
}

/**
 * @deprecated Use `Dialog` directly. `Modal` remains as a compatibility wrapper
 * so the app keeps one dialog primitive implementation.
 */
export function Modal({
  isOpen,
  onClose,
  title,
  children,
  footer,
  size = 'md',
  showCloseButton = true,
  preventCloseOnOverlayClick = false,
}: ModalProps) {
  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      footer={footer}
      size={size}
      showCloseButton={showCloseButton}
      preventCloseOnOverlayClick={preventCloseOnOverlayClick}
    >
      {children}
    </Dialog>
  );
}
